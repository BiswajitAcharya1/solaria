"""Step 4: constellation stars.

* Figures: Stellarium "modern" sky culture line figures (HIP identifiers;
  github.com/Stellarium/stellarium, skycultures/modern/index.json, GPL-2.0).
* Astrometry: Gaia DR3 (via the official ``hipparcos2_best_neighbour``
  cross-match) when it is more precise than the Hipparcos new reduction
  (van Leeuwen 2007, VizieR I/311); otherwise Hipparcos.  Many of the brightest
  stars (G < 3) are absent from or poorly measured by Gaia.
* Radial velocities: Gaia DR3 when available, else the XHIP compilation
  (Anderson & Francis 2012, VizieR V/137D), which also provides compiled
  [Fe/H], ages and literature group memberships.  XHIP values are heterogeneous
  literature compilations and are labelled as such throughout the app.
"""
from __future__ import annotations

import json

import numpy as np
import pandas as pd
import pyvo
from astropy.table import Table
from astroquery.vizier import Vizier

from .. import config as C

STELLARIUM = C.RAW / "stellarium_modern_index.json"


def _vizier(cat: str, hips: list[int], cols: list[str]) -> pd.DataFrame:
    v = Vizier(row_limit=-1, columns=cols)
    parts = []
    for i in range(0, len(hips), 200):
        r = v.query_constraints(catalog=cat, HIP="=," + ",".join(str(h) for h in hips[i:i + 200]))
        if len(r):
            parts.append(r[0].to_pandas())
    return pd.concat(parts, ignore_index=True)


def main() -> None:
    sc = json.loads(STELLARIUM.read_text())
    figures = []
    hips: set[int] = set()
    for c in sc["constellations"]:
        abbr = c["id"].split()[-1]
        lines = [[int(h) for h in seg] for seg in c["lines"]]
        for seg in lines:
            hips.update(seg)
        figures.append({"abbr": abbr, "name": c["common_name"].get("native", abbr),
                        "english": c["common_name"].get("english", ""), "lines": lines})
    hips_l = sorted(hips)
    names = {int(k.split()[1]): v[0]["english"] for k, v in sc.get("common_names", {}).items()
             if k.startswith("HIP ")}

    hip = _vizier("I/311/hip2", hips_l, ["HIP", "RArad", "DErad", "Plx", "e_Plx", "pmRA", "e_pmRA",
                                           "pmDE", "e_pmDE", "Hpmag", "B-V"])
    xhip = _vizier("V/137D/XHIP", hips_l, ["HIP", "RV", "e_RV", "q_RV", "[Fe/H]", "e_[Fe/H]", "age",
                                            "b_age", "B_age", "SpType", "Vmag", "r_RV", "r_[Fe/H]"])
    xhip = xhip.rename(columns={"[Fe/H]": "feh_xhip", "e_[Fe/H]": "e_feh_xhip", "RV": "rv_xhip",
                                "e_RV": "e_rv_xhip", "age": "age_xhip", "b_age": "age_lo_xhip",
                                "B_age": "age_hi_xhip", "r_RV": "r_rv_xhip", "r_[Fe/H]": "r_feh_xhip"})
    df = hip.merge(xhip, on="HIP", how="left")
    # XHIP literature group memberships: the GrpName column is a variable-length
    # array that astroquery's VOTable parser masks, so fetch it as text via TAP.
    vt = pyvo.dal.TAPService("https://tapvizier.cds.unistra.fr/TAPVizieR/tap")
    grp = vt.run_sync(f'SELECT HIP, GrpName FROM "V/137D/XHIP" WHERE HIP IN ({",".join(map(str, hips_l))})',
                      maxrec=5000, timeout=120).to_table().to_pandas()
    grp["GrpName"] = grp["GrpName"].astype(str).str.strip().replace({"": None, "--": None, "nan": None})
    df = df.merge(grp[["HIP", "GrpName"]], on="HIP", how="left")

    svc = pyvo.dal.TAPService("https://gaia.aip.de/tap")
    up = Table({"hip": np.array(hips_l, dtype=np.int64)})
    # The official Gaia DR3 <-> Hipparcos-2 best-neighbour table selects the
    # Gaia sources.  The AIP mirror returns a truncated original_ext_source_id
    # column, so each Gaia source is mapped back to its HIP number by position
    # (Hipparcos J1991.25 position propagated to Gaia epoch J2016.0, < 2").
    del up
    q = f"""SELECT g.source_id, g.ra, g.dec, g.parallax, g.parallax_error,
                  g.pmra, g.pmra_error, g.pmdec, g.pmdec_error, g.parallax_pmra_corr, g.parallax_pmdec_corr,
                  g.pmra_pmdec_corr, g.ruwe, g.phot_g_mean_mag, g.radial_velocity, g.radial_velocity_error
           FROM gaiadr3.hipparcos2_best_neighbour AS x JOIN gaiadr3.gaia_source AS g ON g.source_id = x.source_id
           WHERE x.original_ext_source_id IN ({",".join(map(str, hips_l))})"""
    gaia = svc.run_sync(q, maxrec=10000).to_table().to_pandas()
    dt = 2016.0 - 1991.25
    ra_h = df["RArad"].to_numpy() + df["pmRA"].to_numpy() * dt / 3.6e6 / np.cos(np.radians(df["DErad"].to_numpy()))
    de_h = df["DErad"].to_numpy() + df["pmDE"].to_numpy() * dt / 3.6e6
    from astropy import units as u
    from astropy.coordinates import SkyCoord
    ch = SkyCoord(ra_h * u.deg, de_h * u.deg)
    cg = SkyCoord(gaia["ra"].to_numpy() * u.deg, gaia["dec"].to_numpy() * u.deg)
    idx, sep, _ = cg.match_to_catalog_sky(ch)
    gaia["HIP"] = np.where(sep.arcsec < 2.0, df["HIP"].to_numpy()[idx], -1)
    gaia = gaia[gaia["HIP"] > 0].sort_values("phot_g_mean_mag").drop_duplicates("HIP")
    gaia = gaia.add_prefix("g_").rename(columns={"g_HIP": "HIP"})
    df = df.merge(gaia, on="HIP", how="left")

    # choose astrometry: Gaia DR3 if RUWE<1.4 and its parallax is more precise
    use_gaia = (df["g_ruwe"] < 1.4) & (df["g_parallax_error"] < df["e_Plx"]) & df["g_parallax"].notna()
    df["astrometry_source"] = np.where(use_gaia, "Gaia DR3", "Hipparcos (van Leeuwen 2007)")
    df["ra"] = np.where(use_gaia, df["g_ra"], df["RArad"])
    df["dec"] = np.where(use_gaia, df["g_dec"], df["DErad"])
    for a, b, h in (("parallax", "g_parallax", "Plx"), ("parallax_error", "g_parallax_error", "e_Plx"),
                    ("pmra", "g_pmra", "pmRA"), ("pmra_error", "g_pmra_error", "e_pmRA"),
                    ("pmdec", "g_pmdec", "pmDE"), ("pmdec_error", "g_pmdec_error", "e_pmDE")):
        df[a] = np.where(use_gaia, df[b], df[h])
    for k in ("parallax_pmra_corr", "parallax_pmdec_corr", "pmra_pmdec_corr"):
        df[k] = np.where(use_gaia, df["g_" + k], 0.0)
    has_grv = df["g_radial_velocity"].notna()
    df["rv"] = np.where(has_grv, df["g_radial_velocity"], df["rv_xhip"])
    df["rv_error"] = np.where(has_grv, df["g_radial_velocity_error"], df["e_rv_xhip"])
    df["rv_source"] = np.where(has_grv, "Gaia DR3", np.where(df["rv_xhip"].notna(), "XHIP compilation", "none"))
    df["name"] = df["HIP"].map(names)
    df = df[df["parallax"] > 0]
    out = {
        "figures": figures,
        "stars": json.loads(df.to_json(orient="records")),
        "sources": {
            "figures": "Stellarium modern sky culture (GPL-2.0)",
            "astrometry": "Gaia DR3 via gaiadr3.hipparcos2_best_neighbour (Gaia@AIP TAP) / Hipparcos-2 (VizieR I/311)",
            "rv_metallicity_age": "XHIP, Anderson & Francis 2012 (VizieR V/137D) - literature compilation",
        },
    }
    C.CONSTELLATIONS_JSON.write_text(json.dumps(out))
    print(f"constellations: {len(figures)} figures, {len(df)} stars "
          f"({use_gaia.sum()} Gaia astrometry, {has_grv.sum()} Gaia RVs, {df['rv'].notna().sum()} with any RV)")


if __name__ == "__main__":
    main()
