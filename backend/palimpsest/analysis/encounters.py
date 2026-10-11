"""Ejection / encounter tests: star vs. known cluster."""
from __future__ import annotations

import hashlib
import json
import time

import numpy as np
import pandas as pd

from .. import config as C, traceback
from ..store import STORE


def provenance(params: dict) -> dict:
    p = {
        "software": "Palimpsest 0.1.0",
        "timestamp_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "data": {"astrometry": "Gaia DR3", "cluster_catalog": "Hunt & Reffert 2023"},
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


def _encounter_text(r, ctrl, radius, cl):
    f = r["fraction_within_radius"]
    c = np.mean(ctrl) if ctrl else float("nan")
    s = (f"In {100 * f:.0f}% of MC realisations the star passed within {radius:.0f} pc of {cl['Name']} "
         f"(closest {r['d_min_pc']['median']:.0f} pc [{r['d_min_pc']['p16']:.0f}-{r['d_min_pc']['p84']:.0f}] "
         f"at {r['t_min_myr']['median']:.1f} Myr, v_rel {r['v_rel_kms']['median']:.0f} km/s).")
    if np.isfinite(c):
        s += f" Control stars achieve this in {100 * c:.0f}% of realisations on average."
    if np.isfinite(cl["age_myr"]) and -r["t_min_myr"]["median"] > cl["age_myr"]:
        s += " The encounter epoch predates the cluster's estimated age, arguing against ejection."
    return s


def encounter_test(
    source_id: int,
    cluster_name: str,
    lookback_myr: float = 50.0,
    n_mc: int = 200,
    n_control: int = 30,
    radius_pc: float | None = None,
) -> dict:
    stars = STORE.stars
    cls = STORE.clusters
    hit = cls[cls["Name"].str.lower() == cluster_name.lower()]
    if hit.empty:
        raise KeyError(f"cluster {cluster_name} not in Hunt & Reffert (2023)")
    cl = hit.iloc[0]

    radius = float(radius_pc) if radius_pc else float(max(2 * cl["rtpc"], 10.0))
    star = stars.iloc[STORE.index_of([source_id])]
    cdf = traceback.sample_cluster(cl)

    res = traceback.encounter(star, cdf, lookback_myr, n_mc, C.DEFAULT_POTENTIAL, radius)
    main_r = res["results"][0]

    d_now = np.linalg.norm(star[["X", "Y", "Z"]].to_numpy()[0] - np.array([cl["Xh"], cl["Yh"], cl["Zh"]]))
    dc = np.linalg.norm(stars[["X", "Y", "Z"]].to_numpy() - np.array([cl["Xh"], cl["Yh"], cl["Zh"]]), axis=1)
    pool = np.where((np.abs(dc - d_now) < max(0.2 * d_now, 20)) & (stars["source_id"] != source_id).to_numpy())[0]

    rng = np.random.default_rng(5)
    ctrl = rng.choice(pool, size=min(n_control, pool.size), replace=False) if pool.size else np.array([], int)
    ctrl_frac = []

    if ctrl.size:
        cres = traceback.encounter(stars.iloc[ctrl], cdf, lookback_myr, 24, C.DEFAULT_POTENTIAL, radius)
        ctrl_frac = [r["fraction_within_radius"] for r in cres["results"]]

    tb = res["bundle"]
    return {
        "source_id": str(source_id),
        "cluster": {
            "name": cl["Name"], "age_myr": _f(cl["age_myr"]),
            "distance_pc": _f(cl["dist50"]), "rt_pc": _f(cl["rtpc"]),
            "rv_kms": _f(cl["RV"]), "n_rv": _f(cl["n_RV"]),
        },
        "radius_pc": radius, "lookback_myr": lookback_myr, "n_mc": n_mc,
        "result": {k: v for k, v in main_r.items() if k != "d_min_samples"},
        "d_min_samples": np.round(main_r["d_min_samples"], 2).tolist(),
        "control": {
            "n": int(len(ctrl_frac)),
            "mean_fraction_within_radius": _f(np.mean(ctrl_frac)) if ctrl_frac else None,
            "fractions": ctrl_frac,
            "description": "random sample stars currently at a similar distance from the cluster",
        },
        "trajectory": {
            "times_myr": tb.times_myr[::4].tolist(),
            "star": np.round(tb.xyz_pc[0, 0, ::4], 2).tolist(),
            "cluster": np.round(tb.xyz_pc[1, 0, ::4], 2).tolist(),
        },
        "interpretation": _encounter_text(main_r, ctrl_frac, radius, cl),
        "caveats": [
            "Cluster centre motion from Hunt & Reffert (2023); cluster mass and tidal field not modelled.",
            "Close approach is necessary for ejection but not sufficient; control sample estimates chance rate.",
        ],
        "provenance": provenance({
            "op": "encounter", "source_id": str(source_id), "cluster": cl["Name"],
            "lookback_myr": lookback_myr, "n_mc": n_mc, "radius_pc": radius,
        }),
    }