"""Historical reconstruction: group traceback and star-cluster encounter tests.

Group traceback (cluster-dissolution hypothesis)
    If a group of stars is the expanding remnant of a single birth site, the
    group's spatial size, computed by integrating every member back in time,
    should reach a minimum at some past epoch ("kinematic age"; e.g.
    Miret-Roig et al. 2020).  A bound cluster stays compact at all epochs; an
    unrelated set of field stars disperses monotonically into the past.  We
    report the size curve with Monte Carlo uncertainty and the distribution of
    the epoch of minimum size.

Encounter test (ejection hypothesis)
    For a star and a cluster, integrate Monte Carlo realisations of both and
    record the closest approach, its epoch and the relative velocity.  A star
    ejected from the cluster must have been inside the cluster (within a few
    tidal radii, given cluster-centre uncertainties) at ejection.  The fraction
    of realisations that achieve this is compared with the same quantity for a
    control sample of field stars at similar distances, which estimates how
    often a chance fly-by produces an equally close approach.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from . import config as C
from . import orbits


def _rows_for_orbits(df: pd.DataFrame) -> dict:
    """Observables for Monte Carlo sampling.  ``zpt_used`` (mas) is subtracted
    from the catalogue parallax; rows without it are taken as already corrected
    (Hipparcos parallaxes, cluster distances)."""
    zero = pd.Series(np.zeros(len(df)), index=df.index)
    zpt = df["zpt_used"].fillna(0.0) if "zpt_used" in df else zero
    col = lambda k: df[k].fillna(0.0).to_numpy(float) if k in df else np.zeros(len(df))
    return {
        "parallax": (df["parallax"] - zpt).to_numpy(float),
        "parallax_error": df["parallax_error"].to_numpy(float),
        "pmra": df["pmra"].to_numpy(float), "pmra_error": df["pmra_error"].to_numpy(float),
        "pmdec": df["pmdec"].to_numpy(float), "pmdec_error": df["pmdec_error"].to_numpy(float),
        "rv": df["rv"].to_numpy(float), "rv_error": df["rv_error"].to_numpy(float),
        "parallax_pmra_corr": col("parallax_pmra_corr"),
        "parallax_pmdec_corr": col("parallax_pmdec_corr"),
        "pmra_pmdec_corr": col("pmra_pmdec_corr"),
    }


def trajectories(df: pd.DataFrame, lookback_myr: float, n_mc: int, potential: str, seed: int = 42,
                 n_times: int = 201):
    rng = np.random.default_rng(seed)
    samples = orbits.sample_astrometry(_rows_for_orbits(df), n_mc, rng)
    return orbits.integrate_samples(df["ra"].to_numpy(float), df["dec"].to_numpy(float), samples,
                                    lookback_myr, n_times=n_times, potential=potential)


def group_size_curve(xyz: np.ndarray, robust: bool = True):
    """xyz: (n_star, n_mc, nt, 3) -> size (n_mc, nt) in pc.

    Size = median 3D distance of members from the group median position (robust
    to a minority of interlopers), or rms radius if robust=False."""
    if robust:
        centre = np.median(xyz, axis=0, keepdims=True)
        d = np.linalg.norm(xyz - centre, axis=-1)
        return np.median(d, axis=0)
    centre = np.mean(xyz, axis=0, keepdims=True)
    return np.sqrt(np.mean(np.sum((xyz - centre) ** 2, axis=-1), axis=0))


def group_traceback(df: pd.DataFrame, lookback_myr: float = 50.0, n_mc: int = 64,
                    potential: str = C.DEFAULT_POTENTIAL, seed: int = 42) -> dict:
    tb = trajectories(df, lookback_myr, n_mc, potential, seed)
    size = group_size_curve(tb.xyz_pc)                     # (n_mc, nt)
    t = tb.times_myr
    i_min = np.argmin(size, axis=1)
    t_min = t[i_min]
    s_min = size[np.arange(size.shape[0]), i_min]
    pct = lambda a, q: np.percentile(a, q, axis=0)
    at_present = np.mean(i_min == 0)
    out = {
        "times_myr": t.tolist(),
        "size_pc_median": pct(size, 50).tolist(),
        "size_pc_p16": pct(size, 16).tolist(),
        "size_pc_p84": pct(size, 84).tolist(),
        "size_now_pc": float(np.median(size[:, 0])),
        "t_min_myr": {"median": float(np.median(t_min)), "p16": float(np.percentile(t_min, 16)),
                      "p84": float(np.percentile(t_min, 84))},
        "size_min_pc": {"median": float(np.median(s_min)), "p16": float(np.percentile(s_min, 16)),
                        "p84": float(np.percentile(s_min, 84))},
        "fraction_min_at_present": float(at_present),
        "fraction_min_at_lookback_limit": float(np.mean(i_min == t.size - 1)),
        "n_mc": n_mc, "potential": potential, "lookback_myr": lookback_myr,
    }
    out["_bundle"] = tb
    return out


def sample_cluster(cl: pd.Series) -> pd.DataFrame:
    """A Hunt & Reffert (2023) cluster centre as a pseudo-star whose 'errors' are the
    uncertainties of the cluster's mean distance, proper motion and RV (sampled later)."""
    num = lambda k, default: float(cl[k]) if k in cl and np.isfinite(float(cl[k])) else default
    if not np.isfinite(num("RV", np.nan)):
        raise ValueError(f"cluster {cl['Name']} has no mean radial velocity; 3D traceback impossible")
    d50 = num("dist50", np.nan)
    if not (np.isfinite(d50) and d50 > 0):
        raise ValueError(f"cluster {cl['Name']} has no distance estimate")
    d16, d84 = num("dist16", 0.95 * d50), num("dist84", 1.05 * d50)
    sig_d = max(0.5 * (d84 - d16), 0.01 * d50)
    plx = 1000.0 / d50
    sig_plx = plx * sig_d / d50
    rv_err = num("e_RV", 1.0)
    rv_err = rv_err if rv_err > 0 else 1.0
    # fall back to 0.05 mas/yr where the mean-proper-motion error is missing
    return pd.DataFrame({
        "ra": [float(cl["RA_ICRS"])], "dec": [float(cl["DE_ICRS"])],
        "parallax": [plx], "parallax_error": [sig_plx],
        "pmra": [float(cl["pmRA"])], "pmra_error": [max(num("e_pmRA", 0.05), 1e-3)],
        "pmdec": [float(cl["pmDE"])], "pmdec_error": [max(num("e_pmDE", 0.05), 1e-3)],
        "rv": [num("RV", np.nan)], "rv_error": [rv_err],
        "zpt_used": [0.0],  # HR23 distances used as published (no further zero-point applied)
    })


def encounter(star: pd.DataFrame, cluster_df: pd.DataFrame, lookback_myr: float, n_mc: int,
              potential: str, radius_pc: float, seed: int = 7) -> dict:
    """Closest approach between each MC realisation of ``star`` rows and the cluster centre."""
    both = pd.concat([star, cluster_df], ignore_index=True)
    tb = trajectories(both, lookback_myr, n_mc, potential, seed, n_times=401)
    xyz = tb.xyz_pc
    cl = xyz[-1]                         # (n_mc, nt, 3)
    res = []
    for i in range(len(star)):
        d = np.linalg.norm(xyz[i] - cl, axis=-1)          # (n_mc, nt)
        j = np.argmin(d, axis=1)
        dmin = d[np.arange(n_mc), j]
        tmin = tb.times_myr[j]
        dt = np.diff(tb.times_myr)[0]
        k = np.clip(j, 1, len(tb.times_myr) - 2)
        dv = (xyz[i][np.arange(n_mc), k + 1] - xyz[i][np.arange(n_mc), k - 1]) - \
             (cl[np.arange(n_mc), k + 1] - cl[np.arange(n_mc), k - 1])
        vrel = np.linalg.norm(dv, axis=-1) / (2 * abs(dt)) * 0.9778  # pc/Myr -> km/s
        res.append({
            "d_min_pc": {"median": float(np.median(dmin)), "p16": float(np.percentile(dmin, 16)),
                         "p84": float(np.percentile(dmin, 84))},
            "t_min_myr": {"median": float(np.median(tmin)), "p16": float(np.percentile(tmin, 16)),
                          "p84": float(np.percentile(tmin, 84))},
            "v_rel_kms": {"median": float(np.median(vrel)), "p16": float(np.percentile(vrel, 16)),
                          "p84": float(np.percentile(vrel, 84))},
            "fraction_within_radius": float(np.mean(dmin < radius_pc)),
            "fraction_at_present": float(np.mean(j == 0)),
            "d_min_samples": dmin.tolist(),
        })
    return {"results": res, "bundle": tb, "radius_pc": radius_pc}
