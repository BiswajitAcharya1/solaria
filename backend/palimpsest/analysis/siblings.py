"""Sibling search: find stars compatible with a common birth site.

Combines:
- Chemical compatibility (chi-square with systematic floor)
- Dynamical compatibility (Mahalanobis distance in action space)
- Past proximity test (Monte Carlo traceback)
"""
from __future__ import annotations

import hashlib
import json
import time

import numpy as np
import pandas as pd
from scipy import stats

from .. import chemistry, config as C, orbits, traceback
from ..store import STORE


def provenance(params: dict) -> dict:
    p = {
        "software": "Palimpsest 0.1.0",
        "timestamp_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "data": {
            "astrometry": "Gaia DR3", "spectroscopy": "APOGEE DR17",
            "ages": "APOGEE DR17 astroNN", "cluster_membership": "OCCAM VAC",
        },
        "selection": C.SELECTION, "parameters": params,
    }
    p["hash"] = hashlib.sha1(json.dumps(params, sort_keys=True, default=str).encode()).hexdigest()[:12]
    return p


def _f(x):
    try:
        x = float(x)
    except (TypeError, ValueError):
        return None
    return x if np.isfinite(x) else None


def _action_mc(r: pd.Series, n: int, birth_sigma_kms: float, rng: np.random.Generator) -> np.ndarray:
    rows = {k: np.array([r[k]]) for k in (
        "parallax", "parallax_error", "pmra", "pmra_error", "pmdec", "pmdec_error",
        "rv", "rv_error", "parallax_pmra_corr", "parallax_pmdec_corr", "pmra_pmdec_corr",
    )}
    rows["parallax"] = rows["parallax"] - r["zpt_used"] + orbits.PARALLAX_ZERO_POINT_MAS
    smp = orbits.sample_astrometry(rows, n, rng)
    d = 1.0 / orbits.corrected_parallax(smp["parallax"][0])
    o = orbits.make_orbit(
        np.full(n, r["ra"]), np.full(n, r["dec"]), d,
        smp["pmra"][0], smp["pmdec"][0], smp["rv"][0],
    )
    if birth_sigma_kms > 0:
        from galpy.orbit import Orbit
        _, ro, vo = orbits.get_potential()
        vxvv = np.column_stack([
            o.R(), o.vR() + rng.normal(0, birth_sigma_kms, n),
            o.vT() + rng.normal(0, birth_sigma_kms, n), o.z(),
            o.vz() + rng.normal(0, birth_sigma_kms, n), o.phi(),
        ])
        o = Orbit(vxvv, ro=ro, vo=vo, zo=C.SOLAR_Z_KPC, solarmotion=list(C.SOLAR_MOTION_UVW))
    op = orbits.orbital_parameters(o)
    return np.column_stack([
        np.sqrt(np.clip(op["J_R"], 0, None)),
        op["Lz"],
        np.sqrt(np.clip(op["J_z"], 0, None)),
    ])


def sibling_search(
    source_id: int,
    birth_sigma_kms: float = 1.0,
    p_chem: float = 0.05,
    n_traceback: int = 8,
    lookback_myr: float = 100.0,
    seed: int = 3,
) -> dict:
    stars = STORE.stars
    X, E = STORE.chem
    i = STORE.index_of([source_id])[0]
    r = stars.iloc[i]
    rng = np.random.default_rng(seed)

    A_err = _action_mc(r, 200, 0.0, rng)
    A_birth = _action_mc(r, 200, birth_sigma_kms, rng)
    cov = np.cov(A_err.T) + np.cov(A_birth.T)
    cinv = np.linalg.inv(cov)

    A = np.column_stack([
        np.sqrt(stars["J_R"].clip(0)), stars["Lz"], np.sqrt(stars["J_z"].clip(0)),
    ])
    d = A - A[i]
    m2 = np.einsum("ij,jk,ik->i", d, cinv, d)
    dyn_ok = m2 < stats.chi2.ppf(0.95, 3)

    chi2, dof, p, _ = chemistry.pair_chem2(X[i], E[i], X, E, STORE.floor)
    chem_ok = (dof >= 6) & (p > p_chem)
    comparable = (dof >= 6) & np.isfinite(m2) & (stars["is_giant"] == r["is_giant"]).to_numpy()
    comparable[i] = False

    N = int(comparable.sum())
    n_chem = int((chem_ok & comparable).sum())
    n_dyn = int((dyn_ok & comparable).sum())
    both = chem_ok & dyn_ok & comparable
    n_both = int(both.sum())
    expected = n_chem * n_dyn / max(N, 1)

    cand = np.where(both)[0]
    cand = cand[np.argsort(m2[cand] + chi2[cand] / np.maximum(dof[cand], 1))]

    rows = []
    for j in cand[:200]:
        rows.append({
            "source_id": str(stars["source_id"].iloc[j]),
            "mahalanobis2_actions": float(m2[j]),
            "chem_chi2": float(chi2[j]), "chem_dof": int(dof[j]), "chem_p": float(p[j]),
            "separation_pc": float(np.linalg.norm(
                stars[["X", "Y", "Z"]].iloc[j].to_numpy() - r[["X", "Y", "Z"]].to_numpy().astype(float))),
            "dv_kms": float(np.linalg.norm(
                stars[["U", "V", "W"]].iloc[j].to_numpy() - r[["U", "V", "W"]].to_numpy().astype(float))),
            "age_gyr": _f(stars["age_gyr"].iloc[j]) if stars["is_giant"].iloc[j] else None,
        })

    tb_rows = []
    if len(cand):
        top = cand[:n_traceback]
        sub = stars.iloc[np.concatenate([[i], top])]
        tb = traceback.trajectories(sub, lookback_myr, 24, C.DEFAULT_POTENTIAL, seed=seed)
        x0 = tb.xyz_pc[0]
        for k, j in enumerate(top):
            dd = np.linalg.norm(tb.xyz_pc[k + 1] - x0, axis=-1)
            jm = np.argmin(dd, axis=1)
            dmin = dd[np.arange(dd.shape[0]), jm]
            tb_rows.append({
                "source_id": str(stars["source_id"].iloc[j]),
                "d_min_pc": {
                    "median": float(np.median(dmin)),
                    "p16": float(np.percentile(dmin, 16)),
                    "p84": float(np.percentile(dmin, 84)),
                },
                "t_min_myr": float(np.median(tb.times_myr[jm])),
                "separation_now_pc": float(dd[0, 0]),
            })

    return {
        "seed": str(source_id),
        "birth_velocity_dispersion_kms": birth_sigma_kms,
        "counts": {
            "comparable_stars": N, "chemically_compatible": n_chem,
            "dynamically_compatible": n_dyn, "both": n_both,
            "expected_both_if_independent": expected,
            "enrichment": (n_both / expected) if expected > 0 else None,
        },
        "candidates": rows, "traceback": tb_rows,
        "method": {
            "dynamics": "Mahalanobis in (sqrt J_R, L_z, sqrt J_z) with MC covariance + birth dispersion; 95% region.",
            "chemistry": f"chi-square over >=6 shared elements; compatible if p > {p_chem}.",
            "chance": "Expected both = N_chem * N_dyn / N. Excess shows chemo-dynamical correlation.",
        },
        "caveats": [
            "Actions change through radial migration/heating; constrains only recent shared history.",
            "Chemical compatibility is necessary but far from sufficient (chemical doppelganger problem).",
        ],
        "provenance": provenance({
            "op": "sibling_search", "seed": str(source_id),
            "birth_sigma_kms": birth_sigma_kms, "p_chem": p_chem,
            "lookback_myr": lookback_myr, "seed_rng": seed,
        }),
    }