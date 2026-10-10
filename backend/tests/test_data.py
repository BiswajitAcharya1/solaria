"""Tests on the real cached analysis table and end-to-end analyses.

Skipped automatically if the dataset has not been built (scripts/build_dataset.py).
"""
import numpy as np
import pandas as pd
import pytest

from palimpsest import config as C

pytestmark = pytest.mark.skipif(not C.STARS_PARQUET.exists(), reason="analysis table not built")


@pytest.fixture(scope="module")
def stars():
    from palimpsest.store import STORE
    return STORE.stars


# ---------------------------------------------------------------- sample definition
def test_selection_cuts_are_honoured(stars):
    sel = C.SELECTION
    assert stars["source_id"].is_unique
    assert (stars["ruwe"] < sel["ruwe_max"]).all()
    assert (stars["parallax_corr"] / stars["parallax_error"] > sel["parallax_over_error_min"]).all()
    assert (stars["SNR"] > sel["apogee_snr_min"]).all()
    lo, hi = sel["teff_range_K"]
    assert stars["TEFF"].between(lo, hi).all()
    assert len(stars) > 300_000


def test_gaia_dr3_retrieval_matches_apogee_edr3_crossmatch(stars):
    """Gaia DR3 astrometry is identical to EDR3; the TAP retrieval must reproduce the values
    stored in the APOGEE catalogue for the same source_id (catches cross-match/ordering errors)."""
    d = np.abs(stars["parallax"] - stars["GAIAEDR3_PARALLAX"])
    assert np.nanmax(d) < 1e-4
    assert np.nanmax(np.abs(stars["pmra"] - stars["GAIAEDR3_PMRA"])) < 1e-4


def test_abundance_values_and_errors_are_paired(stars):
    for el in C.CHEM_ELEMENTS:
        v, e = stars[el], stars[el + "_ERR"]
        assert (v.isna() == e.isna()).all(), el
        assert (e.dropna() > 0).all(), el


# ---------------------------------------------------------------- frames and units
def test_heliocentric_cartesian_consistent_with_distance(stars):
    r = np.sqrt(stars["X"] ** 2 + stars["Y"] ** 2 + stars["Z"] ** 2)
    assert np.allclose(r, stars["dist_pc"], rtol=1e-6)
    assert np.allclose(stars["dist_pc"], 1000.0 / stars["parallax_corr"], rtol=1e-9)


def test_galactocentric_radius_consistent_with_heliocentric_position(stars):
    from palimpsest import orbits
    _, ro, _ = orbits.get_potential()
    near = stars[stars["dist_pc"] < 2000]
    R_est = np.hypot(ro - near["X"] / 1000.0, near["Y"] / 1000.0)
    assert np.max(np.abs(R_est - near["R"])) < 0.02  # kpc; residual from the Sun's 20.8 pc height


def test_solar_motion_sign_regression(stars):
    """Local thin-disc stars have mean Galactocentric v_R ~ 0 and mean heliocentric
    U ~ -U_sun, W ~ -W_sun.  A sign error in the solar motion shifts <v_R> by 2 U_sun ~ 22 km/s."""
    m = (stars["dist_pc"] < 300) & (stars["MG_FE"] < 0.08) & (stars["Z"].abs() < 150)
    loc = stars[m]
    assert len(loc) > 2000
    assert abs(loc["vR"].median()) < 3.0
    U, V, W = C.SOLAR_MOTION_UVW
    assert loc["U"].median() == pytest.approx(-U, abs=3.0)
    assert loc["W"].median() == pytest.approx(-W, abs=1.5)
    assert 215 < loc["vT"].median() < 245


# ---------------------------------------------------------------- orbital integrals
def test_orbital_parameters_physical(stars):
    ok = stars[["ecc", "zmax", "rperi", "rap", "J_R", "J_z", "E"]].notna().all(axis=1)
    assert ok.mean() > 0.995
    s = stars[ok]
    assert s["ecc"].between(0, 1).all()
    assert (s["E"] < 0).all()
    # Staeckel-fudge estimates: current radius must lie within [rperi, rap] up to the fudge accuracy
    inside = (s["R"] >= s["rperi"] - 0.1) & (s["R"] <= s["rap"] + 0.1)
    assert inside.mean() > 0.99
    assert ((s["zmax"] + 0.05) >= s["z"].abs()).mean() > 0.99
    # thin-disc stars are on near-circular orbits
    thin = s[(s["MG_FE"] < 0.08) & (s["dist_pc"] < 500)]
    assert thin["ecc"].median() < 0.15


def test_orbit_history_starts_at_present_position(stars):
    """Integrated trajectories (galpy) must start at the astropy-derived present-day position."""
    from palimpsest import analysis
    ids = stars.sample(3, random_state=4)["source_id"].tolist()
    r = analysis.orbit_history(ids, lookback_myr=10, n_mc=4)
    run = r["runs"][C.DEFAULT_POTENTIAL]
    for st in run["stars"]:
        row = stars[stars["source_id_str"] == st["source_id"]].iloc[0]
        p0 = np.array(st["nominal"][0])
        d = np.linalg.norm(p0 - row[["X", "Y", "Z"]].to_numpy(float))
        assert d < max(1.0, 0.003 * row["dist_pc"])  # pc; tilt of the plane by z_sun


# ---------------------------------------------------------------- end-to-end science
def _preset(stars, name):
    t = stars[(stars["occam_cluster"] == name) & (stars["occam_cg_prob"] >= 0.7) & (stars["occam_rv_prob"] >= 0.5)]
    return t["source_id"].tolist()


def test_known_open_cluster_is_chemically_homogeneous(stars):
    from palimpsest import analysis
    ids = _preset(stars, "NGC 2682")
    assert len(ids) >= 20
    ev = analysis.evaluate_group(ids, lookback_myr=20, n_mc=8, n_null=100)
    ch = ev["chemistry"]
    assert ch["available"]
    assert ch["ln_bayes_factor"] > ch["null_lnBF"]["p99"]
    assert ev["kinematics"]["velocity_dispersion"]["sigma_3d"] < 5.0
    assert ev["hypotheses"]["rows"][0]["favours"] == "A"
    assert "NGC 2682" in ev["known"]["occam"]  # M67


def test_random_field_group_is_not_chemically_homogeneous(stars):
    from palimpsest import analysis
    giants = stars[stars["is_giant"] & (stars["dist_pc"] < 1500) & stars["MG_FE"].notna()]
    ids = giants.sample(25, random_state=11)["source_id"].tolist()
    ev = analysis.evaluate_group(ids, lookback_myr=10, n_mc=4, n_null=100, run_traceback=False)
    assert ev["chemistry"]["available"]
    assert ev["hypotheses"]["rows"][0]["favours"] != "A"


def test_big_dipper_comoving_subset():
    """Five Big Dipper stars belong to the Ursa Major moving group (Collinder 285);
    Dubhe and Alkaid do not.  The test is data-driven: literature labels are not used."""
    from palimpsest import analysis
    d = analysis.constellation_detail("UMa")
    members = {53910, 58001, 59774, 62956, 65378}  # Merak, Phecda, Megrez, Alioth, Mizar
    groups = [set(g) for g in d["comoving_groups"]]
    best = max(groups, key=lambda g: len(g & members)) if groups else set()
    assert len(best & members) >= 4
    assert 54061 not in best and 67301 not in best  # Dubhe, Alkaid


def test_sibling_search_counts_are_consistent(stars):
    from palimpsest import analysis
    sid = _preset(stars, "NGC 2682")[0]
    r = analysis.sibling_search(sid, lookback_myr=20)
    c = r["counts"]
    assert c["both"] <= min(c["chemically_compatible"], c["dynamically_compatible"])
    assert c["dynamically_compatible"] < 0.2 * c["comparable_stars"]
    assert len(r["candidates"]) == min(c["both"], 200)


def test_encounter_test_runs_with_control(stars):
    from palimpsest import analysis
    from palimpsest.store import STORE
    cl = STORE.clusters
    near = cl[(cl["dist50"] < 400) & cl["RV"].notna() & (cl["n_RV"] >= 3)].iloc[0]
    d = np.linalg.norm(stars[["X", "Y", "Z"]].to_numpy() - near[["Xh", "Yh", "Zh"]].to_numpy(float), axis=1)
    sid = int(stars["source_id"].iloc[int(np.argmin(d))])
    r = analysis.encounter_test(sid, near["Name"], lookback_myr=20, n_mc=50, n_control=5)
    assert 0.0 <= r["result"]["fraction_within_radius"] <= 1.0
    assert r["control"]["n"] == 5
    assert np.isfinite(r["result"]["d_min_pc"]["median"])


def test_blind_discovery_recovers_nearby_clusters_as_significant():
    """Without using any labels, phase-space discovery within 200 pc must return the
    Pleiades, Praesepe and alpha Persei among its significant groups."""
    from palimpsest import analysis
    r = analysis.discover(center_pc=(0, 0, 0), radius_pc=200, mode="phase_space")
    sig = [g for g in r["groups"] if g["significance"] and g["significance"]["significant"]]
    found = {k for g in sig for k, v in g["occam_members"].items() if v >= 0.5 * g["n"]}
    assert {"Melotte 22", "NGC 2632", "Melotte 20"} <= found
    assert len(sig) <= 15  # chance groups are not flagged en masse
