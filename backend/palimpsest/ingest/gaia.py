"""Step 2: retrieve Gaia DR3 astrometry, covariances and quality indicators.

Uses a TAP upload join on the APOGEE-provided Gaia (E)DR3 source identifiers.
Primary service: the Gaia@AIP mirror of ``gaiadr3.gaia_source`` (identical
content to the ESA archive, much faster for anonymous upload joins).  The ESA
archive is used as a fallback.  The parallax zero-point is computed with the
official Lindegren et al. (2021) recipe (``gaiadr3-zeropoint`` package).
"""
from __future__ import annotations

import time

import numpy as np
import pandas as pd
import pyvo
from astropy.table import Table

from .. import config as C

SERVICES = [
    ("Gaia@AIP", "https://gaia.aip.de/tap", "gaiadr3.gaia_source"),
    ("ESA Gaia Archive", "https://gea.esac.esa.int/tap-server/tap", "gaiadr3.gaia_source"),
]
COLUMNS = [
    "source_id", "ra", "dec", "ra_error", "dec_error", "parallax", "parallax_error",
    "pmra", "pmra_error", "pmdec", "pmdec_error", "ra_dec_corr", "ra_parallax_corr",
    "ra_pmra_corr", "ra_pmdec_corr", "dec_parallax_corr", "dec_pmra_corr", "dec_pmdec_corr",
    "parallax_pmra_corr", "parallax_pmdec_corr", "pmra_pmdec_corr", "ruwe",
    "phot_g_mean_mag", "phot_bp_mean_mag", "phot_rp_mean_mag", "bp_rp",
    "radial_velocity", "radial_velocity_error", "nu_eff_used_in_astrometry", "pseudocolour",
    "ecl_lat", "astrometric_params_solved",
]
CHUNK = 40000


def query_chunk(ids: np.ndarray) -> tuple[pd.DataFrame, str]:
    t = Table({"source_id": ids.astype(np.int64)})
    cols = ", ".join("g." + c for c in COLUMNS)
    last = None
    for name, url, table in SERVICES:
        for attempt in range(3):
            try:
                svc = pyvo.dal.TAPService(url)
                q = f"SELECT {cols} FROM TAP_UPLOAD.ids AS u JOIN {table} AS g ON g.source_id = u.source_id"
                r = svc.run_sync(q, uploads={"ids": t}, maxrec=len(ids) + 10, timeout=600)
                return r.to_table().to_pandas(), name
            except Exception as e:  # network / service error: retry then fall back
                last = e
                time.sleep(5 * (attempt + 1))
    raise RuntimeError(f"all Gaia TAP services failed: {last!r}")


def add_zero_point(df: pd.DataFrame) -> pd.DataFrame:
    from zero_point import zpt

    zpt.load_tables()
    zp = np.full(len(df), np.nan)
    sol = df["astrometric_params_solved"].to_numpy()
    nu = df["nu_eff_used_in_astrometry"].to_numpy(float)
    pc = df["pseudocolour"].to_numpy(float)
    g = df["phot_g_mean_mag"].to_numpy(float)
    ok = (sol > 3) & np.isfinite(g) & (g > 6) & (g < 21)
    ok &= np.where(sol == 31, np.isfinite(nu) & (nu > 1.1) & (nu < 1.9), np.isfinite(pc) & (pc > 1.24) & (pc < 1.72))
    zp[ok] = zpt.get_zpt(g[ok], nu[ok], pc[ok], df["ecl_lat"].to_numpy(float)[ok], sol[ok], _warnings=False)
    df["zpt_l21"] = zp
    return df


def main() -> None:
    base = pd.read_parquet(C.APOGEE_PARQUET, columns=["source_id"])
    ids = base["source_id"].to_numpy(np.int64)
    parts, used = [], set()
    for i in range(0, len(ids), CHUNK):
        t0 = time.time()
        df, svc = query_chunk(ids[i:i + CHUNK])
        parts.append(df)
        used.add(svc)
        print(f"  rows {i}-{i + len(df)} from {svc} in {time.time() - t0:.1f}s", flush=True)
    gaia = pd.concat(parts, ignore_index=True).drop_duplicates("source_id")
    gaia = add_zero_point(gaia)
    gaia.attrs["services"] = sorted(used)
    gaia.to_parquet(C.GAIA_PARQUET, index=False)
    print(f"Gaia DR3: {len(gaia)} / {len(ids)} sources -> {C.GAIA_PARQUET} (services: {sorted(used)})")


if __name__ == "__main__":
    main()
