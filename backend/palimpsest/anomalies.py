"""Galactic anomaly investigation.

An anomaly is a star whose combination of properties is unusual *relative to a
stated reference population*, together with the measurements that make it so.

* ``kinematic_given_chemistry``: orbit (eccentricity, z_max, L_z, J_R, J_z)
  compared with stars of the same chemistry (bins in [Fe/H] x [Mg/Fe]).
* ``chemistry_given_orbit``: abundances compared with stars on similar orbits
  (nearest neighbours in action space).

Each result carries data-quality diagnostics (RUWE, parallax precision, RV
variability across APOGEE visits, single-visit RV, Gaia colour vs APOGEE Teff
consistency as a cross-match check) so that apparent anomalies caused by poor
measurements can be recognised, and rule-based follow-up suggestions.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from scipy.spatial import cKDTree

from . import chemistry, config as C

TEFF_COLOUR_EBV_MAX = 0.05  # the colour-Teff relation is fitted on (and valid for) low-extinction stars
KIN = ["ecc", "log_zmax", "Lz", "sqrt_JR", "sqrt_Jz"]
KIN_LABEL = {"ecc": "eccentricity", "log_zmax": "log10 z_max [kpc]", "Lz": "L_z [kpc km/s]",
             "sqrt_JR": "sqrt(J_R)", "sqrt_Jz": "sqrt(J_z)"}


def _kin_frame(df: pd.DataFrame) -> pd.DataFrame:
    return pd.DataFrame({"ecc": df["ecc"], "log_zmax": np.log10(df["zmax"].clip(1e-3)), "Lz": df["Lz"],
                         "sqrt_JR": np.sqrt(df["J_R"].clip(0)), "sqrt_Jz": np.sqrt(df["J_z"].clip(0))},
                        index=df.index)


class AnomalyModel:
    def __init__(self, stars: pd.DataFrame):
        self.stars = stars
        self.kin = _kin_frame(stars)
        feh = stars["FE_H"].to_numpy(float)
        mgfe = stars["MG_FE"].to_numpy(float)
        ok = np.isfinite(feh) & np.isfinite(mgfe)
        # integer chemistry-bin code: [Fe/H] in 0.1 dex x [Mg/Fe] in 0.04 dex
        code = np.full(len(stars), -1, dtype=np.int64)
        code[ok] = (np.floor(feh[ok] / 0.1).astype(np.int64) + 1000) * 10000 + \
                   (np.floor(mgfe[ok] / 0.04).astype(np.int64) + 1000)
        self.code = code
        K = self.kin.to_numpy(float)
        g = pd.DataFrame(K[ok], columns=KIN).groupby(code[ok])
        self.bin_n = g.size()
        self.bin_med = g.median()
        self.bin_mad = (1.4826 * (pd.DataFrame(K[ok], columns=KIN) - self.bin_med.loc[code[ok]].to_numpy())
                        .abs().groupby(code[ok]).median()).clip(lower=1e-3)
        med = self.bin_med.reindex(code).to_numpy()
        mad = self.bin_mad.reindex(code).to_numpy()
        n = self.bin_n.reindex(code).to_numpy()
        z = (K - med) / mad
        z[~(n >= 30)] = np.nan  # need a populated reference bin
        self.z = pd.DataFrame(z, columns=KIN, index=stars.index)
        # Teff vs Gaia BP-RP relation for cross-match diagnostics (low extinction stars)
        lo = ((stars["SFD_EBV"] < TEFF_COLOUR_EBV_MAX) & stars["bp_rp"].notna() & stars["TEFF"].notna()).to_numpy()
        coef = np.polyfit(stars["bp_rp"].to_numpy(float)[lo], stars["TEFF"].to_numpy(float)[lo], 3)
        resid = stars["TEFF"].to_numpy(float)[lo] - np.polyval(coef, stars["bp_rp"].to_numpy(float)[lo])
        self.teff_color_coef = coef
        self.teff_color_scatter = float(1.4826 * np.median(np.abs(resid - np.median(resid))))
        # chemistry-given-orbit: KD-tree in scaled orbit space
        okk = np.all(np.isfinite(K), axis=1)
        self.kin_idx = np.where(okk)[0]
        self.kin_scale = np.nanstd(K[okk], axis=0)
        self.tree = cKDTree(K[okk] / self.kin_scale)
        self.giant = stars["is_giant"].to_numpy(bool)
        self.X, self.E = chemistry.matrices(stars)

    def kinematic_zscores(self) -> pd.DataFrame:
        return self.z

    def quality(self, row: pd.Series) -> list[dict]:
        q = []
        def add(ok, name, detail, applicable=True):
            q.append({"check": name, "ok": bool(ok), "applicable": applicable, "detail": detail})
        add(row["ruwe"] < 1.4, "Gaia RUWE", f"RUWE = {row['ruwe']:.2f} (single-star astrometry fits well if < 1.4)")
        poe = row["parallax_corr"] / row["parallax_error"]
        add(poe > 10, "Parallax precision", f"parallax/error = {poe:.1f}")
        add(not row["flag_rv_variable"], "RV stability",
            f"APOGEE VSCATTER = {row['VSCATTER']:.2f} km/s over {int(row['NVISITS'])} visit(s)")
        add(not row["flag_single_visit"], "Multiple RV epochs", f"{int(row['NVISITS'])} APOGEE visit(s)")
        name = "Gaia colour vs APOGEE Teff (cross-match)"
        ebv = float(row["SFD_EBV"]) if np.isfinite(row.get("SFD_EBV", np.nan)) else np.nan
        if np.isfinite(row.get("bp_rp", np.nan)) and np.isfinite(ebv) and ebv < TEFF_COLOUR_EBV_MAX:
            dt = row["TEFF"] - np.polyval(self.teff_color_coef, row["bp_rp"])
            add(abs(dt) < 4 * self.teff_color_scatter, name,
                f"Teff - Teff(BP-RP) = {dt:+.0f} K (relation scatter {self.teff_color_scatter:.0f} K; "
                f"E(B-V)_SFD = {ebv:.2f})")
        else:
            add(True, name, "not tested: extinction too high or unknown for the colour-temperature relation "
                            f"(E(B-V)_SFD = {ebv:.2f}; relation calibrated for E(B-V) < {TEFF_COLOUR_EBV_MAX})",
                applicable=False)
        return q

    def explain(self, i: int) -> dict:
        row = self.stars.iloc[i]
        z = self.z.iloc[i]
        kin = []
        key = int(self.code[i])
        for c in KIN:
            if np.isfinite(z[c]):
                kin.append({"quantity": KIN_LABEL[c], "value": float(self.kin.iloc[i][c]),
                            "reference_median": float(self.bin_med.at[key, c]),
                            "reference_spread": float(self.bin_mad.at[key, c]),
                            "z": float(z[c])})
        # chemistry given orbit: 300 nearest stars in orbit space *of the same evolutionary class*
        # (ASPCAP abundances of dwarfs and giants differ systematically)
        chem = []
        pos = np.searchsorted(self.kin_idx, i)
        if pos < self.kin_idx.size and self.kin_idx[pos] == i:
            _, nn = self.tree.query(self.kin.to_numpy()[i] / self.kin_scale, k=min(3001, self.kin_idx.size))
            nn = self.kin_idx[np.asarray(nn)]
            nn = nn[(nn != i) & (self.giant[nn] == self.giant[i])][:300]
            for k, el in enumerate(chemistry.ELEMENTS):
                ref = self.X[nn, k]
                ref = ref[np.isfinite(ref)]
                if ref.size < 30 or not np.isfinite(self.X[i, k]):
                    continue
                med = np.median(ref)
                mad = max(1.4826 * np.median(np.abs(ref - med)), 1e-3)
                zz = (self.X[i, k] - med) / np.hypot(mad, self.E[i, k])
                chem.append({"element": C.CHEM_LABELS[el], "value": float(self.X[i, k]),
                             "error": float(self.E[i, k]), "reference_median": float(med),
                             "reference_spread": float(mad), "z": float(zz)})
        quality = self.quality(row)
        return {"source_id": str(row["source_id"]), "apogee_id": row["APOGEE_ID"],
                "kinematics_vs_chemical_twins": kin, "chemistry_vs_orbital_twins": chem,
                "quality": quality, "follow_up": follow_up(row, kin, chem, quality),
                "reference": {"kinematic": "stars in the same [Fe/H] (0.1 dex) x [Mg/Fe] (0.04 dex) bin, n = "
                              + str(int(self.bin_n.get(key, 0))) if key >= 0 else
                              "no [Fe/H]/[Mg/Fe] measurement: kinematic comparison unavailable",
                              "chemical": "300 nearest " + ("giants" if self.giant[i] else "dwarfs") +
                              " in (e, log z_max, L_z, sqrt J_R, sqrt J_z)"}}

    def scan(self, n: int = 50, min_z: float = 5.0) -> pd.DataFrame:
        za = self.z.abs()
        s = self.stars
        # quality gate: an unrecognised binary (single RV epoch) or poor parallax can fake a kinematic anomaly
        good = ((s["ruwe"] < 1.4) & (s["parallax_corr"] / s["parallax_error"] > 10)
                & ~s["flag_rv_variable"].astype(bool) & ~s["flag_single_visit"].astype(bool))
        score = za.max(axis=1)
        which = pd.Series(np.array(KIN)[np.argmax(za.fillna(-1.0).to_numpy(), axis=1)], index=s.index)
        out = pd.DataFrame({"source_id": s["source_id_str"], "score": score, "driver": which.map(KIN_LABEL),
                            "FE_H": s["FE_H"], "MG_FE": s["MG_FE"], "ecc": s["ecc"], "zmax": s["zmax"],
                            "Lz": s["Lz"], "good_quality": good})
        out = out[(out["score"] >= min_z) & out["good_quality"]].sort_values("score", ascending=False)
        return out.head(n)


def follow_up(row, kin, chem, quality) -> list[str]:
    s = []
    failed = {q["check"] for q in quality if not q["ok"]}
    if "Multiple RV epochs" in failed or "RV stability" in failed:
        s.append("Obtain additional radial-velocity epochs: an unrecognised binary orbit would bias the "
                 "space velocity and therefore every orbital quantity.")
    if "Gaia RUWE" in failed:
        s.append("RUWE > 1.4 suggests an unresolved companion; wait for Gaia DR4 epoch astrometry.")
    if "Parallax precision" in failed:
        s.append("Distance is the dominant orbital uncertainty; an independent (spectrophotometric or "
                 "asteroseismic) distance would test the anomaly.")
    if "Gaia colour vs APOGEE Teff (cross-match)" in failed:
        s.append("Gaia colour is inconsistent with the APOGEE temperature: verify the APOGEE-Gaia cross-match "
                 "(blend or mismatch) before interpreting the anomaly.")
    if any(abs(k["z"]) > 4 for k in kin):
        s.append("Kinematics are atypical for this chemistry: a high-resolution optical spectrum with "
                 "neutron-capture elements (Eu, Ba) could test an accreted or migrated origin.")
    if any(abs(c["z"]) > 4 for c in chem):
        s.append("Chemistry is atypical for this orbit: check for mass transfer (s-process or C enhancement) "
                 "and re-derive abundances with an independent pipeline (e.g. GALAH) before interpreting.")
    return s
