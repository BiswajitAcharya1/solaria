"""Step 1: build the APOGEE DR17 base table.

Reads the official APOGEE DR17 ``allStarLite`` catalogue, applies documented
quality cuts (``config.SELECTION``), attaches the row-matched astroNN value-added
catalogue (ages; Leung & Bovy 2019; Mackereth et al. 2019) and the OCCAM open
cluster membership VAC (Myers et al. 2022), and writes a Parquet cache.

The APOGEE DR17 catalogue already contains the Gaia EDR3 cross-match produced by
the APOGEE team (``GAIAEDR3_SOURCE_ID``).  Gaia DR3 astrometry is identical to
EDR3, so these identifiers are used directly to query Gaia DR3 in step 2.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from astropy.io import fits

from .. import config as C

KEEP = [
    "APOGEE_ID", "TELESCOPE", "FIELD", "RA", "DEC", "GLON", "GLAT", "J", "H", "K",
    "NVISITS", "SNR", "VHELIO_AVG", "VSCATTER", "VERR", "GAIAEDR3_SOURCE_ID",
    "GAIAEDR3_PARALLAX", "GAIAEDR3_PARALLAX_ERROR", "GAIAEDR3_PMRA", "GAIAEDR3_PMRA_ERROR",
    "GAIAEDR3_PMDEC", "GAIAEDR3_PMDEC_ERROR", "GAIAEDR3_PHOT_G_MEAN_MAG",
    "GAIAEDR3_PHOT_BP_MEAN_MAG", "GAIAEDR3_PHOT_RP_MEAN_MAG",
    "GAIAEDR3_R_MED_PHOTOGEO", "GAIAEDR3_R_LO_PHOTOGEO", "GAIAEDR3_R_HI_PHOTOGEO",
    "TEFF", "TEFF_ERR", "LOGG", "LOGG_ERR", "M_H", "ALPHA_M", "ASPCAPFLAG", "STARFLAG",
    "MEMBERFLAG", "MEMBER", "SFD_EBV",
]
ELEMENT_COLUMNS = ["FE_H", "MG_FE", "SI_FE", "CA_FE", "AL_FE", "MN_FE", "NI_FE", "O_FE", "K_FE",
                   "CR_FE", "C_FE", "N_FE", "TI_FE", "CE_FE"]


def _native(a: np.ndarray) -> np.ndarray:
    a = np.asarray(a)
    if a.dtype.kind in "SU":
        return np.asarray(np.char.strip(a.astype(str)), dtype=str)
    return a.astype(a.dtype.newbyteorder("="))


def build_apogee_base() -> pd.DataFrame:
    d = fits.getdata(C.APOGEE_ALLSTAR, 1)
    sel = C.SELECTION
    dup = (d["EXTRATARG"] & (1 << sel["exclude_extratarg_bits"]["DUPLICATE"])) > 0
    bad = (d["ASPCAPFLAG"] & (1 << sel["exclude_aspcapflag_bits"]["STAR_BAD"])) > 0
    plx, eplx = d["GAIAEDR3_PARALLAX"], d["GAIAEDR3_PARALLAX_ERROR"]
    with np.errstate(invalid="ignore", divide="ignore"):
        poe = plx / eplx
    t0, t1 = sel["teff_range_K"]
    mask = (
        (~dup) & (~bad) & (d["GAIAEDR3_SOURCE_ID"] > 0) & (d["SNR"] > sel["apogee_snr_min"])
        & (d["TEFF"] > t0) & (d["TEFF"] < t1) & np.isfinite(d["FE_H"])
        & np.isfinite(d["VHELIO_AVG"]) & (poe > sel["parallax_over_error_min"])
    )
    idx = np.where(mask)[0]
    cols = {k: _native(d[k][idx]) for k in KEEP}
    for el in ELEMENT_COLUMNS:
        v = _native(d[el][idx]).astype("f4")
        e = _native(d[el + "_ERR"][idx]).astype("f4")
        flag = _native(d[el + "_FLAG"][idx]) if el != "FE_H" else _native(d["FE_H_FLAG"][idx])
        bad_el = (flag != 0) | ~np.isfinite(v) | ~np.isfinite(e) | (e <= 0)
        v[bad_el] = np.nan
        e[bad_el] = np.nan
        cols[el] = v
        cols[el + "_ERR"] = e
    df = pd.DataFrame(cols)
    df["row_allstar"] = idx

    # astroNN VAC is row-matched to allStar; verify before trusting it.
    nn = fits.getdata(C.APOGEE_ASTRONN, 1)
    ids_nn = np.char.strip(nn["APOGEE_ID"][idx].astype(str))
    same = np.asarray(ids_nn, dtype=str) == df["APOGEE_ID"].to_numpy(dtype=str)
    if same.mean() < 0.9999:
        raise RuntimeError("astroNN VAC is not row-matched to allStarLite; refusing to merge")
    df["age_gyr"] = _native(nn["age_lowess_correct"][idx]).astype("f4")
    df["age_err_gyr"] = _native(nn["age_total_error"][idx]).astype("f4")
    bad_age = ~np.isfinite(df["age_gyr"]) | (df["age_gyr"] <= 0) | ~same
    df.loc[bad_age, ["age_gyr", "age_err_gyr"]] = np.nan

    # OCCAM open-cluster membership (Myers et al. 2022).  Keep the
    # Cantat-Gaudin et al. (2018/2020) Gaia membership probability and the
    # OCCAM RV / [Fe/H] / PM probabilities.
    occ = fits.getdata(C.OCCAM_MEMBERS, 1)
    occ_df = pd.DataFrame({
        "APOGEE_ID": np.char.strip(occ["APOGEE_ID"].astype(str)),
        "occam_cluster": np.char.strip(occ["CLUSTER"].astype(str)),
        "occam_cg_prob": _native(occ["CG_PROB"]).astype("f4"),
        "occam_rv_prob": _native(occ["RV_PROB"]).astype("f4"),
        "occam_feh_prob": _native(occ["FEH_PROB"]).astype("f4"),
        "occam_pm_prob": _native(occ["PM_PROB"]).astype("f4"),
    })
    # one row per star: keep the highest Cantat-Gaudin probability
    occ_df = occ_df.sort_values("occam_cg_prob", ascending=False).drop_duplicates("APOGEE_ID")
    df = df.merge(occ_df, on="APOGEE_ID", how="left")
    df = df.drop_duplicates("GAIAEDR3_SOURCE_ID").reset_index(drop=True)
    df = df.rename(columns={"GAIAEDR3_SOURCE_ID": "source_id"})
    return df


def main() -> None:
    C.CACHE.mkdir(parents=True, exist_ok=True)
    df = build_apogee_base()
    df.to_parquet(C.APOGEE_PARQUET, index=False)
    print(f"APOGEE base table: {len(df)} stars -> {C.APOGEE_PARQUET}")


if __name__ == "__main__":
    main()
