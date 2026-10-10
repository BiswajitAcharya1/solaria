"""Calibration and validation against known open clusters (OCCAM, Myers et al. 2022).

Design (avoids testing on the calibration set):
  * OCCAM clusters with >= 6 high-probability members in the analysis sample
    are split alternately (by name) into a CALIBRATION half and a TEST half.
  * Calibration half -> per-element systematic floor (median intrinsic
    scatter of members, errors deconvolved).
  * Test half -> (1) pair statistics: recall of member pairs vs. the chemical
    doppelganger rate of matched field pairs; (2) group evidence ratio for
    true clusters, contaminated clusters and random field groups;
    (3) discovery: kinematics-only HDBSCAN vs. kinematics + chemical vetting,
    scored against OCCAM membership.

Membership truth = OCCAM CG_PROB >= 0.7 and RV_PROB >= 0.5 (Gaia astrometric
membership from Cantat-Gaudin et al. plus APOGEE RV); the [Fe/H] membership
probability is NOT used so chemistry is not circular.
"""
from __future__ import annotations

import json
import time

import numpy as np
import pandas as pd

from . import chemistry, families
from . import config as C


def truth_members(s: pd.DataFrame) -> pd.DataFrame:
    m = (s["occam_cg_prob"] >= 0.7) & (s["occam_rv_prob"] >= 0.5)
    return s[m]


def _members(s: pd.DataFrame, cl: str) -> np.ndarray:
    return np.where((s["occam_cluster"] == cl).to_numpy() & (s["occam_cg_prob"] >= 0.7).to_numpy() &
                    (s["occam_rv_prob"] >= 0.5).to_numpy())[0]


def calibrate_floor(s: pd.DataFrame, clusters: list[str], min_n: int = 5) -> dict:
    """Systematic floor per element and evolutionary class = median (over calibration
    clusters) of the members' intrinsic scatter beyond the formal errors."""
    X, E = chemistry.matrices(s)
    klass = chemistry.star_class(s["LOGG"].to_numpy())
    per = {}
    for cl in clusters:
        idx = _members(s, cl)
        for c in chemistry.CLASSES:
            ii = idx[klass[idx] == c]
            if ii.size < min_n:
                continue
            per[f"{cl}|{c}"] = {"n": int(ii.size), **{el: chemistry.fit_intrinsic_scatter(X[ii, k], E[ii, k])["sigma_int"]
                                                     for k, el in enumerate(chemistry.ELEMENTS)}}
    by_class = {}
    for c in chemistry.CLASSES:
        keys = [k for k in per if k.endswith("|" + c)]
        if keys:
            by_class[c] = {el: max(float(np.nanmedian([per[k][el] for k in keys])), 0.005) for el in chemistry.ELEMENTS}
            by_class[c]["_n_strata"] = len(keys)
    overall = {el: max(float(np.nanmedian([v[el] for v in per.values()])), 0.005) for el in chemistry.ELEMENTS}
    return {"floor": overall, "floor_by_class": by_class, "per_cluster_class": per, "clusters": clusters,
            "min_members_per_stratum": min_n}


def pair_test(s: pd.DataFrame, clusters: list[str], n_field_pairs: int = 20000, seed: int = 0):
    """Recall of same-cluster pairs vs the 'chemical doppelganger' rate of matched field
    pairs (Ness et al. 2018 style), per evolutionary class with that class's floor."""
    X, E = chemistry.matrices(s)
    rng = np.random.default_rng(seed)
    klass = chemistry.star_class(s["LOGG"].to_numpy())
    teff, logg = s["TEFF"].to_numpy(), s["LOGG"].to_numpy()
    out = {}
    for c in chemistry.CLASSES:
        floor = chemistry.default_floor(c)
        intra = []
        for cl in clusters:
            idx = _members(s, cl)
            idx = idx[klass[idx] == c]
            for a in range(idx.size):
                for b in range(a + 1, idx.size):
                    i, j = idx[a], idx[b]
                    if abs(teff[i] - teff[j]) > 300 or abs(logg[i] - logg[j]) > 0.3:
                        continue  # compare like with like, as for field pairs
                    _, dof, p, _ = chemistry.pair_chi2(X[i], E[i], X[j][None], E[j][None], floor)
                    if dof[0] >= 6:
                        intra.append(p[0])
        field = np.where(s["occam_cluster"].isna().to_numpy() & (np.isfinite(X).sum(1) >= 8) & (klass == c))[0]
        order = field[np.argsort(teff[field])]
        fp, tries = [], 0
        while len(fp) < n_field_pairs and tries < n_field_pairs * 5 and order.size > 60:
            tries += 1
            a = rng.integers(order.size - 50)
            i, j = order[a], order[a + rng.integers(1, 50)]
            if abs(teff[i] - teff[j]) > 300 or abs(logg[i] - logg[j]) > 0.3:
                continue
            _, dof, p, _ = chemistry.pair_chi2(X[i], E[i], X[j][None], E[j][None], floor)
            if dof[0] >= 6:
                fp.append(p[0])
        intra, fp = np.array(intra), np.array(fp)
        out[c] = {"n_member_pairs": int(intra.size), "n_field_pairs": int(fp.size), "thresholds": [
            {"p_threshold": thr, "member_pair_recall": float(np.mean(intra > thr)) if intra.size else None,
             "field_doppelganger_rate": float(np.mean(fp > thr)) if fp.size else None}
            for thr in (0.01, 0.05, 0.2)]}
    return out


def group_bf_test(s: pd.DataFrame, clusters: list[str], n_null: int = 200, seed: int = 0):
    """Stratified evidence ratio for true clusters, half-contaminated clusters and the null."""
    rng = np.random.default_rng(seed)
    rows = []
    for cl in clusters:
        g = s.iloc[_members(s, cl)]
        X, _ = chemistry.matrices(g)
        g = g[np.isfinite(X).sum(1) >= 3]
        if len(g) < 6:
            continue
        ev = families.chemical_evidence(s, g, None, n_null=n_null, seed=seed)
        if not ev["available"]:
            continue
        # contaminate: replace half of the members by field stars of the same class/Teff/location
        k = len(g) // 2
        keep = g.sample(len(g) - k, random_state=seed)
        ref, _ = families.reference_sample(s, g)
        ref = ref[ref["source_id"].isin(s.loc[s["occam_cluster"].isna(), "source_id"])]
        Xr, _ = chemistry.matrices(ref)
        ref = ref[np.isfinite(Xr).sum(1) >= 3]
        cls_g = chemistry.star_class(g["LOGG"].to_numpy())
        repl = []
        for c in chemistry.CLASSES:
            nc = int(round(k * np.mean(cls_g == c)))
            pool = ref[chemistry.star_class(ref["LOGG"].to_numpy()) == c]
            if nc and len(pool):
                repl.append(pool.sample(min(nc, len(pool)), random_state=int(rng.integers(1e9))))
        gc = pd.concat([keep] + repl)
        evc = families.chemical_evidence(s, gc, None, n_null=n_null, seed=seed)
        rows.append({"cluster": cl, "n": int(len(g)),
                     "n_giant": int((cls_g == "giant").sum()), "n_dwarf": int((cls_g == "dwarf").sum()),
                     "lnBF": ev["ln_bayes_factor"], "null_median": ev["null_lnBF"]["median"],
                     "null_p99": ev["null_lnBF"]["p99"], "fpr": ev["empirical_false_positive_rate"],
                     "lnBF_half_contaminated": evc["ln_bayes_factor"] if evc["available"] else None,
                     "fpr_contaminated": evc["empirical_false_positive_rate"] if evc["available"] else None,
                     "by_class": {c: v["ln_bayes_factor"] for c, v in ev["by_class"].items()}})
    return rows


def _score(pred: set, truth: set):
    tp = len(pred & truth)
    return (tp / len(pred) if pred else 0.0), (tp / len(truth) if truth else 0.0)


def chemical_vetting(grp: pd.DataFrame, max_sigma: float = 0.03, p_min: float = 0.01) -> np.ndarray:
    """Keep members whose abundances agree with their evolutionary class's robust group mean
    (errors + calibrated class floor + group intrinsic scatter up to ``max_sigma``)."""
    from scipy import stats
    Xg, Eg = chemistry.matrices(grp)
    klass = chemistry.star_class(grp["LOGG"].to_numpy())
    keep = np.ones(len(grp), bool)
    for c in chemistry.CLASSES:
        m = klass == c
        if m.sum() < 3:
            continue  # too few to define a class mean: keep (no evidence either way)
        floor = chemistry.default_floor(c)
        mu = np.nanmedian(Xg[m], axis=0)
        spread = np.array([chemistry.fit_intrinsic_scatter(Xg[m, k], Eg[m, k], floor[k])["sigma_int"]
                           for k in range(Xg.shape[1])])
        spread = np.where(np.isfinite(spread), np.minimum(spread, max_sigma), 0.0)
        terms = (Xg[m] - mu) ** 2 / (Eg[m] ** 2 + floor ** 2 + spread ** 2)
        ok = np.isfinite(terms)
        chi2, dof = np.where(ok, terms, 0).sum(1), ok.sum(1)
        pval = np.where(dof > 0, stats.chi2.sf(chi2, np.maximum(dof, 1)), 1.0)
        keep[np.where(m)[0]] = pval > p_min
    return keep


def discovery_test(s: pd.DataFrame, clusters: list[str], radius_pc: float = 150.0,
                   configs=(("eom", 10.0), ("eom", 30.0), ("leaf", 10.0))):
    rows = []
    for cl in clusters:
        t = s.iloc[_members(s, cl)]
        if len(t) < 8 or t["dist_pc"].median() > 2500:
            continue
        truth = set(t["source_id"])
        centre = tuple(t[["X", "Y", "Z"]].median())
        region = s[families.region_mask(s, centre, radius_pc, min_poe=5.0)]
        for selection, ps in configs:
            fparams = {"pos_scale_pc": ps, "vel_scale_kms": 1.0}
            lab = families.discover(region, "phase_space", min_cluster_size=6, min_samples=4,
                                    params=fparams, selection=selection)
            best, best_f1 = None, -1
            for L in set(lab) - {-1}:
                p, r = _score(set(region["source_id"][lab == L]), truth)
                f1 = 2 * p * r / (p + r) if p + r else 0
                if f1 > best_f1:
                    best, best_f1 = L, f1
            row = {"cluster": cl, "selection": selection, "pos_scale_pc": ps, "n_truth": len(truth),
                   "n_region": int(len(region)), "found": best is not None}
            if best is not None:
                grp = region[lab == best]
                p0, r0 = _score(set(grp["source_id"]), truth)
                keep = chemical_vetting(grp)
                p1, r1 = _score(set(grp["source_id"][keep]), truth)
                sig = families.phase_space_significance(families.features(region, "phase_space", fparams), lab, k=4)
                row.update({"n_group": int(len(grp)), "kin_precision": p0, "kin_recall": r0,
                            "n_after_chem": int(keep.sum()), "kinchem_precision": p1, "kinchem_recall": r1,
                            "false_alarm_probability": sig[int(best)]["false_alarm_probability"]})
            rows.append(row)
    return rows


def main() -> None:
    t0 = time.time()
    s = pd.read_parquet(C.STARS_PARQUET)
    tm = truth_members(s)
    counts = tm["occam_cluster"].value_counts()
    eligible = sorted(counts[counts >= 6].index)
    calib, test = eligible[0::2], eligible[1::2]
    print(f"{len(eligible)} OCCAM clusters with >=6 members: {len(calib)} calibration, {len(test)} test")
    cal = calibrate_floor(s, calib)
    C.CALIBRATION_JSON.write_text(json.dumps(cal, indent=1))
    chemistry.default_floor.cache_clear()
    for c, f in cal["floor_by_class"].items():
        print(f"floor[{c}] ({f['_n_strata']} strata):", {k: round(v, 3) for k, v in f.items() if not k.startswith("_")})
    pairs = pair_test(s, test)
    print("pairs:", json.dumps(pairs))
    bf = group_bf_test(s, test)
    print(pd.DataFrame(bf).drop(columns=["by_class"]).to_string())
    disc = discovery_test(s, eligible)
    dd = pd.DataFrame(disc)
    print(dd.to_string())
    summ = {}
    for (sel, ps), g in dd[dd["found"] == True].groupby(["selection", "pos_scale_pc"]):  # noqa: E712
        key = f"{sel}_{ps:g}pc"
        summ[key] = {k: float(g[k].mean()) for k in ("kin_precision", "kin_recall", "kinchem_precision",
                                                       "kinchem_recall")}
        summ[key]["n_clusters_found"] = int(len(g))
        summ[key]["n_clusters_tested"] = int(((dd["selection"] == sel) & (dd["pos_scale_pc"] == ps)).sum())
    out = {"generated": time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime()), "calibration_clusters": calib,
           "test_clusters": test, "floor": cal["floor"], "floor_by_class": cal["floor_by_class"],
           "pairs": pairs, "group_evidence": bf, "discovery": disc, "discovery_summary": summ,
           "truth_definition": "OCCAM CG_PROB >= 0.7 and RV_PROB >= 0.5 ([Fe/H] membership not used)"}
    C.VALIDATION_JSON.write_text(json.dumps(out, indent=1, default=float))
    print("discovery summary:", json.dumps(summ, indent=1))
    print(f"validation done in {time.time() - t0:.0f}s -> {C.VALIDATION_JSON}")


if __name__ == "__main__":
    main()
