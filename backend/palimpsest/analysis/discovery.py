"""Candidate group discovery using HDBSCAN in phase space or action space.

Deliberately uses kinematics ONLY -- no chemistry, ages, or traceback.
Evaluation happens separately in evaluation.py.
"""
from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache

import numpy as np
import pandas as pd
from sklearn.cluster import HDBSCAN

from .. import config as C
from ..families import discover as fam_discover, region_mask, match_known_clusters


@dataclass(slots=True)
class DiscoveryParams:
    center_pc: tuple[float, float, float] = (0.0, 0.0, 0.0)
    radius_pc: float = 500.0
    mode: str = "phase_space"
    min_cluster_size: int = 8
    min_samples: int = 5
    min_poe: float = 10.0
    pos_scale_pc: float = 10.0
    vel_scale_kms: float = 1.0
    max_groups: int = 40


def run_discovery(params: DiscoveryParams, stars: pd.DataFrame) -> dict:
    """Run kinematic discovery and return structured results."""
    m = region_mask(stars, params.center_pc, params.radius_pc, params.min_poe)
    region = stars[m]
    labels = fam_discover(
        region,
        params.mode,
        params.min_cluster_size,
        params.min_samples,
        {"pos_scale_pc": params.pos_scale_pc, "vel_scale_kms": params.vel_scale_kms},
    )

    groups = []
    for lab in sorted(set(labels) - {-1}):
        g = region[labels == lab]
        occ = g.loc[g["occam_cg_prob"] >= 0.5, "occam_cluster"].value_counts()
        n_chem = int((g[["MG_FE", "FE_H"]].notna().all(axis=1)).sum())
        groups.append({
            "label": int(lab),
            "n": int(len(g)),
            "n_with_chemistry": n_chem,
            "source_ids": g["source_id_str"].tolist(),
            "centroid_pc": [float(v) for v in g[["X", "Y", "Z"]].median()],
            "mean_uvw_kms": [float(v) for v in g[["U", "V", "W"]].median()],
            "size_pc": float(np.median(np.linalg.norm(g[["X", "Y", "Z"]] - g[["X", "Y", "Z"]].median(), axis=1))),
            "sigma_v_kms": float(np.sqrt(np.sum(np.var(g[["U", "V", "W"]].to_numpy(), axis=0)))),
            "feh_median": float(g["FE_H"].median()) if g["FE_H"].notna().any() else None,
            "feh_spread": float(g["FE_H"].std()) if g["FE_H"].notna().any() else None,
            "occam_members": {str(k): int(v) for k, v in occ.items()},
            "known_match": match_known_clusters(g, C.CLUSTERS_PARQUET, n=1),
        })

    groups.sort(key=lambda g: -g["n"])
    return {
        "n_region": int(m.sum()),
        "n_grouped": int((labels >= 0).sum()),
        "groups": groups[:params.max_groups],
        "parameters": params.__dict__,
        "note": "Groups are kinematic candidates only. Chemistry, ages and traceback are evaluated separately with 'Evaluate'.",
    }


@lru_cache(maxsize=8)
def _cached_region_mask(center_hash: str, radius_pc: float, min_poe: float) -> np.ndarray:
    """Cached region mask for repeated queries with same parameters."""
    from ..store import STORE
    stars = STORE.stars
    cx, cy, cz = map(float, center_hash.split(","))
    return region_mask(stars, (cx, cy, cz), radius_pc, min_poe)