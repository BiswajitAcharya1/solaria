"""Step 3: derive present-day phase-space coordinates and orbital integrals.

* Joins APOGEE (chemistry, RVs) with Gaia DR3 (astrometry, covariances, RUWE).
* Applies the Lindegren et al. (2021) parallax zero-point (global -0.017 mas
  where the recipe is undefined) and the RUWE cut.
* Computes heliocentric Galactic positions (X,Y,Z) and velocities (U,V,W) with
  astropy, and Galactocentric orbital integrals (E, Lz, J_R, J_z, eccentricity,
  z_max, pericentre, apocentre) with galpy in the McMillan (2017) potential.
"""
from __future__ import annotations

import time

import numpy as np
import pandas as pd
from astropy import units as u
from astropy.coordinates import SkyCoord

from .. import config as C
from .. import orbits

def heliocentric_cartesian(df: pd.DataFrame) -> pd.DataFrame:
    c = SkyCoord(ra=df["ra"].to_numpy() * u.deg, dec=df["dec"].to_numpy() * u.deg,
                 distance=df["dist_pc"].to_numpy() * u.pc,
                 pm_ra_cosdec=df["pmra"].to_numpy() * u.mas / u.yr,
                 pm_dec=df["pmdec"].to_numpy() * u.mas / u.yr,
                 radial_velocity=df["rv"].to_numpy() * u.km / u.s, frame="icrs").galactic
    cart = c.cartesian
    vel = cart.differentials["s"]
    df["X"] = cart.x.to_value(u.pc)
    df["Y"] = cart.y.to_value(u.pc)
    df["Z"] = cart.z.to_value(u.pc)
    df["U"] = vel.d_x.to_value(u.km / u.s)
    df["V"] = vel.d_y.to_value(u.km / u.s)
    df["W"] = vel.d_z.to_value(u.km / u.s)
    df["l"] = c.l.deg
    df["b"] = c.b.deg
    return df


def _orbit_chunk(args):
    ra, dec, d_kpc, pmra, pmdec, rv = args
    o = orbits.make_orbit(ra, dec, d_kpc, pmra, pmdec, rv, C.DEFAULT_POTENTIAL)
    out = orbits.orbital_parameters(o, C.DEFAULT_POTENTIAL)
    out["R"] = np.asarray(o.R(), float)
    out["phi"] = np.asarray(o.phi(), float)
    out["z"] = np.asarray(o.z(), float)
    out["vR"] = np.asarray(o.vR(), float)
    out["vT"] = np.asarray(o.vT(), float)
    out["vz"] = np.asarray(o.vz(), float)
    return out


def galactocentric(df: pd.DataFrame, chunk: int = 20000) -> pd.DataFrame:
    cols = [df[c].to_numpy(float) for c in ("ra", "dec")] + [df["dist_pc"].to_numpy(float) / 1000.0] + \
           [df[c].to_numpy(float) for c in ("pmra", "pmdec", "rv")]
    tasks = [tuple(a[i:i + chunk] for a in cols) for i in range(0, len(df), chunk)]
    t0 = time.time()
    orbits.get_potential()
    # serial: galpy's C action solver handles ~5k stars/s; a fork-based pool
    # deadlocks on OpenMP state inherited from the parent.
    res = [_orbit_chunk(t) for t in tasks]
    print(f"  orbital integrals for {len(df)} stars in {time.time() - t0:.0f}s", flush=True)
    for k in res[0]:
        df[k] = np.concatenate([r[k] for r in res])
    return df


def main() -> None:
    a = pd.read_parquet(C.APOGEE_PARQUET)
    g = pd.read_parquet(C.GAIA_PARQUET)
    df = a.merge(g, on="source_id", how="inner")
    n0 = len(df)
    sel = C.SELECTION
    zp = df["zpt_l21"].to_numpy(float)
    df["zpt_used"] = np.where(np.isfinite(zp), zp, orbits.PARALLAX_ZERO_POINT_MAS)
    df["parallax_corr"] = df["parallax"] - df["zpt_used"]
    keep = (df["ruwe"] < sel["ruwe_max"]) & (df["parallax_corr"] / df["parallax_error"] > sel["parallax_over_error_min"])
    df = df[keep].reset_index(drop=True)
    print(f"  {n0} APOGEE x Gaia DR3 -> {len(df)} after RUWE<{sel['ruwe_max']} and parallax/error>{sel['parallax_over_error_min']}")
    df["dist_pc"] = 1000.0 / df["parallax_corr"]
    df["rv"] = df["VHELIO_AVG"].astype(float)
    # APOGEE formal RV errors are tiny; add a 0.1 km/s floor for zero-point / template systematics.
    df["rv_error"] = np.sqrt(df["VERR"].astype(float) ** 2 + 0.1 ** 2)
    df["flag_rv_variable"] = (df["NVISITS"] > 1) & (df["VSCATTER"] > 1.0)
    df["flag_single_visit"] = df["NVISITS"] <= 1
    df["is_giant"] = df["LOGG"] < 3.5
    df = heliocentric_cartesian(df)
    # orbital integrals use the orbit module's own conversion (corrected parallax)
    df_orb = df[["ra", "dec", "pmra", "pmdec", "rv"]].copy()
    df_orb["dist_pc"] = df["dist_pc"]
    df_orb = galactocentric(df_orb)
    for k in ("E", "Lz", "J_R", "J_z", "ecc", "zmax", "rperi", "rap", "R", "phi", "z", "vR", "vT", "vz"):
        df[k] = df_orb[k].to_numpy()
    df["idx"] = np.arange(len(df))
    df.to_parquet(C.STARS_PARQUET, index=False)
    print(f"Analysis table: {len(df)} stars, {df.shape[1]} columns -> {C.STARS_PARQUET}")


if __name__ == "__main__":
    main()
