"""Constellation figure analysis and traceback."""
from __future__ import annotations

import hashlib
import json
import time

import numpy as np
import pandas as pd

from .. import config as C, orbits, traceback
from ..store import STORE
from ..constellations import overview as const_overview, figure_analysis as const_detail


def provenance(params: dict) -> dict:
    p = {
        "software": "Palimpsest 0.1.0",
        "timestamp_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "data": {"astrometry": "Hipparcos (via Stellarium)", "spectroscopy": "none"},
        "parameters": params,
    }
    p["hash"] = hashlib.sha1(json.dumps(params, sort_keys=True, default=str).encode()).hexdigest()[:12]
    return p


def constellation_overview() -> list[dict]:
    return const_overview(STORE.constellations)


def constellation_detail(abbr: str) -> dict:
    return const_detail(STORE.constellations, abbr)


def constellation_traceback(abbr: str, lookback_myr: float = 5.0, n_mc: int = 32) -> dict:
    data = const_detail(STORE.constellations, abbr)
    df = pd.DataFrame(data["stars"])
    df = df[df["rv"].notna() & df["parallax"].notna()].reset_index(drop=True)
    df["rv_error"] = df["rv_error"].fillna(2.0).clip(lower=0.1)
    for k in ("parallax_pmra_corr", "parallax_pmdec_corr", "pmra_pmdec_corr"):
        df[k] = df[k].fillna(0.0)
    df["zpt_used"] = orbits.PARALLAX_ZERO_POINT_MAS

    tb = traceback.trajectories(df, min(lookback_myr, 50.0), n_mc, C.DEFAULT_POTENTIAL, n_times=101)
    return {
        "abbr": abbr,
        "times_myr": tb.times_myr[::2].tolist(),
        "stars": [{
            "HIP": int(h),
            "nominal": np.round(tb.xyz_pc[k, 0, ::2], 2).tolist(),
            "spread_pc_p84": np.round(
                np.percentile(np.linalg.norm(tb.xyz_pc[k] - tb.xyz_pc[k, :1], axis=-1), 84, axis=0)[::2], 2
            ).tolist(),
        } for k, h in enumerate(df["HIP"])],
        "provenance": provenance({"op": "constellation_traceback", "abbr": abbr, "lookback_myr": lookback_myr, "n_mc": n_mc}),
    }