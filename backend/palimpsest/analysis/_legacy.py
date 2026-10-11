"""Legacy functions from the original analysis.py - kept for API compatibility."""
from __future__ import annotations

import hashlib
import json
import time

import numpy as np
import pandas as pd
from scipy import stats

from .. import anomalies, chemistry, constellations, families, merger, orbits, traceback
from .. import config as C
from ..store import STORE

VERSION = "0.1.0"
MAX_DISCOVERY_STARS = 30_000


def _f(x):
    try:
        x = float(x)
    except (TypeError, ValueError):
        return None
    return x if np.isfinite(x) else None


def provenance(params: dict) -> dict:
    p = {
        "software": f"Palimpsest {VERSION}",
        "timestamp_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "data": {
            "astrometry": "Gaia DR3 (gaiadr3.gaia_source via Gaia@AIP TAP mirror)",
            "spectroscopy": "SDSS-IV APOGEE DR17 allStarLite-dr17-synspec_rev1",
            "cross_match": "APOGEE DR17 GAIAEDR3_SOURCE_ID",
            "ages": "APOGEE DR17 astroNN VAC",
            "cluster_membership": "APOGEE DR17 OCCAM VAC; Hunt & Reffert 2023",
            "independent_abundances": "GALAH DR4 allstar_240705",
        },
        "selection": C.SELECTION,
        "parallax_zero_point": "Lindegren et al. 2021 recipe; -0.017 mas where undefined",
        "solar_motion_UVW_kms": C.SOLAR_MOTION_UVW,
        "solar_height_kpc": C.SOLAR_Z_KPC,
        "chemistry_elements": C.CHEM_ELEMENTS,
        "chemistry_floor_dex": {c: dict(zip(C.CHEM_ELEMENTS, map(float, chemistry.default_floor(c))))
                                for c in chemistry.CLASSES},
        "parameters": params,
    }
    p["hash"] = hashlib.sha1(json.dumps(params, sort_keys=True, default=str).encode()).hexdigest()[:12]
    return p


def _row_out(r: pd.Series) -> dict:
    meas = {
        "ra_deg": _f(r["ra"]), "dec_deg": _f(r["dec"]),
        "parallax_mas": _f(r["parallax"]), "parallax_error_mas": _f(r["parallax_error"]),
        "parallax_zero_point_mas": _f(r["zpt_used"]),
        "pmra_masyr": _f(r["pmra"]), "pmra_error": _f(r["pmra_error"]),
        "pmdec_masyr": _f(r["pmdec"]), "pmdec_error": _f(r["pmdec_error"]),
        "pmra_pmdec_corr": _f(r["pmra_pmdec_corr"]), "parallax_pmra_corr": _f(r["parallax_pmra_corr"]),
        "parallax_pmdec_corr": _f(r["parallax_pmdec_corr"]),
        "rv_apogee_kms": _f(r["rv"]), "rv_error_kms": _f(r["rv_error"]),
        "rv_gaia_kms": _f(r["radial_velocity"]), "rv_gaia_error_kms": _f(r["radial_velocity_error"]),
        "apogee_nvisits": int(r["NVISITS"]), "apogee_vscatter_kms": _f(r["VSCATTER"]),
        "ruwe": _f(r["ruwe"]), "G": _f(r["phot_g_mean_mag"]), "bp_rp": _f(r["bp_rp"]),
        "H_2mass": _f(r["H"]), "teff_K": _f(r["TEFF"]), "logg": _f(r["LOGG"]), "snr": _f(r["SNR"]),
    }
    abund = [{"element": C.CHEM_LABELS[el], "key": el, "value": _f(r[el]), "error": _f(r[el + "_ERR"]),
              "galah": _f(r.get("galah_" + el)), "galah_error": _f(r.get("galah_" + el + "_ERR"))}
             for el in C.CHEM_ELEMENTS]
    derived = {
        "distance_pc": _f(r["dist_pc"]),
        "X_pc": _f(r["X"]), "Y_pc": _f(r["Y"]), "Z_pc": _f(r["Z"]),
        "U_kms": _f(r["U"]), "V_kms": _f(r["V"]), "W_kms": _f(r["W"]),
        "R_gal_kpc": _f(r["R"]), "z_gal_kpc": _f(r["z"]), "v_phi_kms": _f(r["vT"]),
        "E_kms2": _f(r["E"]), "Lz_kpckms": _f(r["Lz"]), "J_R_kpckms": _f(r["J_R"]), "J_z_kpckms": _f(r["J_z"]),
        "eccentricity": _f(r["ecc"]), "zmax_kpc": _f(r["zmax"]), "rperi_kpc": _f(r["rperi"]),
        "rapo_kpc": _f(r["rap"]),
        "age_astroNN_gyr": _f(r["age_gyr"]) if r["is_giant"] else None,
        "age_astroNN_error_gyr": _f(r["age_err_gyr"]) if r["is_giant"] else None,
    }
    return {"source_id": str(r["source_id"]), "apogee_id": r["APOGEE_ID"], "measured": meas,
            "abundances": abund, "derived": derived,
            "occam": {"cluster": r["occam_cluster"] if isinstance(r["occam_cluster"], str) else None,
                      "cg_prob": _f(r["occam_cg_prob"])},
            "flags": {"rv_variable": bool(r["flag_rv_variable"]), "single_visit": bool(r["flag_single_visit"]),
                      "giant": bool(r["is_giant"])}}


_ANOM = None


def anomaly_model():
    global _ANOM
    if _ANOM is None:
        _ANOM = anomalies.AnomalyModel(STORE.stars)
    return _ANOM


def star_detail(source_id: int) -> dict:
    i = STORE.index_of([source_id])[0]
    r = STORE.stars.iloc[i]
    out = _row_out(r)
    out["merger_test"] = merger.star_test(r)
    out["anomaly"] = anomaly_model().explain(i)
    out["data_sources"] = provenance({})["data"]
    return out


def search(q: str, limit: int = 20) -> list[dict]:
    s = STORE.stars
    q = q.strip()
    if q.isdigit():
        m = s["source_id_str"].str.startswith(q)
    else:
        m = s["APOGEE_ID"].str.contains(q, case=False, regex=False) | \
            s["occam_cluster"].fillna("").str.contains(q, case=False, regex=False)
    r = s[m].head(limit)
    return [{"source_id": a, "apogee_id": b, "cluster": c if isinstance(c, str) else None, "dist_pc": float(d),
             "feh": _f(f)} for a, b, c, d, f in zip(r["source_id_str"], r["APOGEE_ID"], r["occam_cluster"],
                                                      r["dist_pc"], r["FE_H"])]


def orbit_history(source_ids: list[int], lookback_myr: float = C.DEFAULT_LOOKBACK_MYR, n_mc: int = 32,
                  potentials: list[str] | None = None, n_out_samples: int = 12) -> dict:
    lookback_myr = float(min(abs(lookback_myr), C.MAX_LOOKBACK_MYR))
    potentials = potentials or [C.DEFAULT_POTENTIAL]
    df = STORE.stars.iloc[STORE.index_of(source_ids)]
    res = {"source_ids": [str(s) for s in df["source_id"]], "lookback_myr": lookback_myr, "n_mc": n_mc,
           "runs": {}}
    step = 2
    for pot in potentials:
        tb = traceback.trajectories(df, lookback_myr, n_mc, pot)
        xyz = tb.xyz_pc
        spread = np.linalg.norm(xyz - xyz[:, :1], axis=-1)
        stars_out = []
        for k in range(len(df)):
            stars_out.append({
                "source_id": str(df["source_id"].iloc[k]),
                "nominal": np.round(xyz[k, 0, ::step], 2).tolist(),
                "samples": np.round(xyz[k, 1:n_out_samples + 1, ::step], 2).tolist(),
                "spread_pc_p50": np.round(np.median(spread[k], axis=0)[::step], 2).tolist(),
                "spread_pc_p84": np.round(np.percentile(spread[k], 84, axis=0)[::step], 2).tolist(),
                "galcen_nominal_kpc": np.round(tb.galcen_xyz_kpc[k, 0, ::step], 4).tolist(),
            })
        res["runs"][pot] = {"times_myr": tb.times_myr[::step].tolist(), "stars": stars_out,
                            "sun_galcen_kpc": np.round(tb.sun_galcen_kpc[::step], 4).tolist(),
                            "ro_kpc": tb.ro, "vo_kms": tb.vo}
    if len(potentials) > 1:
        a, b = potentials[:2]
        diffs = []
        for sa, sb in zip(res["runs"][a]["stars"], res["runs"][b]["stars"]):
            d = np.linalg.norm(np.array(sa["nominal"]) - np.array(sb["nominal"]), axis=-1)
            diffs.append({"source_id": sa["source_id"], "separation_pc": np.round(d, 2).tolist()})
        res["potential_difference"] = {"between": [a, b], "stars": diffs}
    res["caveats"] = [
        "Positions are in a frame centred on the Sun and co-rotating with the Sun's own (integrated) orbit.",
        "The Galactic potential is static and axisymmetric: the bar, spiral arms, molecular clouds and "
        "the Sagittarius dwarf are not modelled; their perturbations grow with look-back time.",
        "Monte Carlo spread reflects measurement uncertainty only (Gaia astrometry with covariances, "
        "APOGEE RV); model uncertainty is explored by switching the potential.",
    ]
    res["provenance"] = provenance({"op": "orbit_history", "source_ids": res["source_ids"],
                                    "lookback_myr": lookback_myr, "n_mc": n_mc, "potentials": potentials})
    return res


def chemical_neighbours(source_id: int, n: int = 25, same_class: bool = True) -> dict:
    s = STORE.stars
    X, E = STORE.chem
    i = STORE.index_of([source_id])[0]
    n_meas = int(np.isfinite(X[i]).sum())
    if n_meas < 6:
        return {"source_id": str(source_id), "neighbours": [], "n_compared": 0, "n_indistinguishable_p05": 0,
                "interpretation": f"This star has only {n_meas} reliably measured elements; at least 6 are "
                                  "required for a meaningful chemical comparison."}
    klass = str(chemistry.star_class(s["LOGG"].iloc[i]))
    chi2, dof, p, terms = chemistry.pair_chi2(X[i], E[i], X, E, chemistry.default_floor(klass))
    valid = dof >= 6
    valid[i] = False
    if same_class:
        valid &= (s["is_giant"] == s["is_giant"].iloc[i]).to_numpy()
    red = np.where(valid, chi2 / np.maximum(dof, 1), np.inf)
    order = np.argsort(red)[:n]
    n_indist = int(np.sum(valid & (p > 0.05)))
    rows = []
    for j in order:
        rows.append({"source_id": str(s["source_id"].iloc[j]), "chi2": float(chi2[j]), "dof": int(dof[j]),
                     "p_value": float(p[j]), "dist_pc": float(s["dist_pc"].iloc[j]),
                     "separation_pc": float(np.linalg.norm(s[["X", "Y", "Z"]].iloc[j].to_numpy() -
                                                            s[["X", "Y", "Z"]].iloc[i].to_numpy())),
                     "dv_kms": float(np.linalg.norm(s[["U", "V", "W"]].iloc[j].to_numpy() -
                                                    s[["U", "V", "W"]].iloc[i].to_numpy())),
                     "terms": {el: _f(t) for el, t in zip(C.CHEM_ELEMENTS, terms[j])}})
    return {"source_id": str(source_id), "neighbours": rows, "n_compared": int(valid.sum()),
            "n_indistinguishable_p05": n_indist,
            "interpretation": (f"{n_indist} of {int(valid.sum())} comparable stars are chemically "
                               "indistinguishable from this star at p > 0.05. Chemistry alone therefore cannot "
                               "identify siblings in a large survey (the 'chemical doppelganger' problem, "
                               "Ness et al. 2018); dynamical evidence is required.")}


def merger_summary() -> dict:
    return merger.population_summary(STORE.stars)


def constellation_overview() -> list[dict]:
    return constellations.overview(STORE.constellations)


def constellation_detail(abbr: str) -> dict:
    return constellations.figure_analysis(STORE.constellations, abbr)


def constellation_traceback(abbr: str, lookback_myr: float = 5.0, n_mc: int = 32) -> dict:
    data = constellations.figure_analysis(STORE.constellations, abbr)
    df = pd.DataFrame(data["stars"])
    df = df[df["rv"].notna() & df["parallax"].notna()].reset_index(drop=True)
    df["rv_error"] = df["rv_error"].fillna(2.0).clip(lower=0.1)
    for k in ("parallax_pmra_corr", "parallax_pmdec_corr", "pmra_pmdec_corr"):
        df[k] = df[k].fillna(0.0)
    df["zpt_used"] = np.where(df["astrometry_source"].str.startswith("Gaia"), orbits.PARALLAX_ZERO_POINT_MAS, 0.0)
    tb = traceback.trajectories(df, lookback_myr, n_mc, C.DEFAULT_POTENTIAL, n_times=101)
    return {"abbr": abbr, "times_myr": tb.times_myr[::2].tolist(),
            "stars": [{"HIP": int(h), "nominal": np.round(tb.xyz_pc[k, 0, ::2], 2).tolist(),
                       "spread_pc_p84": np.round(
                           np.percentile(np.linalg.norm(tb.xyz_pc[k] - tb.xyz_pc[k, :1], axis=-1), 84, axis=0)[::2], 2
                       ).tolist()}
                      for k, h in enumerate(df["HIP"])]}