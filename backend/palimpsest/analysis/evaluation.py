"""Independent multi-evidence evaluation of candidate stellar families.

Combines:
- Chemical homogeneity (Bayesian evidence ratio vs. empirical null)
- Velocity dispersion (intrinsic, errors deconvolved)
- Orbital traceback (size minimum in the past)
- Age consistency (astroNN, giants only)
- Independent survey check (GALAH DR4)
- Known cluster cross-match (OCCAM, Hunt & Reffert 2023)
"""
from __future__ import annotations

import hashlib
import json
import time

import numpy as np
import pandas as pd
from scipy import stats

from .. import chemistry, config as C
from ..families import (
    chemical_evidence,
    galah_check,
    age_evidence,
    occam_labels,
    velocity_dispersion,
    reference_sample,
    match_known_clusters,
)
from ..store import STORE
from ..traceback import group_traceback


def provenance(params: dict) -> dict:
    p = {
        "software": "Palimpsest 0.1.0",
        "timestamp_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "data": {
            "astrometry": "Gaia DR3",
            "spectroscopy": "SDSS-IV APOGEE DR17",
            "ages": "APOGEE DR17 astroNN",
            "cluster_membership": "OCCAM VAC; Hunt & Reffert 2023",
            "independent_abundances": "GALAH DR4",
        },
        "selection": C.SELECTION,
        "parameters": params,
    }
    p["hash"] = hashlib.sha1(json.dumps(params, sort_keys=True, default=str).encode()).hexdigest()[:12]
    return p


def _f(x):
    try:
        x = float(x)
    except (TypeError, ValueError):
        return None
    return x if np.isfinite(x) else None


def evaluate_group(
    source_ids: list[int],
    lookback_myr: float = 50.0,
    n_mc: int = 48,
    n_null: int = 200,
    run_traceback: bool = True,
) -> dict:
    stars = STORE.stars
    g = stars.iloc[STORE.index_of(source_ids)]

    out = {
        "n": int(len(g)),
        "source_ids": g["source_id_str"].tolist(),
        "members": _member_rows(g),
        "kinematics": _kinematics(g),
        "chemistry": chemical_evidence(stars, g, STORE.floor, n_null=n_null),
        "galah_check": galah_check(g),
        "ages": age_evidence(stars, g),
        "known": {
            "occam": occam_labels(g),
            "hunt_reffert_2023": match_known_clusters(g, STORE.clusters),
        },
    }

    if run_traceback and len(g) >= 3:
        tb = group_traceback(g, lookback_myr, n_mc)
        tb.pop("_bundle", None)
        out["traceback"] = tb

    out["hypotheses"] = compare_hypotheses(out)
    out["follow_up"] = group_follow_up(g, out)
    out["caveats"] = _caveats(g, out)
    out["provenance"] = provenance({
        "op": "evaluate_group",
        "source_ids": out["source_ids"],
        "lookback_myr": lookback_myr,
        "n_mc": n_mc,
        "n_null": n_null,
    })
    return out


def _member_rows(g: pd.DataFrame) -> list[dict]:
    return [{
        "source_id": a, "apogee_id": b, "dist_pc": float(c), "teff": float(d), "logg": float(e),
        "feh": _f(f), "occam": h if isinstance(h, str) else None,
        "giant": bool(k), "rv_variable": bool(v1), "single_visit": bool(v2),
    } for a, b, c, d, e, f, h, k, v1, v2 in zip(
        g["source_id_str"], g["APOGEE_ID"], g["dist_pc"], g["TEFF"], g["LOGG"],
        g["FE_H"], g["occam_cluster"], g["is_giant"], g["flag_rv_variable"], g["flag_single_visit"],
    )]


def _kinematics(g: pd.DataFrame) -> dict:
    vd = velocity_dispersion(g)
    return {
        "centroid_pc": [float(v) for v in g[["X", "Y", "Z"]].median()],
        "size_pc": float(np.median(np.linalg.norm(g[["X", "Y", "Z"]] - g[["X", "Y", "Z"]].median(), axis=1))),
        "velocity_dispersion": vd,
        "median_distance_error_pc": float(np.median(g["dist_pc"] * g["parallax_error"] / g["parallax_corr"])),
    }


def compare_hypotheses(ev: dict) -> dict:
    rows = []
    ch = ev["chemistry"]
    if ch.get("available"):
        lnbf, fpr = ch["ln_bayes_factor"], ch["empirical_false_positive_rate"]
        favours = "A" if (lnbf > ch["null_lnBF"]["p99"] and lnbf > 0) else ("B" if lnbf < ch["null_lnBF"]["p95"] else "neither")
        rows.append({
            "evidence": "Chemical homogeneity (evidence ratio)",
            "value": f"ln BF = {lnbf:.1f}; random field groups exceed this in {100 * fpr:.1f}% of trials",
            "A_predicts": "ln BF well above the field-group null",
            "B_predicts": "ln BF within the null distribution",
            "favours": favours, "quantitative": True,
        })
        worst = sorted(ch["elements"], key=lambda e: -(e["sigma_int"] or 0))[:2]
        rows.append({
            "evidence": "Largest intrinsic abundance scatter",
            "value": "; ".join(f"{C.CHEM_LABELS[e['element']]}: {e['sigma_int']:.3f} dex (95% UL {e['sigma_int_upper95']:.3f})"
                                for e in worst if e["sigma_int"] is not None and np.isfinite(e["sigma_int"])),
            "A_predicts": "<~0.03 dex beyond floor", "B_predicts": "comparable to field spread (~0.05-0.2 dex)",
            "favours": "A" if all((e["sigma_int"] or 0) < 0.03 for e in worst) else "B", "quantitative": False,
        })
    else:
        rows.append({"evidence": "Chemistry", "value": ch.get("reason", "unavailable"),
                     "A_predicts": "-", "B_predicts": "-", "favours": "untested", "quantitative": False})

    vd = ev["kinematics"]["velocity_dispersion"]["sigma_3d"]
    rows.append({
        "evidence": "3D velocity dispersion", "value": f"{vd:.1f} km/s (errors partly deconvolved)",
        "A_predicts": "<~5 km/s", "B_predicts": "field disc ~20-40 km/s",
        "favours": "A" if vd < 5 else ("B" if vd > 10 else "neither"), "quantitative": False,
    })

    tb = ev.get("traceback")
    if tb:
        fmin_now = tb["fraction_min_at_present"]
        rows.append({
            "evidence": f"Traceback over {tb['lookback_myr']:.0f} Myr",
            "value": (f"size now {tb['size_now_pc']:.0f} pc; minimum {tb['size_min_pc']['median']:.0f} pc "
                      f"at {tb['t_min_myr']['median']:.1f} Myr (min at present in {100 * fmin_now:.0f}% of MC)"),
            "A_predicts": "compact at all epochs or past minimum",
            "B_predicts": "monotonic dispersal (minimum at present)",
            "favours": ("A" if (tb["size_min_pc"]["median"] < 0.7 * tb["size_now_pc"] or
                                 max(tb["size_pc_median"]) < 2 * tb["size_now_pc"]) else
                        ("B" if fmin_now > 0.8 else "neither")),
            "quantitative": False,
        })

    ag = ev["ages"]
    if ag.get("available"):
        rows.append({
            "evidence": "Age spread (astroNN, giants)",
            "value": f"median {ag['median_age_gyr']:.1f} Gyr; intrinsic log-age scatter {ag['log_age_sigma_int']:.2f} dex",
            "A_predicts": "consistent with zero intrinsic scatter",
            "B_predicts": "comparable to field spread",
            "favours": "A" if ag["log_age_sigma_int"] < 0.5 * ag["field_log_age_spread"] else "neither",
            "quantitative": False,
        })

    gc = ev["galah_check"]
    if gc.get("available"):
        mx = max(e["sigma_int"] for e in gc["elements"])
        rows.append({
            "evidence": "Independent survey (GALAH DR4)",
            "value": f"{gc['n']} members; max intrinsic scatter {mx:.3f} dex",
            "A_predicts": "small scatter in independent pipeline",
            "B_predicts": "field-like scatter", "favours": "A" if mx < 0.05 else "neither", "quantitative": False,
        })

    nA = sum(r["favours"] == "A" for r in rows)
    nB = sum(r["favours"] == "B" for r in rows)
    quant = next((r for r in rows if r["quantitative"]), None)

    if quant and quant["favours"] == "A" and nB == 0:
        verdict = "Data favour a common origin (A); no line of evidence contradicts it."
    elif quant and quant["favours"] == "A":
        verdict = "Chemistry favours a common origin (A), but other evidence lines are in tension."
    elif quant and quant["favours"] == "B":
        verdict = "Chemistry is consistent with unrelated field stars (B); a single birth cloud is disfavoured."
    else:
        verdict = "Inconclusive: the available data do not meaningfully distinguish A from B."

    return {
        "A": "Members formed together in one cluster/association (now bound or dissolving)",
        "B": "Members are unrelated field stars that happen to share present-day kinematics",
        "rows": rows, "n_favour_A": nA, "n_favour_B": nB, "verdict": verdict,
    }


def group_follow_up(g: pd.DataFrame, ev: dict) -> list[str]:
    s = []
    if g["flag_single_visit"].mean() > 0.3:
        s.append(f"{int(g['flag_single_visit'].sum())} members have a single APOGEE RV epoch; further epochs would identify binaries.")
    if ev["chemistry"].get("available"):
        bad = [m for m in ev["chemistry"]["member_contributions"] if m["delta_lnBF_if_removed"] < -2]
        if bad:
            s.append(f"{len(bad)} member(s) lower the common-origin evidence by >2 in ln BF; check them individually.")
    if g["is_giant"].any() and (~g["is_giant"]).any():
        s.append("Group mixes dwarfs and giants; differential analysis of same evolutionary phase would remove systematics.")
    if ev["kinematics"]["median_distance_error_pc"] > ev["kinematics"]["size_pc"]:
        s.append("Distance errors exceed group size; Gaia DR4 astrometry will tighten traceback.")
    if not ev["galah_check"].get("available"):
        s.append("Few members have GALAH spectra; optical high-res spectra (incl. neutron-capture elements) would provide independent test.")
    return s


def _caveats(g: pd.DataFrame, ev: dict) -> list[str]:
    return [
        "APOGEE targeted many known clusters deliberately; recovered groups are subject to that selection.",
        "Dwarfs and giants of the same cluster can differ by ~0.05-0.1 dex in ASPCAP abundances.",
        "The field model is a Gaussian mixture; evidence ratio is shown against empirical null from random field groups.",
    ]