"""Stellar-family reconstruction: candidate discovery and independent evaluation.

Discovery and evaluation deliberately use *different* information:

* **Discovery** uses kinematics only (HDBSCAN; Campello et al. 2013, as used for
  Gaia clusters by Hunt & Reffert 2021/2023).  Two feature spaces:
    - ``phase_space``: heliocentric position and velocity, each scaled by a
      physically chosen unit (default 1 unit = 10 pc = 1 km/s), suited to
      bound clusters and young associations;
    - ``integrals``: orbital actions (sqrt J_R, L_z, sqrt J_z), conserved along
      orbits in an axisymmetric potential, so stars that drifted far apart can
      still share them.  Suited to dissolved populations, streams and debris
      (and also picks up resonant moving groups, which are *not* birth
      families - chemistry is what separates the two).
* **Evaluation** then asks whether chemistry, ages and traceback independently
  support a common origin, always compared with matched field stars.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.cluster import HDBSCAN

from . import chemistry
from . import config as C

PHASE_DEFAULTS = {"pos_scale_pc": 10.0, "vel_scale_kms": 1.0}


def region_mask(df: pd.DataFrame, center_pc=(0.0, 0.0, 0.0), radius_pc: float = 500.0,
                min_poe: float = 10.0, require_chem: bool = False) -> np.ndarray:
    d = np.sqrt((df["X"] - center_pc[0]) ** 2 + (df["Y"] - center_pc[1]) ** 2 + (df["Z"] - center_pc[2]) ** 2)
    m = (d <= radius_pc) & (df["parallax_corr"] / df["parallax_error"] >= min_poe)
    if require_chem:
        m &= df["MG_FE"].notna() & df["FE_H"].notna()
    return m.to_numpy()


def features(df: pd.DataFrame, mode: str, params: dict | None = None) -> np.ndarray:
    params = {**PHASE_DEFAULTS, **(params or {})}
    if mode == "phase_space":
        p = df[["X", "Y", "Z"]].to_numpy(float) / params["pos_scale_pc"]
        v = df[["U", "V", "W"]].to_numpy(float) / params["vel_scale_kms"]
        return np.hstack([p, v])
    if mode == "integrals":
        F = np.column_stack([np.sqrt(np.clip(df["J_R"], 0, None)), df["Lz"], np.sqrt(np.clip(df["J_z"], 0, None))])
        # scale each integral by its robust spread in the region
        med = np.nanmedian(F, axis=0)
        mad = 1.4826 * np.nanmedian(np.abs(F - med), axis=0)
        return (F - med) / mad
    raise ValueError(f"unknown mode {mode}")


def discover(df: pd.DataFrame, mode: str = "phase_space", min_cluster_size: int = 8,
             min_samples: int | None = 5, params: dict | None = None,
             min_probability: float = 0.5, selection: str = "eom",
             max_cluster_size: int = 1000) -> np.ndarray:
    """HDBSCAN labels (-1 = noise).  ``selection='eom'`` (excess of mass, default)
    keeps rich clusters whole; ``'leaf'`` returns the finest structures and shatters
    rich clusters (validated on OCCAM clusters in validate.py).  ``max_cluster_size``
    stops 'eom' from selecting the whole field of a large region as one "cluster"
    (the richest OCCAM cluster in the sample has ~180 APOGEE members).
    HDBSCAN attaches sparse outlying points to a
    cluster with low membership probability; points below ``min_probability``
    are returned as noise (tested on synthetic clusters in tests/test_science.py)."""
    F = features(df, mode, params)
    ok = np.all(np.isfinite(F), axis=1)
    labels = np.full(len(df), -1)
    if ok.sum() < min_cluster_size:
        return labels
    hd = HDBSCAN(min_cluster_size=min_cluster_size, min_samples=min_samples,
                 cluster_selection_method=selection, copy=True,
                 max_cluster_size=max_cluster_size if selection == "eom" else None).fit(F[ok])
    lab = hd.labels_.copy()
    lab[hd.probabilities_ < min_probability] = -1
    # drop groups that fell below the minimum size after the probability cut
    for L in set(lab) - {-1}:
        if np.sum(lab == L) < min_cluster_size:
            lab[lab == L] = -1
    labels[ok] = lab
    return labels


MIN_DENSITY_RATIO = 1.25


def phase_space_significance(F: np.ndarray, labels: np.ndarray, k: int = 5, n_shuffle: int = 40,
                             seed: int = 0) -> dict:
    """False-alarm probability that a phase-space group arises without any genuine
    position-velocity coherence.

    Statistic: median distance of members to their k-th nearest neighbour in the
    scaled 6D space (smaller = denser).  Null: velocities are permuted among the
    region's stars (destroying co-spatial + co-moving structure while keeping both
    marginal distributions); in each shuffle the densest *possible* group of the
    same size is bounded by the median of the n smallest k-NN distances.  The
    false-alarm probability is the fraction of shuffles whose bound is at least as
    dense as the candidate (conservative: real spurious groups are less dense)."""
    from scipy.spatial import cKDTree

    rng = np.random.default_rng(seed)
    ok = np.all(np.isfinite(F), axis=1)
    Fo = F[ok]
    lab = labels[ok]
    dk = cKDTree(Fo).query(Fo, k=k + 1, workers=-1)[0][:, -1]
    null_sorted = []
    for _ in range(n_shuffle):
        Fs = Fo.copy()
        Fs[:, 3:] = Fs[rng.permutation(len(Fs)), 3:]
        null_sorted.append(np.sort(cKDTree(Fs).query(Fs, k=k + 1, workers=-1)[0][:, -1]))
    out = {}
    for L in sorted(set(lab) - {-1}):
        m = lab == L
        n = int(m.sum())
        stat = float(np.median(dk[m]))
        bounds = np.array([np.median(ns[:n]) for ns in null_sorted])
        fap = float((np.sum(bounds <= stat) + 1) / (n_shuffle + 1))
        ratio = float(np.median(bounds) / stat) if stat > 0 else float("inf")
        # significance needs both a small false-alarm probability and a material density
        # excess: with tens of thousands of stars a ~1% excess is "significant" but meaningless.
        out[int(L)] = {"density_stat": stat, "null_bound_median": float(np.median(bounds)),
                       "density_ratio": ratio, "false_alarm_probability": fap,
                       "significant": bool(fap <= 0.05 and ratio >= MIN_DENSITY_RATIO)}
    return out


# ---------------------------------------------------------------------------
# Evaluation
# ---------------------------------------------------------------------------
def reference_sample(stars: pd.DataFrame, group: pd.DataFrame, max_n: int = 20000, seed: int = 1):
    """Field stars comparable to the group in evolutionary state and Galactic location."""
    exclude = stars["source_id"].isin(group["source_id"])
    tlo, thi = group["TEFF"].min() - 200, group["TEFF"].max() + 200
    glo, ghi = group["LOGG"].min() - 0.3, group["LOGG"].max() + 0.3
    rlo, rhi = group["R"].min() - 1.0, group["R"].max() + 1.0
    zlo, zhi = group["z"].min() - 0.3, group["z"].max() + 0.3
    m = (~exclude) & stars["TEFF"].between(tlo, thi) & stars["LOGG"].between(glo, ghi) & \
        stars["R"].between(rlo, rhi) & stars["z"].between(zlo, zhi)
    ref = stars[m]
    widened = False
    if len(ref) < 2000:  # widen spatially if too few comparable stars
        widened = True
        m = (~exclude) & stars["TEFF"].between(tlo, thi) & stars["LOGG"].between(glo, ghi) & \
            stars["R"].between(rlo - 2, rhi + 2)
        ref = stars[m]
    if len(ref) > max_n:
        ref = ref.sample(max_n, random_state=seed)
    return ref, {"n": int(len(ref)), "teff": [float(tlo), float(thi)], "logg": [float(glo), float(ghi)],
                 "R_kpc": [float(rlo), float(rhi)], "widened": widened}


def velocity_dispersion(group: pd.DataFrame) -> dict:
    """1D intrinsic velocity dispersion per component (U,V,W), errors not deconvolved
    beyond a nominal propagation of distance and proper-motion errors."""
    UVW = group[["U", "V", "W"]].to_numpy(float)
    d = group["dist_pc"].to_numpy(float)
    k = 4.74047e-3  # km/s per (mas/yr * pc)
    vt_err = k * d * np.sqrt(group["pmra_error"] ** 2 + group["pmdec_error"] ** 2).to_numpy() / np.sqrt(2)
    vt = k * d * np.hypot(group["pmra"], group["pmdec"]).to_numpy()
    dist_err_vt = vt * group["parallax_error"].to_numpy() / group["parallax_corr"].to_numpy()
    e = np.sqrt(vt_err ** 2 + dist_err_vt ** 2 / 3 + group["rv_error"].to_numpy() ** 2 / 3)
    out = {}
    for j, c in enumerate("UVW"):
        r = chemistry.fit_intrinsic_scatter(UVW[:, j], e)
        out[c] = {"mean": r["mean"], "sigma_int": r["sigma_int"], "median_err": r["median_err"]}
    out["sigma_3d"] = float(np.sqrt(sum(out[c]["sigma_int"] ** 2 for c in "UVW")))
    return out


def match_known_clusters(group: pd.DataFrame, clusters: pd.DataFrame, n: int = 3) -> list[dict]:
    """Nearest Hunt & Reffert (2023) clusters in combined position+velocity distance."""
    if clusters.empty:
        return []
    g = group[["X", "Y", "Z", "U", "V", "W"]].median()
    dpos = np.sqrt((clusters["Xh"] - g["X"]) ** 2 + (clusters["Yh"] - g["Y"]) ** 2 + (clusters["Zh"] - g["Z"]) ** 2)
    dvel = np.sqrt((clusters["U"] - g["U"]) ** 2 + (clusters["V"] - g["V"]) ** 2 + (clusters["W"] - g["W"]) ** 2)
    # velocities missing for clusters without RV: rank on position only, flagged
    score = dpos / 10.0 + np.where(np.isfinite(dvel), dvel, 5.0)
    idx = np.argsort(score.to_numpy())[:n]
    out = []
    for i in idx:
        c = clusters.iloc[i]
        out.append({"name": c["Name"], "type": c["Type"], "n_members_hr23": int(c["N"]),
                    "distance_pc": float(c["dist50"]), "age_myr": float(c["age_myr"]),
                    "r50_pc": float(c["r50pc"]), "rt_pc": float(c["rtpc"]),
                    "centroid_offset_pc": float(dpos.iloc[i]),
                    "velocity_offset_kms": float(dvel.iloc[i]) if np.isfinite(dvel.iloc[i]) else None})
    return out


def chemical_evidence(stars: pd.DataFrame, group: pd.DataFrame, floor=None, n_null: int = 200,
                      seed: int = 0) -> dict:
    """Chemical homogeneity of a group versus matched field stars, stratified by
    evolutionary class.

    ASPCAP abundances of dwarfs and giants carry different systematics (and
    atomic diffusion alters dwarf surface abundances), so each class is compared
    only with field stars of the same class, with its own calibrated floor and
    its own common abundance vector.  ln BF and the null are sums over classes;
    null groups reproduce the group's per-class counts.  ``floor`` overrides the
    calibrated per-class floors (one array for all classes)."""
    Xg, Eg = chemistry.matrices(group)
    keep = np.isfinite(Xg).sum(1) >= 3
    if keep.sum() < 3:
        return {"available": False, "reason": f"only {int(keep.sum())} members with >=3 measured abundances"}
    gk = group[keep]
    Xg, Eg = Xg[keep], Eg[keep]
    cls = chemistry.star_class(gk["LOGG"].to_numpy())
    rng = np.random.default_rng(seed)
    total, null = 0.0, np.zeros(n_null)
    el_delta = np.zeros(len(chemistry.ELEMENTS))
    member_delta = np.zeros(len(gk))
    by_class, ref_parts, resid, resid_var = {}, [], np.full_like(Xg, np.nan), np.full_like(Xg, np.nan)
    floors = {}
    for c in chemistry.CLASSES:
        m = cls == c
        if m.sum() == 0:
            continue
        fl = np.asarray(floor, float) if floor is not None else chemistry.default_floor(c)
        floors[c] = fl
        ref, ref_info = reference_sample(stars, gk[m])
        ref = ref[chemistry.star_class(ref["LOGG"].to_numpy()) == c]
        Xr, Er = chemistry.matrices(ref)
        rk = np.isfinite(Xr).sum(1) >= 3  # null groups obey the members' requirement
        Xr, Er = Xr[rk], Er[rk]
        ref_parts.append(Xr)
        try:
            field = chemistry.FieldModel(Xr, seed=seed)
        except ValueError as e:
            return {"available": False, "reason": f"no usable {c} field model: {e}"}
        t_ref = field.terms(Xr, Er, fl)
        lnbf_c, contrib_c = chemistry.element_contributions(field, Xg[m], Eg[m], fl)
        total += lnbf_c
        el_delta += np.array([x["delta_lnBF"] for x in contrib_c])
        member_delta[m] = chemistry.member_contributions(field, Xg[m], Eg[m], fl) if m.sum() > 1 else 0.0
        nc = int(m.sum())
        null += np.array([field.lnbf_from_terms(t_ref, rng.choice(t_ref.lb.size, size=min(nc, t_ref.lb.size),
                                                                     replace=False)) for _ in range(n_null)])
        # residuals about the class's own weighted mean (for per-element scatter)
        var = Eg[m] ** 2 + fl[None, :] ** 2
        with np.errstate(invalid="ignore", divide="ignore"):
            mu = np.nansum(Xg[m] / var, 0) / np.nansum(np.where(np.isfinite(Xg[m]), 1 / var, 0), 0)
        resid[m] = Xg[m] - mu
        resid_var[m] = var
        by_class[c] = {"n": nc, "ln_bayes_factor": float(lnbf_c), "reference": {**ref_info, "n": int(len(Xr))},
                       "floor": dict(zip(chemistry.ELEMENTS, map(float, fl))),
                       "field_model": {"gmm_components": int(field.w.size), "n_complete_reference_stars": field.n_ref}}
    # per-element intrinsic scatter of class-centred residuals beyond errors + floor
    summary = []
    for k, el in enumerate(chemistry.ELEMENTS):
        r = chemistry.fit_intrinsic_scatter(resid[:, k], np.sqrt(resid_var[:, k]), 0.0)
        r["mean"] = float(np.nanmean(Xg[:, k])) if np.isfinite(Xg[:, k]).any() else float("nan")
        r["median_err"] = float(np.nanmedian(Eg[:, k])) if np.isfinite(Eg[:, k]).any() else float("nan")
        summary.append({"element": el, **r})
    Xall = np.vstack(ref_parts)
    ref_spread = {el: float(1.4826 * np.nanmedian(np.abs(Xall[:, k] - np.nanmedian(Xall[:, k]))))
                  for k, el in enumerate(chemistry.ELEMENTS)}
    members_out = pd.DataFrame({"source_id": gk["source_id"].astype(str).to_numpy(), "class": cls,
                                "delta_lnBF_if_removed": member_delta})
    p_null = float((np.sum(null >= total) + 1) / (null.size + 1))
    any_ref = next(iter(by_class.values()))["reference"]
    return {
        "available": True,
        "n_members_with_chemistry": int(len(gk)),
        "ln_bayes_factor": float(total),
        "null_lnBF": {"median": float(np.median(null)), "p95": float(np.percentile(null, 95)),
                      "p99": float(np.percentile(null, 99)), "values": null.tolist()},
        "empirical_false_positive_rate": p_null,
        "elements": summary,
        "element_contributions": [{"element": el, "delta_lnBF": float(d),
                                   "n_measured": int(np.isfinite(Xg[:, k]).sum())}
                                  for k, (el, d) in enumerate(zip(chemistry.ELEMENTS, el_delta))],
        "member_contributions": members_out.to_dict("records"),
        "by_class": by_class,
        "stratification": "separate field model, floor and common abundance vector per evolutionary class "
                          "(giant: log g < 3.5; dwarf otherwise)",
        "reference": {"n": int(sum(b["reference"]["n"] for b in by_class.values())),
                      "teff": any_ref["teff"], "logg": any_ref["logg"], "R_kpc": any_ref["R_kpc"],
                      "widened": any(b["reference"]["widened"] for b in by_class.values())},
        "reference_spread": ref_spread,
        "floor": {c: dict(zip(chemistry.ELEMENTS, map(float, f))) for c, f in floors.items()},
    }


def galah_check(group: pd.DataFrame) -> dict:
    cols = [c for c in group.columns if c.startswith("galah_") and c.endswith("_H") or
            (c.startswith("galah_") and c.endswith("_FE"))]
    if not cols or group[cols].notna().sum().max() < 3:
        return {"available": False, "n": int(group[cols].notna().any(axis=1).sum()) if cols else 0}
    out = []
    for c in cols:
        x = group[c].to_numpy(float)
        e = group[c + "_ERR"].to_numpy(float)
        r = chemistry.fit_intrinsic_scatter(x, e, 0.0)
        if r["n"] >= 3:
            out.append({"element": c.replace("galah_", ""), **r})
    return {"available": bool(out), "elements": out,
            "n": int(group[cols].notna().any(axis=1).sum())}


def age_evidence(stars: pd.DataFrame, group: pd.DataFrame, ref: pd.DataFrame | None = None) -> dict:
    g = group[group["is_giant"] & group["age_gyr"].notna()]
    if len(g) < 3:
        return {"available": False, "n": int(len(g)),
                "reason": "astroNN ages are only meaningful for red giants; fewer than 3 giant members"}
    r = chemistry.fit_intrinsic_scatter(np.log10(g["age_gyr"].to_numpy()),
                                        (g["age_err_gyr"] / g["age_gyr"] / np.log(10)).to_numpy())
    field = stars[stars["is_giant"] & stars["age_gyr"].notna()]
    return {"available": True, "n": int(len(g)), "median_age_gyr": float(np.median(g["age_gyr"])),
            "log_age_sigma_int": r["sigma_int"], "log_age_sigma_int_upper95": r["sigma_int_upper95"],
            "median_fractional_error": float(np.median(g["age_err_gyr"] / g["age_gyr"])),
            "field_log_age_spread": float(np.std(np.log10(field["age_gyr"].clip(0.1)))),
            "note": "astroNN (Mackereth et al. 2019) ages are data-driven estimates trained on APOKASC "
                    "asteroseismic ages; typical uncertainty ~30%; model-dependent."}


def occam_labels(group: pd.DataFrame) -> dict:
    lab = group.loc[group["occam_cg_prob"] >= 0.5, "occam_cluster"].value_counts()
    return {str(k): int(v) for k, v in lab.items()}
