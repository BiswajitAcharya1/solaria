"""Step 6: known star clusters and moving groups.

Hunt & Reffert (2023, A&A 673, A114; VizieR J/A+A/673/A114/clusters): 7167
clusters and moving groups detected with HDBSCAN in Gaia DR3, with mean
astrometry, radial velocities (where Gaia RVs of members exist), radii and
CMD-based ages from a neural network.  Used (a) to label candidate groups that
resemble known populations and (b) as targets for ejection / encounter tests.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from astropy import units as u
from astropy.coordinates import SkyCoord
from astropy.table import Table

from .. import config as C

SRC = C.RAW / "hunt_reffert_2023_clusters.fits"


def main() -> None:
    t = Table.read(SRC)
    keep = ["Name", "ID", "AllNames", "Type", "CST", "N", "RA_ICRS", "DE_ICRS", "GLON", "GLAT",
            "r50pc", "rtpc", "pmRA", "e_pmRA", "s_pmRA", "pmDE", "e_pmDE", "s_pmDE", "Plx", "e_Plx",
            "dist16", "dist50", "dist84", "X", "Y", "Z", "RV", "e_RV", "s_RV", "n_RV",
            "logAge16", "logAge50", "logAge84", "CMDCl50"]
    df = t[keep].to_pandas()
    for c in ("Name", "AllNames", "Type"):
        df[c] = df[c].astype(str).str.strip()
    has_rv = np.isfinite(df["RV"].to_numpy(float)) & (df["n_RV"].fillna(0).to_numpy() > 0)
    c = SkyCoord(ra=df["RA_ICRS"].to_numpy() * u.deg, dec=df["DE_ICRS"].to_numpy() * u.deg,
                 distance=df["dist50"].to_numpy() * u.pc,
                 pm_ra_cosdec=df["pmRA"].to_numpy() * u.mas / u.yr, pm_dec=df["pmDE"].to_numpy() * u.mas / u.yr,
                 radial_velocity=np.where(has_rv, df["RV"].to_numpy(float), 0.0) * u.km / u.s).galactic
    v = c.cartesian.differentials["s"]
    df["U"] = np.where(has_rv, v.d_x.to_value(u.km / u.s), np.nan)
    df["V"] = np.where(has_rv, v.d_y.to_value(u.km / u.s), np.nan)
    df["W"] = np.where(has_rv, v.d_z.to_value(u.km / u.s), np.nan)
    df["Xh"] = c.cartesian.x.to_value(u.pc)
    df["Yh"] = c.cartesian.y.to_value(u.pc)
    df["Zh"] = c.cartesian.z.to_value(u.pc)
    df["age_myr"] = 10 ** (df["logAge50"] - 6)
    df.to_parquet(C.CLUSTERS_PARQUET, index=False)
    print(f"HR23 clusters: {len(df)} ({has_rv.sum()} with mean RV) -> {C.CLUSTERS_PARQUET}")


if __name__ == "__main__":
    main()
