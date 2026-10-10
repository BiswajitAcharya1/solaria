"""High-level investigations combining the scientific modules.

Every public function returns plain JSON-serialisable dicts and records the
assumptions it used in ``provenance`` so results can be exported and rerun.
"""
from __future__ import annotations

import hashlib
import json
import time

import numpy as np
import pandas as pd
from scipy import stats

from . import anomalies, chemistry, constellations, families, merger, orbits, traceback
from . import config as C
from .store import STORE

VERSION = "0.1.0"
MAX_DISCOVERY_STARS = 30_000


def _f(x):
    """float or None"""
    try:
        x = float(x)
    except (TypeError, ValueError):
        return None
    return x if np.isfinite(x) else None


def provenance(params: dict) -> dict:
    p = {
        "software": f"Palimpsest {VERSION}",
        "timestamp_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "data": {
            "astrometry": "Gaia DR3 (gaiadr3.gaia_source via Gaia@AIP TAP mirror)",
            "spectroscopy": "SDSS-IV APOGEE DR17 allStarLite-dr17-synspec_rev1 (ASPCAP abundances, VHELIO_AVG RVs)",
            "cross_match": "APOGEE DR17 GAIAEDR3_SOURCE_ID (EDR3 = DR3 astrometry)",
            "ages": "APOGEE DR17 astroNN VAC (age_lowess_correct)",
            "cluster_membership": "APOGEE DR17 OCCAM VAC; Hunt & Reffert 2023 (J/A+A/673/A114)",
            "independent_abundances": "GALAH DR4 allstar_240705 (not merged; cross-check only)",
        },
        "selection": C.SELECTION,
        "parallax_zero_point": "Lindegren et al. 2021 recipe (gaiadr3-zeropoint); -0.017 mas where undefined",
        "solar_motion_UVW_kms": C.SOLAR_MOTION_UVW,
        "solar_height_kpc": C.SOLAR_Z_KPC,
        "chemistry_elements": C.CHEM_ELEMENTS,
        "chemistry_floor_dex": {c: dict(zip(C.CHEM_ELEMENTS, map(float, chemistry.default_floor(c))))
                                for c in chemistry.CLASSES},
        "parameters": params,
    }
    p["hash"] = hashlib.sha1(json.dumps(params, sort_keys=True, default=str).encode()).hexdigest()[:12]
    return p


def _row_out(r: pd.Series) -> dict:
    meas = {
        "ra_deg": _f(r["ra"]), "dec_deg": _f(r["dec"]),
        "parallax_mas": _f(r["parallax"]), "parallax_error_mas": _f(r["parallax_error"]),
        "parallax_zero_point_mas": _f(r["zpt_used"]),
        "pmra_masyr": _f(r["pmra"]), "pmra_error": _f(r["pmra_error"]),
        "pmdec_masyr": _f(r["pmdec"]), "pmdec_error": _f(r["pmdec_error"]),
        "pmra_pmdec_corr": _f(r["pmra_pmdec_corr"]), "parallax_pmra_corr": _f(r["parallax_pmra_corr"]),
        "parallax_pmdec_corr": _f(r["parallax_pmdec_corr"]),
        "rv_apogee_kms": _f(r["rv"]), "rv_error_kms": _f(r["rv_error"]),
        "rv_gaia_kms": _f(r["radial_velocity"]), "rv_gaia_error_kms": _f(r["radial_velocity_error"]),
        "apogee_nvisits": int(r["NVISITS"]), "apogee_vscatter_kms": _f(r["VSCATTER"]),
        "ruwe": _f(r["ruwe"]), "G": _f(r["phot_g_mean_mag"]), "bp_rp": _f(r["bp_rp"]),
        "H_2mass": _f(r["H"]), "teff_K": _f(r["TEFF"]), "logg": _f(r["LOGG"]), "snr": _f(r["SNR"]),
    }
    abund = [{"element": C.CHEM_LABELS[el], "key": el, "value": _f(r[el]), "error": _f(r[el + "_ERR"]),
              "galah": _f(r.get("galah_" + el)), "galah_error": _f(r.get("galah_" + el + "_ERR"))}
             for el in C.CHEM_ELEMENTS]
    derived = {
        "distance_pc": _f(r["dist_pc"]),
        "X_pc": _f(r["X"]), "Y_pc": _f(r["Y"]), "Z_pc": _f(r["Z"]),
        "U_kms": _f(r["U"]), "V_kms": _f(r["V"]), "W_kms": _f(r["W"]),
        "R_gal_kpc": _f(r["R"]), "z_gal_kpc": _f(r["z"]), "v_phi_kms": _f(r["vT"]),
        "E_kms2": _f(r["E"]), "Lz_kpckms": _f(r["Lz"]), "J_R_kpckms": _f(r["J_R"]), "J_z_kpckms": _f(r["J_z"]),
        "eccentricity": _f(r["ecc"]), "zmax_kpc": _f(r["zmax"]), "rperi_kpc": _f(r["rperi"]),
        "rapo_kpc": _f(r["rap"]),
        "age_astroNN_gyr": _f(r["age_gyr"]) if r["is_giant"] else None,
        "age_astroNN_error_gyr": _f(r["age_err_gyr"]) if r["is_giant"] else None,
    }
    return {"source_id": str(r["source_id"]), "apogee_id": r["APOGEE_ID"], "measured": meas,
            "abundances": abund, "derived": derived,
            "occam": {"cluster": r["occam_cluster"] if isinstance(r["occam_cluster"], str) else None,
                      "cg_prob": _f(r["occam_cg_prob"])},
            "flags": {"rv_variable": bool(r["flag_rv_variable"]), "single_visit": bool(r["flag_single_visit"]),
                      "giant": bool(r["is_giant"])}}


_ANOM = None


def anomaly_model():
    global _ANOM
    if _ANOM is None:
        _ANOM = anomalies.AnomalyModel(STORE.stars)
    return _ANOM


def star_detail(source_id: int) -> dict:
    i = STORE.index_of([source_id])[0]
    r = STORE.stars.iloc[i]
    out = _row_out(r)
    out["merger_test"] = merger.star_test(r)
    out["anomaly"] = anomaly_model().explain(i)
    out["data_sources"] = provenance({})["data"]
    return out


def search(q: str, limit: int = 20) -> list[dict]:
    s = STORE.stars
    q = q.strip()
    if q.isdigit():
        m = s["source_id_str"].str.startswith(q)
    else:
        m = s["APOGEE_ID"].str.contains(q, case=False, regex=False) | \
            s["occam_cluster"].fillna("").str.contains(q, case=False, regex=False)
    r = s[m].head(limit)
    return [{"source_id": a, "apogee_id": b, "cluster": c if isinstance(c, str) else None, "dist_pc": float(d),
             "feh": _f(f)} for a, b, c, d, f in zip(r["source_id_str"], r["APOGEE_ID"], r["occam_cluster"],
                                                     r["dist_pc"], r["FE_H"])]


# ---------------------------------------------------------------------------
# Orbit history
# ---------------------------------------------------------------------------
def orbit_history(source_ids: list[int], lookback_myr: float = C.DEFAULT_LOOKBACK_MYR, n_mc: int = 32,
                  potentials: list[str] | None = None, n_out_samples: int = 12) -> dict:
    lookback_myr = float(min(abs(lookback_myr), C.MAX_LOOKBACK_MYR))
    potentials = potentials or [C.DEFAULT_POTENTIAL]
    df = STORE.stars.iloc[STORE.index_of(source_ids)]
    res = {"source_ids": [str(s) for s in df["source_id"]], "lookback_myr": lookback_myr, "n_mc": n_mc,
           "runs": {}}
    step = 2
    for pot in potentials:
        tb = traceback.trajectories(df, lookback_myr, n_mc, pot)
        xyz = tb.xyz_pc                                           # (n, mc, nt, 3)
        spread = np.linalg.norm(xyz - xyz[:, :1], axis=-1)        # distance from nominal
        stars_out = []
        for k in range(len(df)):
            stars_out.append({
                "source_id": str(df["source_id"].iloc[k]),
                "nominal": np.round(xyz[k, 0, ::step], 2).tolist(),
                "samples": np.round(xyz[k, 1:n_out_samples + 1, ::step], 2).tolist(),
                "spread_pc_p50": np.round(np.median(spread[k], axis=0)[::step], 2).tolist(),
                "spread_pc_p84": np.round(np.percentile(spread[k], 84, axis=0)[::step], 2).tolist(),
                "galcen_nominal_kpc": np.round(tb.galcen_xyz_kpc[k, 0, ::step], 4).tolist(),
            })
        res["runs"][pot] = {"times_myr": tb.times_myr[::step].tolist(), "stars": stars_out,
                            "sun_galcen_kpc": np.round(tb.sun_galcen_kpc[::step], 4).tolist(),
                            "ro_kpc": tb.ro, "vo_kms": tb.vo}
    if len(potentials) > 1:
        a, b = potentials[:2]
        diffs = []
        for sa, sb in zip(res["runs"][a]["stars"], res["runs"][b]["stars"]):
            d = np.linalg.norm(np.array(sa["nominal"]) - np.array(sb["nominal"]), axis=-1)
            diffs.append({"source_id": sa["source_id"], "separation_pc": np.round(d, 2).tolist()})
        res["potential_difference"] = {"between": [a, b], "stars": diffs}
    res["caveats"] = [
        "Positions are in a frame centred on the Sun and co-rotating with the Sun's own (integrated) orbit.",
        "The Galactic potential is static and axisymmetric: the bar, spiral arms, molecular clouds and "
        "the Sagittarius dwarf are not modelled; their perturbations grow with look-back time.",
        "Monte Carlo spread reflects measurement uncertainty only (Gaia astrometry with covariances, "
        "APOGEE RV); model uncertainty is explored by switching the potential.",
    ]
    res["provenance"] = provenance({"op": "orbit_history", "source_ids": res["source_ids"],
                                    "lookback_myr": lookback_myr, "n_mc": n_mc, "potentials": potentials})
    return res


# ---------------------------------------------------------------------------
# Chemistry neighbours and sibling search
# ---------------------------------------------------------------------------
def chemical_neighbours(source_id: int, n: int = 25, same_class: bool = True) -> dict:
    s = STORE.stars
    X, E = STORE.chem
    i = STORE.index_of([source_id])[0]
    n_meas = int(np.isfinite(X[i]).sum())
    if n_meas < 6:
        return {"source_id": str(source_id), "neighbours": [], "n_compared": 0, "n_indistinguishable_p05": 0,
                "interpretation": f"This star has only {n_meas} reliably measured elements; at least 6 are "
                                  "required for a meaningful chemical comparison."}
    klass = str(chemistry.star_class(s["LOGG"].iloc[i]))
    chi2, dof, p, terms = chemistry.pair_chi2(X[i], E[i], X, E, chemistry.default_floor(klass))
    valid = dof >= 6
    valid[i] = False
    if same_class:
        valid &= (s["is_giant"] == s["is_giant"].iloc[i]).to_numpy()
    red = np.where(valid, chi2 / np.maximum(dof, 1), np.inf)
    order = np.argsort(red)[:n]
    n_indist = int(np.sum(valid & (p > 0.05)))
    rows = []
    for j in order:
        rows.append({"source_id": str(s["source_id"].iloc[j]), "chi2": float(chi2[j]), "dof": int(dof[j]),
                     "p_value": float(p[j]), "dist_pc": float(s["dist_pc"].iloc[j]),
                     "separation_pc": float(np.linalg.norm(s[["X", "Y", "Z"]].iloc[j].to_numpy() -
                                                          s[["X", "Y", "Z"]].iloc[i].to_numpy())),
                     "dv_kms": float(np.linalg.norm(s[["U", "V", "W"]].iloc[j].to_numpy() -
                                                   s[["U", "V", "W"]].iloc[i].to_numpy())),
                     "terms": {el: _f(t) for el, t in zip(C.CHEM_ELEMENTS, terms[j])}})
    return {"source_id": str(source_id), "neighbours": rows, "n_compared": int(valid.sum()),
            "n_indistinguishable_p05": n_indist,
            "interpretation": (f"{n_indist} of {int(valid.sum())} comparable stars are chemically "
                               "indistinguishable from this star at p > 0.05. Chemistry alone therefore cannot "
                               "identify siblings in a large survey (the 'chemical doppelganger' problem, "
                               "Ness et al. 2018); dynamical evidence is required.")}


def _action_mc(r: pd.Series, n: int, birth_sigma_kms: float, rng) -> np.ndarray:
    """Monte Carlo of (sqrt J_R, L_z, sqrt J_z) for one star: astrometric/RV errors,
    optionally plus an isotropic birth velocity dispersion added to (v_R, v_T, v_z)."""
    from galpy.orbit import Orbit

    rows = {k: np.array([r[k]], dtype=float) for k in (
        "parallax_error", "pmra", "pmra_error", "pmdec", "pmdec_error", "rv", "rv_error",
        "parallax_pmra_corr", "parallax_pmdec_corr", "pmra_pmdec_corr")}
    rows["parallax"] = np.array([r["parallax"] - r["zpt_used"]], dtype=float)
    smp = orbits.sample_astrometry(rows, n, rng)
    o = orbits.make_orbit(np.full(n, r["ra"]), np.full(n, r["dec"]), 1.0 / smp["parallax"][0],
                          smp["pmra"][0], smp["pmdec"][0], smp["rv"][0])
    if birth_sigma_kms > 0:
        # galpy interprets plain arrays as *natural* units: work in R/ro and v/vo.
        _, ro, vo = orbits.get_potential()
        nat = dict(use_physical=False)
        dv = rng.normal(0.0, birth_sigma_kms / vo, (3, n))
        vxvv = np.column_stack([o.R(**nat), o.vR(**nat) + dv[0], o.vT(**nat) + dv[1], o.z(**nat),
                                o.vz(**nat) + dv[2], o.phi(**nat)])
        o = Orbit(vxvv, ro=ro, vo=vo, zo=C.SOLAR_Z_KPC, solarmotion=orbits.galpy_solarmotion())
    op = orbits.orbital_parameters(o)
    return np.column_stack([np.sqrt(np.clip(op["J_R"], 0, None)), op["Lz"], np.sqrt(np.clip(op["J_z"], 0, None))])


def sibling_search(source_id: int, birth_sigma_kms: float = 1.0, p_chem: float = 0.05,
                   n_traceback: int = 8, lookback_myr: float = 100.0, seed: int = 3) -> dict:
    """Search the whole sample for stars compatible with a common birth site."""
    s = STORE.stars
    X, E = STORE.chem
    i = STORE.index_of([source_id])[0]
    r = s.iloc[i]
    rng = np.random.default_rng(seed)
    A_err = _action_mc(r, 200, 0.0, rng)
    A_birth = _action_mc(r, 200, birth_sigma_kms, rng)
    if not (np.all(np.isfinite(A_err)) and np.all(np.isfinite(A_birth))):
        raise ValueError("orbital actions are undefined for this star (e.g. unbound or extreme orbit); "
                         "the action-space sibling test cannot be applied")
    # Covariance = seed errors + birth dispersion (A_birth contains both) + candidate errors.
    # Candidate action errors are approximated by the seed's, scaled by (d_cand/d_seed)^2:
    # at fixed parallax error the distance error, which dominates, grows as d^2.
    S_birth = np.cov(A_birth.T)
    S_err = np.cov(A_err.T)
    scale = (s["dist_pc"].to_numpy() / float(r["dist_pc"])) ** 2
    A = np.column_stack([np.sqrt(s["J_R"].clip(0)), s["Lz"], np.sqrt(s["J_z"].clip(0))])
    d = A - A[i]
    cov = S_birth[None, :, :] + scale[:, None, None] * S_err[None, :, :]
    m2 = np.einsum("ij,ijk,ik->i", d, np.linalg.inv(cov), d)
    dyn_ok = m2 < stats.chi2.ppf(0.95, 3)
    if int(np.isfinite(X[i]).sum()) < 6:
        raise ValueError("this star has fewer than 6 measured elements; the chemical test needs at least 6")
    floor = chemistry.default_floor(str(chemistry.star_class(r["LOGG"])))
    chi2, dof, p, _ = chemistry.pair_chi2(X[i], E[i], X, E, floor)
    chem_ok = (dof >= 6) & (p > p_chem)
    comparable = (dof >= 6) & np.isfinite(m2) & (s["is_giant"] == r["is_giant"]).to_numpy()
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
        rows.append({"source_id": str(s["source_id"].iloc[j]), "mahalanobis2_actions": float(m2[j]),
                     "chem_chi2": float(chi2[j]), "chem_dof": int(dof[j]), "chem_p": float(p[j]),
                     "separation_pc": float(np.linalg.norm(s[["X", "Y", "Z"]].iloc[j].to_numpy() -
                                                          r[["X", "Y", "Z"]].to_numpy().astype(float))),
                     "dv_kms": float(np.linalg.norm(s[["U", "V", "W"]].iloc[j].to_numpy() -
                                                   r[["U", "V", "W"]].to_numpy().astype(float))),
                     "age_gyr": _f(s["age_gyr"].iloc[j]) if s["is_giant"].iloc[j] else None})
    # past proximity for the top candidates
    tb_rows = []
    if len(cand):
        top = cand[:n_traceback]
        sub = s.iloc[np.concatenate([[i], top])]
        tb = traceback.trajectories(sub, lookback_myr, 24, C.DEFAULT_POTENTIAL, seed=seed)
        x0 = tb.xyz_pc[0]
        for k, j in enumerate(top):
            dd = np.linalg.norm(tb.xyz_pc[k + 1] - x0, axis=-1)   # (mc, nt)
            jm = np.argmin(dd, axis=1)
            dmin = dd[np.arange(dd.shape[0]), jm]
            tb_rows.append({"source_id": str(s["source_id"].iloc[j]),
                            "d_min_pc": {"median": float(np.median(dmin)), "p16": float(np.percentile(dmin, 16)),
                                         "p84": float(np.percentile(dmin, 84))},
                            "t_min_myr": float(np.median(tb.times_myr[jm])),
                            "separation_now_pc": float(dd[0, 0])})
    return {
        "seed": str(source_id), "birth_velocity_dispersion_kms": birth_sigma_kms,
        "counts": {"comparable_stars": N, "chemically_compatible": n_chem, "dynamically_compatible": n_dyn,
                   "both": n_both, "expected_both_if_independent": expected,
                   "enrichment": (n_both / expected) if expected > 0 else None},
        "candidates": rows, "traceback": tb_rows,
        "method": {
            "dynamics": "Mahalanobis distance in (sqrt J_R, L_z, sqrt J_z) with covariance from Monte Carlo of "
                        "the seed's astrometric errors plus a birth velocity dispersion, plus candidate errors "
                        "approximated as the seed's scaled by (d_candidate/d_seed)^2; compatible if inside the "
                        "95% region (chi2, 3 dof).",
            "chemistry": f"chi-square over >=6 shared elements with systematic floor; compatible if p > {p_chem}.",
            "chance": "Expected number passing both if chemistry and dynamics were independent = "
                      "N_chem x N_dyn / N. An excess over this shows that chemistry and orbits are correlated "
                      "for this star's neighbours (as expected for genuine siblings or for broad Galactic "
                      "chemo-dynamical gradients) - it does not by itself identify siblings.",
        },
        "caveats": [
            "Actions change through radial migration and heating over Gyr; for old stars action matching "
            "constrains only recent shared history.",
            "Candidate action uncertainties are a first-order scaling of the seed's, not a per-star Monte "
            "Carlo; the dynamical test is approximate for candidates with very different astrometric quality.",
            "Chemical compatibility is necessary but far from sufficient: many unrelated stars are chemically "
            "indistinguishable at APOGEE precision.",
        ],
        "provenance": provenance({"op": "sibling_search", "seed": str(source_id),
                                  "birth_sigma_kms": birth_sigma_kms, "p_chem": p_chem,
                                  "lookback_myr": lookback_myr, "seed_rng": seed}),
    }


# ---------------------------------------------------------------------------
# Discovery and group evaluation
# ---------------------------------------------------------------------------
def discover(center_pc=(0, 0, 0), radius_pc=500.0, mode="phase_space", min_cluster_size=8, min_samples=5,
             min_poe=10.0, pos_scale_pc=10.0, vel_scale_kms=1.0, max_groups=40,
             selection: str = "eom") -> dict:
    s = STORE.stars
    m = families.region_mask(s, center_pc, radius_pc, min_poe)
    if m.sum() > MAX_DISCOVERY_STARS:
        raise ValueError(f"region contains {int(m.sum())} stars; clustering is limited to "
                         f"{MAX_DISCOVERY_STARS} for interactive use - reduce the radius or raise the "
                         "parallax/error cut")
    region = s[m]
    fparams = {"pos_scale_pc": pos_scale_pc, "vel_scale_kms": vel_scale_kms}
    if selection not in ("eom", "leaf"):
        raise ValueError("selection must be 'eom' or 'leaf'")
    labels = families.discover(region, mode, min_cluster_size, min_samples, fparams, selection=selection)
    signif = (families.phase_space_significance(families.features(region, mode, fparams), labels,
                                                k=min_samples or 5) if mode == "phase_space" else {})
    groups = []
    for lab in sorted(set(labels) - {-1}):
        g = region[labels == lab]
        occ = families.occam_labels(g)
        n_chem = int((np.isfinite(chemistry.matrices(g)[0]).sum(1) >= 3).sum())
        groups.append({
            "label": int(lab), "n": int(len(g)), "n_with_chemistry": n_chem,
            "source_ids": g["source_id_str"].tolist(),
            "centroid_pc": [float(v) for v in g[["X", "Y", "Z"]].median()],
            "mean_uvw_kms": [float(v) for v in g[["U", "V", "W"]].median()],
            "size_pc": float(np.median(np.linalg.norm(g[["X", "Y", "Z"]] - g[["X", "Y", "Z"]].median(), axis=1))),
            "sigma_v_kms": float(np.sqrt(np.sum(np.var(g[["U", "V", "W"]].to_numpy(), axis=0)))),
            "feh_median": _f(g["FE_H"].median()), "feh_spread": _f(g["FE_H"].std()),
            "occam_members": occ,
            "known_match": families.match_known_clusters(g, STORE.clusters, n=1),
            "significance": signif.get(int(lab)),
        })
    groups.sort(key=lambda g: -g["n"])
    return {"n_region": int(m.sum()), "n_grouped": int((labels >= 0).sum()), "groups": groups[:max_groups],
            "parameters": {"center_pc": list(center_pc), "radius_pc": radius_pc, "mode": mode,
                           "min_cluster_size": min_cluster_size, "min_samples": min_samples,
                           "min_parallax_over_error": min_poe, "pos_scale_pc": pos_scale_pc,
                           "vel_scale_kms": vel_scale_kms, "selection": selection},
            "note": "Groups are kinematic candidates only. Chemistry, ages and traceback are evaluated "
                    "separately with 'Evaluate'. HDBSCAN also returns chance groups from the field's "
                    "velocity distribution: in phase-space mode each group carries a false-alarm "
                    "probability from a velocity-shuffle null (in action mode the chemical test is the "
                    "discriminator).",
            "provenance": provenance({"op": "discover", "center_pc": list(center_pc), "radius_pc": radius_pc,
                                      "mode": mode, "min_cluster_size": min_cluster_size,
                                      "min_samples": min_samples, "min_poe": min_poe,
                                      "pos_scale_pc": pos_scale_pc, "vel_scale_kms": vel_scale_kms,
                                      "selection": selection})}


def evaluate_group(source_ids: list[int], lookback_myr: float = 50.0, n_mc: int = 48, n_null: int = 200,
                   run_traceback: bool = True) -> dict:
    s = STORE.stars
    source_ids = list(dict.fromkeys(int(x) for x in source_ids))  # de-duplicate, keep order
    g = s.iloc[STORE.index_of(source_ids)]
    out = {"n": int(len(g)), "source_ids": g["source_id_str"].tolist()}
    out["members"] = [{"source_id": a, "apogee_id": b, "dist_pc": float(c), "teff": float(d), "logg": float(e),
                       "feh": _f(f), "occam": h if isinstance(h, str) else None, "giant": bool(k),
                       "rv_variable": bool(v1), "single_visit": bool(v2)}
                      for a, b, c, d, e, f, h, k, v1, v2 in zip(g["source_id_str"], g["APOGEE_ID"], g["dist_pc"],
                                                                g["TEFF"], g["LOGG"], g["FE_H"], g["occam_cluster"],
                                                                g["is_giant"], g["flag_rv_variable"],
                                                                g["flag_single_visit"])]
    out["kinematics"] = {
        "centroid_pc": [float(v) for v in g[["X", "Y", "Z"]].median()],
        "size_pc": float(np.median(np.linalg.norm(g[["X", "Y", "Z"]] - g[["X", "Y", "Z"]].median(), axis=1))),
        "velocity_dispersion": families.velocity_dispersion(g),
        "median_distance_error_pc": float(np.median(g["dist_pc"] * g["parallax_error"] / g["parallax_corr"])),
    }
    out["chemistry"] = families.chemical_evidence(s, g, None, n_null=n_null)
    out["galah_check"] = families.galah_check(g)
    out["ages"] = families.age_evidence(s, g)
    out["known"] = {"occam": families.occam_labels(g), "hunt_reffert_2023": families.match_known_clusters(g, STORE.clusters)}
    if run_traceback and len(g) >= 3:
        tb = traceback.group_traceback(g, lookback_myr, n_mc)
        tb.pop("_bundle")
        out["traceback"] = tb
    out["hypotheses"] = compare_hypotheses(out)
    out["follow_up"] = group_follow_up(g, out)
    out["caveats"] = [
        "Discovery and chemical evaluation use different measurements, but APOGEE targeted many known "
        "clusters deliberately, so recovered groups are subject to that selection.",
        "Dwarfs and giants of the same cluster can differ by ~0.05-0.1 dex in ASPCAP abundances (atomic "
        "diffusion, pipeline systematics); mixed groups are penalised by the systematic floor only partly.",
        "The field model is a Gaussian mixture; the evidence ratio is therefore always shown against its "
        "empirical null distribution from random field groups.",
    ]
    out["provenance"] = provenance({"op": "evaluate_group", "source_ids": out["source_ids"],
                                    "lookback_myr": lookback_myr, "n_mc": n_mc, "n_null": n_null})
    return out


def compare_hypotheses(ev: dict) -> dict:
    """Evidence table for H_A (dissolved/dissolving birth cluster) vs H_B (unrelated field stars).

    No overall probability is computed: the only quantitative likelihood ratio is chemical; the other
    lines are consistency checks with stated expectations."""
    rows = []
    ch = ev["chemistry"]
    if ch.get("available"):
        lnbf, fpr = ch["ln_bayes_factor"], ch["empirical_false_positive_rate"]
        favours = "A" if (lnbf > ch["null_lnBF"]["p99"] and lnbf > 0) else ("B" if lnbf < ch["null_lnBF"]["p95"] else "neither")
        rows.append({"evidence": "Chemical homogeneity (evidence ratio)",
                     "value": f"ln BF = {lnbf:.1f}; random field groups exceed this in {100 * fpr:.1f}% of trials",
                     "A_predicts": "ln BF well above the field-group null (homogeneous to within errors + floor)",
                     "B_predicts": "ln BF within the null distribution",
                     "favours": favours, "quantitative": True})
        # scatter judged relative to the matched field's spread of the same element
        spread = ch.get("reference_spread", {})
        fitted = [e for e in ch["elements"] if e["n"] >= 3 and e["sigma_int"] is not None
                  and np.isfinite(e["sigma_int"]) and spread.get(e["element"]) not in (None, 0)
                  and np.isfinite(spread[e["element"]])]
        for e in fitted:
            e["_ratio"] = e["sigma_int"] / spread[e["element"]]
        worst = sorted(fitted, key=lambda e: -e["_ratio"])[:2]
        if worst:
            ul = lambda e: (f"{e['sigma_int_upper95']:.3f}" if e["sigma_int_upper95"] is not None
                            and np.isfinite(e["sigma_int_upper95"]) else "n/a")
            ratios = [e["_ratio"] for e in worst]
            rows.append({"evidence": "Largest intrinsic abundance scatter (relative to field)",
                         "value": "; ".join(f"{C.CHEM_LABELS[e['element']]}: {e['sigma_int']:.3f} dex "
                                            f"(95% UL {ul(e)}; field spread {spread[e['element']]:.3f})"
                                            for e in worst),
                         "A_predicts": "well below the field spread (< 0.5x) beyond errors + floor",
                         "B_predicts": "comparable to the field spread",
                         "favours": "A" if max(ratios) < 0.5 else ("B" if max(ratios) > 0.8 else "neither"),
                         "quantitative": False})
        for e in fitted:
            e.pop("_ratio", None)
    else:
        rows.append({"evidence": "Chemistry", "value": ch.get("reason", "unavailable"), "A_predicts": "-",
                     "B_predicts": "-", "favours": "untested", "quantitative": False})
    vd = ev["kinematics"]["velocity_dispersion"]["sigma_3d"]
    rows.append({"evidence": "3D velocity dispersion", "value": f"{vd:.1f} km/s (errors partly deconvolved)",
                 "A_predicts": "<~5 km/s (bound clusters ~1 km/s; associations 2-5 km/s)",
                 "B_predicts": "set by the selection window; field disc ~20-40 km/s",
                 "favours": "A" if vd < 5 else ("B" if vd > 10 else "neither"), "quantitative": False})
    tb = ev.get("traceback")
    if tb:
        fmin_now = tb["fraction_min_at_present"]
        # "compact at all epochs" only constrains anything if the look-back exceeds a few
        # crossing times (1 km/s = 1.0227 pc/Myr); otherwise any group stays "compact".
        crossing_myr = tb["size_now_pc"] / max(vd * 1.0227, 1e-3)
        long_enough = tb["lookback_myr"] >= 2 * crossing_myr
        past_minimum = tb["size_min_pc"]["median"] < 0.7 * tb["size_now_pc"]
        stays_compact = long_enough and max(tb["size_pc_median"]) < 2 * tb["size_now_pc"]
        if past_minimum or stays_compact:
            tb_fav = "A"
        elif not long_enough:
            tb_fav = "neither"
        else:
            tb_fav = "B" if fmin_now > 0.8 else "neither"
        rows.append({"evidence": f"Traceback over {tb['lookback_myr']:.0f} Myr",
                     "value": (f"size now {tb['size_now_pc']:.0f} pc; minimum {tb['size_min_pc']['median']:.0f} pc "
                               f"at {tb['t_min_myr']['median']:.1f} Myr "
                               f"(minimum at present in {100 * fmin_now:.0f}% of MC)"),
                     "A_predicts": "compact at all epochs (bound) or a past minimum (expanding remnant)",
                     "B_predicts": "monotonic dispersal into the past (minimum at present)",
                     "favours": tb_fav, "quantitative": False,
                     "note": None if long_enough else
                     f"look-back shorter than 2 crossing times (~{2 * crossing_myr:.0f} Myr): compactness is not tested"})
    ag = ev["ages"]
    if ag.get("available"):
        rows.append({"evidence": "Age spread (astroNN, giants)",
                     "value": f"median {ag['median_age_gyr']:.1f} Gyr; intrinsic log-age scatter "
                              f"{ag['log_age_sigma_int']:.2f} dex (field {ag['field_log_age_spread']:.2f})",
                     "A_predicts": "consistent with zero intrinsic scatter",
                     "B_predicts": "comparable to field spread",
                     "favours": "A" if ag["log_age_sigma_int"] < 0.5 * ag["field_log_age_spread"] else "neither",
                     "quantitative": False})
    gc = ev["galah_check"]
    if gc.get("available"):
        vals = [e["sigma_int"] for e in gc["elements"] if e["sigma_int"] is not None and np.isfinite(e["sigma_int"])]
        mx = max(vals) if vals else float("nan")
        rows.append({"evidence": "Independent survey (GALAH DR4)",
                     "value": f"{gc['n']} members; max intrinsic scatter {mx:.3f} dex",
                     "A_predicts": "small scatter in an independent pipeline",
                     "B_predicts": "field-like scatter", "favours": "A" if np.isfinite(mx) and mx < 0.05 else "neither",
                     "quantitative": False})
    nA = sum(r["favours"] == "A" for r in rows)
    nB = sum(r["favours"] == "B" for r in rows)
    quant = next((r for r in rows if r["quantitative"]), None)
    if quant and quant["favours"] == "A" and nB == 0:
        verdict = "Data favour a common origin (A); no line of evidence contradicts it."
    elif quant and quant["favours"] == "A":
        verdict = "Chemistry favours a common origin (A), but other evidence lines are in tension - see table."
    elif quant and quant["favours"] == "B":
        verdict = "Chemistry is consistent with unrelated field stars (B); a single birth cloud is disfavoured."
    else:
        verdict = "Inconclusive: the available data do not meaningfully distinguish A from B."
    return {"A": "Members formed together in one cluster/association (now bound or dissolving)",
            "B": "Members are unrelated field stars that happen to share present-day kinematics",
            "rows": rows, "n_favour_A": nA, "n_favour_B": nB, "verdict": verdict}


def group_follow_up(g: pd.DataFrame, ev: dict) -> list[str]:
    s = []
    if g["flag_single_visit"].mean() > 0.3:
        s.append(f"{int(g['flag_single_visit'].sum())} members have a single APOGEE RV epoch: further epochs "
                 "would identify binaries that inflate the velocity dispersion.")
    if ev["chemistry"].get("available"):
        bad = [m for m in ev["chemistry"]["member_contributions"] if m["delta_lnBF_if_removed"] < -2]
        if bad:
            s.append(f"{len(bad)} member(s) lower the common-origin evidence by >2 in ln BF when included; they "
                     "may be interlopers - check them individually.")
    mixed = g["is_giant"].any() and (~g["is_giant"]).any()
    if mixed:
        s.append("The group mixes dwarfs and giants: a strictly differential abundance analysis of "
                 "stars in the same evolutionary phase would remove pipeline systematics.")
    if ev["kinematics"]["median_distance_error_pc"] > ev["kinematics"]["size_pc"]:
        s.append("Distance errors exceed the group size: the traceback is limited by parallaxes; Gaia DR4 "
                 "astrometry will tighten it.")
    if not ev["galah_check"].get("available"):
        s.append("Few members have GALAH spectra; optical high-resolution spectra (incl. neutron-capture "
                 "elements such as Ba, Eu) would provide an independent chemical test.")
    return s


# ---------------------------------------------------------------------------
# Ejection / encounter
# ---------------------------------------------------------------------------
def encounter_test(source_id: int, cluster_name: str, lookback_myr: float = 50.0, n_mc: int = 200,
                   n_control: int = 30, radius_pc: float | None = None) -> dict:
    s = STORE.stars
    cls = STORE.clusters
    hit = cls[cls["Name"].str.lower() == cluster_name.lower()]
    if hit.empty:
        raise KeyError(f"cluster {cluster_name} not in Hunt & Reffert (2023)")
    cl = hit.iloc[0]
    rt = float(cl["rtpc"]) if np.isfinite(cl["rtpc"]) else 0.0
    radius = float(radius_pc) if radius_pc else max(2.0 * rt, 10.0)
    star = s.iloc[STORE.index_of([source_id])]
    cdf = traceback.sample_cluster(cl)
    res = traceback.encounter(star, cdf, lookback_myr, n_mc, C.DEFAULT_POTENTIAL, radius)
    main_r = res["results"][0]
    # control: random field stars at similar heliocentric distance from the cluster as the star now
    d_now = np.linalg.norm(star[["X", "Y", "Z"]].to_numpy()[0] - np.array([cl["Xh"], cl["Yh"], cl["Zh"]]))
    dc = np.linalg.norm(s[["X", "Y", "Z"]].to_numpy() - np.array([cl["Xh"], cl["Yh"], cl["Zh"]]), axis=1)
    pool = np.where((np.abs(dc - d_now) < max(0.2 * d_now, 20)) & (s["source_id"] != source_id).to_numpy())[0]
    rng = np.random.default_rng(5)
    ctrl = rng.choice(pool, size=min(n_control, pool.size), replace=False) if pool.size else np.array([], int)
    ctrl_frac = []
    if ctrl.size:
        cres = traceback.encounter(s.iloc[ctrl], cdf, lookback_myr, 24, C.DEFAULT_POTENTIAL, radius)
        ctrl_frac = [r["fraction_within_radius"] for r in cres["results"]]
    tb = res["bundle"]
    return {
        "source_id": str(source_id), "cluster": {"name": cl["Name"], "age_myr": _f(cl["age_myr"]),
                                                  "distance_pc": _f(cl["dist50"]), "rt_pc": _f(cl["rtpc"]),
                                                  "rv_kms": _f(cl["RV"]), "n_rv": _f(cl["n_RV"])},
        "radius_pc": radius, "lookback_myr": lookback_myr, "n_mc": n_mc,
        "result": {k: v for k, v in main_r.items() if k != "d_min_samples"},
        "d_min_samples": np.round(main_r["d_min_samples"], 2).tolist(),
        "control": {"n": int(len(ctrl_frac)), "mean_fraction_within_radius": _f(np.mean(ctrl_frac)) if ctrl_frac else None,
                    "fractions": ctrl_frac,
                    "description": "random sample stars currently at a similar distance from the cluster"},
        "trajectory": {"times_myr": tb.times_myr[::4].tolist(),
                       "star": np.round(tb.xyz_pc[0, 0, ::4], 2).tolist(),
                       "cluster": np.round(tb.xyz_pc[1, 0, ::4], 2).tolist()},
        "interpretation": _encounter_text(main_r, ctrl_frac, radius, cl),
        "caveats": ["Cluster centre motion from Hunt & Reffert (2023) mean astrometry and Gaia RVs of members; "
                    "the cluster's own mass and its tidal field are not modelled.",
                    "A close past approach is necessary for an ejection origin but does not prove it: the "
                    "control sample estimates how often unrelated stars pass equally close."],
        "provenance": provenance({"op": "encounter", "source_id": str(source_id), "cluster": cl["Name"],
                                  "lookback_myr": lookback_myr, "n_mc": n_mc, "radius_pc": radius}),
    }


def _encounter_text(r, ctrl, radius, cl):
    f = r["fraction_within_radius"]
    c = np.mean(ctrl) if ctrl else float("nan")
    s = (f"In {100 * f:.0f}% of Monte Carlo realisations the star passed within {radius:.0f} pc of the centre of "
         f"{cl['Name']} (closest approach {r['d_min_pc']['median']:.0f} pc [{r['d_min_pc']['p16']:.0f}-"
         f"{r['d_min_pc']['p84']:.0f}] at {r['t_min_myr']['median']:.1f} Myr, relative speed "
         f"{r['v_rel_kms']['median']:.0f} km/s).")
    if np.isfinite(c):
        s += f" Control stars achieve this in {100 * c:.0f}% of realisations on average."
    else:
        s += " No control stars were available at a comparable distance, so the chance rate is untested."
    if np.isfinite(cl["age_myr"]) and -r["t_min_myr"]["median"] > cl["age_myr"]:
        s += " The encounter epoch predates the cluster's estimated age, which argues against ejection."
    return s


# ---------------------------------------------------------------------------
# Population views
# ---------------------------------------------------------------------------
def merger_summary() -> dict:
    return merger.population_summary(STORE.stars)


def constellation_overview() -> list[dict]:
    return constellations.overview(STORE.constellations)


def constellation_detail(abbr: str) -> dict:
    return constellations.figure_analysis(STORE.constellations, abbr)


def constellation_traceback(abbr: str, lookback_myr: float = 5.0, n_mc: int = 32) -> dict:
    """Full orbit-integrated traceback of a constellation's stars that have RVs."""
    data = constellations.figure_analysis(STORE.constellations, abbr)
    df = pd.DataFrame(data["stars"])
    df = df[df["rv"].notna() & df["parallax"].notna()].reset_index(drop=True)
    df["rv_error"] = df["rv_error"].fillna(2.0).clip(lower=0.1)
    for k in ("parallax_pmra_corr", "parallax_pmdec_corr", "pmra_pmdec_corr"):
        df[k] = df[k].fillna(0.0)
    # Gaia DR3 parallaxes get the global Lindegren et al. (2021) offset; Hipparcos ones none.
    df["zpt_used"] = np.where(df["astrometry_source"].str.startswith("Gaia"), orbits.PARALLAX_ZERO_POINT_MAS, 0.0)
    tb = traceback.trajectories(df, lookback_myr, n_mc, C.DEFAULT_POTENTIAL, n_times=101)
    return {"abbr": abbr, "times_myr": tb.times_myr[::2].tolist(),
            "stars": [{"HIP": int(h), "nominal": np.round(tb.xyz_pc[k, 0, ::2], 2).tolist(),
                       "spread_pc_p84": np.round(np.percentile(np.linalg.norm(tb.xyz_pc[k] - tb.xyz_pc[k, :1], axis=-1),
                                                               84, axis=0)[::2], 2).tolist()}
                      for k, h in enumerate(df["HIP"])]}
