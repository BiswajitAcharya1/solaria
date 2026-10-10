"""End-to-end tests of every API endpoint against the real cached dataset.

Besides schema / error-handling checks, several tests are *scientific positive
controls* with known answers:
  * an M67 member's trajectory at t = 0 must coincide with its catalogue position;
  * the chemistry of OCCAM M67 members must beat the random-field null;
  * an M67 member traced back must be found inside M67;
  * the Big Dipper must decompose into the Ursa Major moving group.
Requires data/cache/stars.parquet (python scripts/build_dataset.py).
"""
from __future__ import annotations

import json
import time

import numpy as np
import pytest

from palimpsest import config as C

pytestmark = pytest.mark.skipif(not C.STARS_PARQUET.exists(), reason="dataset not built")


@pytest.fixture(scope="module")
def client():
    from fastapi.testclient import TestClient
    from palimpsest.api import app
    with TestClient(app) as c:
        yield c


def get(client, url, status=200, budget_s=None, **kw):
    t0 = time.perf_counter()
    r = client.get(url, **kw)
    dt = time.perf_counter() - t0
    assert r.status_code == status, f"GET {url} -> {r.status_code}: {r.text[:400]}"
    if budget_s is not None:
        assert dt < budget_s, f"GET {url} took {dt:.1f}s (budget {budget_s}s)"
    return r


def post(client, url, body, status=200, budget_s=None):
    t0 = time.perf_counter()
    r = client.post(url, json=body)
    dt = time.perf_counter() - t0
    assert r.status_code == status, f"POST {url} -> {r.status_code}: {r.text[:400]}"
    if budget_s is not None:
        assert dt < budget_s, f"POST {url} took {dt:.1f}s (budget {budget_s}s)"
    return r


def strict_json(r):
    """Parse rejecting NaN/Infinity tokens (browsers' JSON.parse rejects them)."""
    def bad(tok):
        raise AssertionError(f"non-standard JSON token {tok} in {r.request.url}")
    return json.loads(r.text, parse_constant=bad)


@pytest.fixture(scope="module")
def presets(client):
    p = strict_json(get(client, "/api/presets", budget_s=10))
    assert p, "no OCCAM presets"
    return {x["name"]: x for x in p}


@pytest.fixture(scope="module")
def m67(presets):
    assert "NGC 2682" in presets, f"M67 (NGC 2682) not among presets: {list(presets)[:10]}"
    return presets["NGC 2682"]


# --------------------------------------------------------------------- basics
def test_status_and_meta(client):
    s = strict_json(get(client, "/api/status"))
    assert set(s) >= {"stars", "potential", "anomaly", "error"}
    m = strict_json(get(client, "/api/meta", budget_s=30))
    assert m["n_stars"] > 300_000
    assert 0 < m["n_with_full_chemistry"] <= m["n_with_ge6_elements"] <= m["n_stars"]
    assert set(m["floor"]) == set(C.CHEM_ELEMENTS)
    assert all(v is not None and 0 < v < 0.2 for v in m["floor"].values())
    assert set(m["floor_by_class"]) == {"giant", "dwarf"}
    for cls in ("giant", "dwarf"):
        assert set(m["floor_by_class"][cls]) == set(C.CHEM_ELEMENTS)
        assert all(v is not None and 0 < v < 0.3 for v in m["floor_by_class"][cls].values())
    assert m["provenance"]["data"]["astrometry"].startswith("Gaia DR3")


def test_points_binary_layout(client):
    r = get(client, "/api/points", budget_s=30)
    cols = r.headers["X-Columns"].split(",")
    n = int(r.headers["X-Rows"])
    arr = np.frombuffer(r.content, dtype=np.float32)
    assert arr.size == n * len(cols)
    arr = arr.reshape(n, len(cols))
    X, Y, Z = (arr[:, cols.index(c)] for c in "XYZ")
    assert np.isfinite(X).all() and np.isfinite(Y).all() and np.isfinite(Z).all()
    d = np.sqrt(X ** 2 + Y ** 2 + Z ** 2)
    assert np.median(d) == pytest.approx(1300, rel=0.5)  # pc
    feh = arr[:, cols.index("FE_H")]
    assert np.nanmin(feh) > -3 and np.nanmax(feh) < 1


def test_index_roundtrip(client, m67):
    sid = m67["source_ids"][0]
    idx = strict_json(get(client, f"/api/indices?ids={sid},notanumber,1"))
    assert len(idx) == 1
    assert strict_json(get(client, f"/api/index/{idx[0]}"))["source_id"] == sid
    get(client, "/api/index/999999999", status=404)


def test_star_detail_separates_measured_and_inferred(client, m67):
    sid = m67["source_ids"][0]
    d = strict_json(get(client, f"/api/star/{sid}", budget_s=60))
    assert d["source_id"] == sid
    assert {"measured", "derived", "abundances", "merger_test", "anomaly", "flags"} <= set(d)
    meas, der = d["measured"], d["derived"]
    assert meas["parallax_mas"] > 0 and meas["rv_apogee_kms"] is not None
    # distance consistent with zero-point corrected parallax
    assert der["distance_pc"] == pytest.approx(1000 / (meas["parallax_mas"] - meas["parallax_zero_point_mas"]), rel=1e-6)
    assert 700 < der["distance_pc"] < 1000  # M67 is at ~850 pc
    assert 0 <= der["eccentricity"] < 1 and der["zmax_kpc"] >= 0
    assert d["occam"]["cluster"] == "NGC 2682"
    q = {x["check"]: x for x in d["anomaly"]["quality"]}
    assert "Gaia RUWE" in q and q["Gaia RUWE"]["ok"]


def test_star_errors(client):
    get(client, "/api/star/123", status=404)
    get(client, "/api/star/abc", status=422)


def test_search(client, m67):
    r = strict_json(get(client, "/api/search?q=M67", budget_s=10))   # common-name alias
    assert r and all(x["cluster"] == "NGC 2682" for x in r)
    assert strict_json(get(client, "/api/search?q=pleiades"))[0]["cluster"] == "Melotte 22"
    sid = m67["source_ids"][0]
    r = strict_json(get(client, f"/api/search?q={sid[:12]}"))
    assert any(x["source_id"] == sid for x in r) or len(r) == 20


def test_unknown_api_path_is_json_404(client):
    r = get(client, "/api/does-not-exist", status=404)
    assert r.headers["content-type"].startswith("application/json")


# --------------------------------------------------------------------- orbits
def test_orbits_t0_matches_catalogue_and_two_potentials(client, m67):
    sid = m67["source_ids"][0]
    d = strict_json(get(client, f"/api/star/{sid}"))
    r = strict_json(post(client, "/api/orbits", {"source_ids": [sid], "lookback_myr": 20, "n_mc": 8,
                                                  "potentials": ["McMillan17", "MWPotential2014"]}, budget_s=120))
    assert set(r["runs"]) == {"McMillan17", "MWPotential2014"}
    for pot, run in r["runs"].items():
        t = run["times_myr"]
        assert t[0] == 0 and t[-1] == pytest.approx(-20)
        s = run["stars"][0]
        x0 = np.array(s["nominal"][0])
        cat = np.array([d["derived"]["X_pc"], d["derived"]["Y_pc"], d["derived"]["Z_pc"]])
        # t=0 position in the Sun-co-rotating frame = heliocentric Galactic position
        assert np.linalg.norm(x0 - cat) < 0.01 * np.linalg.norm(cat) + 1.0, (pot, x0, cat)
        assert len(s["samples"]) == 7  # n_mc - nominal
        # at t=0 the MC spread is the present-day distance uncertainty (line of sight dominated)
        m = d["measured"]
        sig_d = d["derived"]["distance_pc"] * m["parallax_error_mas"] / (m["parallax_mas"] - m["parallax_zero_point_mas"])
        assert 0.2 * sig_d < s["spread_pc_p50"][0] < 3 * sig_d, (s["spread_pc_p50"][0], sig_d)
        assert s["spread_pc_p84"][-1] > 0
    diff = r["potential_difference"]["stars"][0]["separation_pc"]
    assert diff[0] < 1.0 and diff[-1] > diff[0]  # models agree now, diverge with time
    assert r["provenance"]["hash"]


@pytest.mark.parametrize("body,status", [
    ({"source_ids": ["abc"]}, 400),
    ({"source_ids": ["123"]}, 404),
    ({"source_ids": []}, 422),
    ({"source_ids": ["123"], "lookback_myr": 0}, 422),
    ({"source_ids": ["123"], "lookback_myr": 5000}, 422),
    ({"source_ids": ["123"], "potentials": ["Kepler"]}, 400),
])
def test_orbits_errors(client, body, status):
    post(client, "/api/orbits", body, status=status)


def test_orbits_budget_enforced(client, m67):
    post(client, "/api/orbits", {"source_ids": m67["source_ids"][:50], "n_mc": 256}, status=400, budget_s=5)
    post(client, "/api/orbits", {"source_ids": m67["source_ids"][:2], "n_mc": 256, "lookback_myr": 500,
                                 "potentials": ["McMillan17", "MWPotential2014"]}, status=400, budget_s=5)


# --------------------------------------------------------------------- chemistry
def test_chem_neighbours_sorted(client, m67):
    sid = m67["source_ids"][0]
    r = strict_json(get(client, f"/api/chem_neighbours/{sid}?n=15", budget_s=30))
    nb = r["neighbours"]
    assert len(nb) == 15
    red = [n["chi2"] / n["dof"] for n in nb]
    assert red == sorted(red)
    assert all(n["dof"] >= 6 for n in nb)
    assert sid not in [n["source_id"] for n in nb]
    assert r["n_indistinguishable_p05"] <= r["n_compared"]
    get(client, f"/api/chem_neighbours/{sid}?n=0", status=422)


def test_siblings(client, m67):
    sid = m67["source_ids"][0]
    r = strict_json(post(client, "/api/siblings", {"source_id": sid, "lookback_myr": 30}, budget_s=180))
    c = r["counts"]
    assert c["both"] <= min(c["chemically_compatible"], c["dynamically_compatible"]) <= c["comparable_stars"]
    assert len(r["candidates"]) == min(c["both"], 200)
    for t in r["traceback"]:
        assert t["d_min_pc"]["p16"] <= t["d_min_pc"]["median"] <= t["d_min_pc"]["p84"]
    post(client, "/api/siblings", {"source_id": sid, "birth_sigma_kms": 0}, status=422)
    post(client, "/api/siblings", {"source_id": "x"}, status=400)


# --------------------------------------------------------------------- families
def test_discover_recovers_m67(client, m67):
    body = {"center_pc": m67["centroid_pc"], "radius_pc": 120, "mode": "phase_space", "min_cluster_size": 6,
            "min_samples": 4, "min_poe": 5, "pos_scale_pc": 30}
    r = strict_json(post(client, "/api/discover", body, budget_s=120))
    assert r["n_region"] > 0
    truth = set(m67["source_ids"])
    best = max((len(truth & set(g["source_ids"])) for g in r["groups"]), default=0)
    assert best >= 0.5 * len(truth), f"recovered only {best}/{len(truth)} M67 members"


def test_discover_errors(client):
    post(client, "/api/discover", {"mode": "astrology"}, status=400)
    post(client, "/api/discover", {"selection": "biggest"}, status=400)
    post(client, "/api/discover", {"center_pc": [0, 0]}, status=422)
    post(client, "/api/discover", {"radius_pc": 5000, "min_poe": 5}, status=400)  # too many stars


@pytest.fixture(scope="module")
def m67_eval(client, m67):
    return strict_json(post(client, "/api/evaluate", {"source_ids": m67["source_ids"], "lookback_myr": 20,
                                                      "n_mc": 8, "n_null": 100}, budget_s=300))


def test_evaluate_m67_positive_control(m67_eval, m67):
    ev = m67_eval
    assert ev["n"] == len(m67["source_ids"])
    ch = ev["chemistry"]
    assert ch["available"]
    assert ch["ln_bayes_factor"] > ch["null_lnBF"]["p95"], "M67 chemistry should beat the field null"
    assert ch["empirical_false_positive_rate"] < 0.05
    assert {e["element"] for e in ch["elements"]} == set(C.CHEM_ELEMENTS)
    assert len(ch["member_contributions"]) == ch["n_members_with_chemistry"]
    vd = ev["kinematics"]["velocity_dispersion"]["sigma_3d"]
    assert vd < 5, f"M67 3D velocity dispersion {vd} km/s"
    assert ev["known"]["occam"].get("NGC 2682", 0) >= 0.9 * ev["n"]
    names = [m["name"] for m in ev["known"]["hunt_reffert_2023"]]
    assert "NGC_2682" in names
    h = ev["hypotheses"]
    assert h["rows"] and h["verdict"]
    tb = ev["traceback"]
    assert len(tb["times_myr"]) == len(tb["size_pc_median"])


def test_evaluate_random_field_group_is_not_flagged(client):
    """Negative control: stars drawn at random from one region should not look like a birth cluster."""
    import pandas as pd
    s = pd.read_parquet(C.STARS_PARQUET, columns=["source_id", "X", "Y", "Z", "LOGG", "FE_H", "MG_FE"])
    m = (np.sqrt(s.X ** 2 + s.Y ** 2 + s.Z ** 2) < 400) & (s.LOGG > 4) & s.FE_H.notna() & s.MG_FE.notna()
    ids = s[m].sample(20, random_state=1)["source_id"].astype(str).tolist()
    ev = strict_json(post(client, "/api/evaluate", {"source_ids": ids, "lookback_myr": 10, "n_mc": 4,
                                                    "n_null": 100}, budget_s=300))
    ch = ev["chemistry"]
    assert ch["available"]
    assert ch["empirical_false_positive_rate"] > 0.01
    assert ev["kinematics"]["velocity_dispersion"]["sigma_3d"] > 10


def test_evaluate_errors(client, m67):
    post(client, "/api/evaluate", {"source_ids": m67["source_ids"][:2]}, status=400)
    post(client, "/api/evaluate", {"source_ids": ["1", "2", "x"]}, status=400)
    post(client, "/api/evaluate", {"source_ids": ["1", "2", "3"]}, status=404)


# --------------------------------------------------------------------- events
def test_encounter_member_returns_to_its_cluster(client, m67):
    sid = m67["source_ids"][0]
    r = strict_json(post(client, "/api/encounter", {"source_id": sid, "cluster": "NGC_2682", "lookback_myr": 5,
                                                     "n_mc": 50}, budget_s=180))
    res = r["result"]
    # a bound member is inside the cluster now and stays close: closest approach small, mostly at t~0
    assert res["d_min_pc"]["median"] < 3 * r["radius_pc"]
    assert 0 <= res["fraction_within_radius"] <= 1
    assert r["control"]["n"] >= 0
    assert r["interpretation"]


def test_encounter_errors(client, m67):
    sid = m67["source_ids"][0]
    post(client, "/api/encounter", {"source_id": sid, "cluster": "NoSuchCluster"}, status=404)
    post(client, "/api/encounter", {"source_id": sid, "cluster": "NGC_2682", "lookback_myr": -5}, status=422)


def test_clusters(client):
    r = strict_json(get(client, "/api/clusters?max_dist_pc=300", budget_s=10))
    assert r and all(c["dist_pc"] <= 300 and c["rv"] is not None for c in r)
    assert [c["dist_pc"] for c in r] == sorted(c["dist_pc"] for c in r)
    hy = strict_json(get(client, "/api/clusters?q=Melotte_25&max_dist_pc=100"))
    assert hy and hy[0]["name"] == "Melotte_25"


# --------------------------------------------------------------------- constellations / populations
def test_constellations_big_dipper(client):
    lst = strict_json(get(client, "/api/constellations", budget_s=20))
    assert len(lst) > 80
    d = strict_json(get(client, "/api/constellations/UMa", budget_s=20))
    names = {s["HIP"]: s["name"] for s in d["stars"]}
    groups = [{names[h] for h in g} for g in d["comoving_groups"]]
    assert {"Merak", "Phecda", "Megrez", "Alioth", "Mizar"} in groups
    assert not any({"Dubhe", "Alkaid"} & g for g in groups)
    assert d["summary"]["depth_ratio"] > 1
    assert {p["status"] for p in d["pairs"]} <= {"comoving", "not comoving", "undetermined"}
    epochs = [e["t_kyr"] for e in d["sky_epochs"]]
    assert 0 in epochs
    get(client, "/api/constellations/XYZ", status=404)


def test_constellation_traceback(client):
    r = strict_json(get(client, "/api/constellations/UMa/traceback?lookback_myr=2", budget_s=120))
    assert r["stars"] and r["times_myr"][0] == 0
    get(client, "/api/constellations/UMa/traceback?lookback_myr=0", status=422)


def test_merger_summary(client):
    m = strict_json(get(client, "/api/merger", budget_s=30))
    p = m["populations"]
    assert p["gse_kinematic"]["n"] > 50
    # independent chemistry should confirm the dynamical selection: accreted-like fraction much higher
    assert p["gse_kinematic"]["fraction"] > 2 * p["metal_poor_cold_disc_control"]["fraction"]
    lo, hi = p["gse_kinematic"]["interval_68"]
    assert lo <= p["gse_kinematic"]["fraction"] <= hi


def test_anomalies(client):
    r = strict_json(get(client, "/api/anomalies?n=20&min_z=5", budget_s=60))
    assert len(r) <= 20
    assert all(x["good_quality"] and x["score"] >= 5 for x in r)
    assert [x["score"] for x in r] == sorted((x["score"] for x in r), reverse=True)
    if r:
        d = strict_json(get(client, f"/api/star/{r[0]['source_id']}"))
        assert any(abs(k["z"]) >= 5 for k in d["anomaly"]["kinematics_vs_chemical_twins"])


def test_validation_payload(client):
    v = strict_json(get(client, "/api/validation"))
    if v:
        assert set(v["floor"]) == set(C.CHEM_ELEMENTS)
        # pair statistics are stratified by evolutionary class
        for cls in ("giant", "dwarf"):
            pc = v["pairs"][cls]
            assert pc["n_field_pairs"] > 0 and pc["n_member_pairs"] > 0
            for t in pc["thresholds"]:
                assert 0 <= t["field_doppelganger_rate"] <= 1 and 0 <= t["member_pair_recall"] <= 1


# --------------------------------------------------------------------- exports
def test_reports_roundtrip(client, m67_eval, m67):
    # results come back from the browser through JSON (NaN -> null): reports must cope
    ev = json.loads(json.dumps(m67_eval))
    md = post(client, "/api/report", {"kind": "group", "result": ev, "title": "M67 test"}).text
    import re
    assert md.startswith("# M67 test") and "## Reproducibility" in md
    assert not re.search(r"\bnan\b|\bNone\b", md), "unformatted missing values in report"
    assert m67["source_ids"][0] in md
    post(client, "/api/report", {"kind": "group", "result": {"foo": 1}}, status=400)
    post(client, "/api/report", {"kind": "poem", "result": {}}, status=400)


def test_members_csv(client, m67):
    ids = m67["source_ids"][:5]
    txt = get(client, f"/api/members.csv?ids={','.join(ids)}").text
    lines = [l for l in txt.splitlines() if l and not l.startswith("#")]
    assert lines[0].startswith("source_id,")
    assert len(lines) == 1 + len(ids)
