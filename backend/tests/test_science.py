"""Unit tests of the scientific building blocks (no cached survey data needed)."""
import numpy as np
import pandas as pd
import pytest
from astropy import units as u
from astropy.coordinates import Galactocentric, SkyCoord

from palimpsest import chemistry, families, orbits, traceback
from palimpsest import config as C


# ---------------------------------------------------------------- coordinates
def test_sun_frame_matches_heliocentric_galactic_at_t0():
    """At t=0 the Sun-co-rotating frame must equal astropy's heliocentric Galactic Cartesian frame."""
    rng = np.random.default_rng(0)
    n = 20
    ra, dec = rng.uniform(0, 360, n), rng.uniform(-80, 80, n)
    d = rng.uniform(0.05, 2.0, n)
    o = orbits.make_orbit(ra, dec, d, rng.normal(0, 20, n), rng.normal(0, 20, n), rng.normal(0, 30, n))
    sun = orbits.sun_orbit()
    gx = np.stack([o.x(), o.y(), o.z()], axis=-1)[:, None, :]
    sx = np.array([[sun.x(), sun.y(), sun.z()]])
    rel = orbits.to_sun_frame(gx, sx)[:, 0, :]
    gal = SkyCoord(ra=ra * u.deg, dec=dec * u.deg, distance=d * u.kpc).galactic.cartesian
    ref = np.stack([gal.x.to_value(u.pc), gal.y.to_value(u.pc), gal.z.to_value(u.pc)], axis=-1)
    # tolerance: the Sun's 20.8 pc height tilts the Galactocentric plane by ~0.15 deg
    assert np.max(np.abs(rel - ref) / np.maximum(1.0, np.linalg.norm(ref, axis=1, keepdims=True))) < 5e-3


def test_galpy_and_astropy_agree_on_galactocentric_velocity():
    """galpy's Orbit (our solar parameters) vs astropy Galactocentric with the same Sun."""
    pot, ro, vo = orbits.get_potential()
    ra, dec, d, pmra, pmdec, rv = 120.0, 30.0, 0.8, 5.0, -12.0, 25.0
    o = orbits.make_orbit([ra], [dec], [d], [pmra], [pmdec], [rv])
    U, V, W = C.SOLAR_MOTION_UVW
    gc = Galactocentric(galcen_distance=np.hypot(ro, C.SOLAR_Z_KPC) * u.kpc, z_sun=C.SOLAR_Z_KPC * u.kpc,
                        galcen_v_sun=[U, vo + V, W] * u.km / u.s)
    c = SkyCoord(ra=ra * u.deg, dec=dec * u.deg, distance=d * u.kpc, pm_ra_cosdec=pmra * u.mas / u.yr,
                 pm_dec=pmdec * u.mas / u.yr, radial_velocity=rv * u.km / u.s).transform_to(gc)
    R = np.hypot(c.x, c.y).to_value(u.kpc)
    assert abs(float(o.R()[0]) - R) < 0.01
    vz = c.v_z.to_value(u.km / u.s)
    assert abs(float(o.vz()[0]) - vz) < 0.5
    speed = np.sqrt(c.v_x ** 2 + c.v_y ** 2 + c.v_z ** 2).to_value(u.km / u.s)
    gp = np.sqrt(o.vR()[0] ** 2 + o.vT()[0] ** 2 + o.vz()[0] ** 2)
    assert abs(gp - speed) < 0.5


def test_units_parallax_zero_point_contract():
    """Catalogue parallax minus zpt_used is what gets integrated; rows without zpt_used
    (Hipparcos parallaxes, cluster distances) are taken as already corrected."""
    df = _fake_group(3)
    df["zpt_used"] = [-0.017, -0.030, 0.0]
    rows = traceback._rows_for_orbits(df)
    assert np.allclose(rows["parallax"], df["parallax"] - df["zpt_used"])
    rows2 = traceback._rows_for_orbits(df.drop(columns=["zpt_used"]))
    assert np.allclose(rows2["parallax"], df["parallax"])
    assert orbits.PARALLAX_ZERO_POINT_MAS == pytest.approx(-0.017)


def test_solar_motion_sign_convention():
    """A test particle at the Sun with zero heliocentric velocity must move like the Sun:
    U = +11.1 km/s toward the GC  =>  galpy v_R = -11.1 km/s."""
    o = orbits.make_orbit([0.0], [0.0], [1e-6], [0.0], [0.0], [0.0])
    _, ro, vo = orbits.get_potential()
    U, V, W = C.SOLAR_MOTION_UVW
    assert float(o.vR()[0]) == pytest.approx(-U, abs=1e-3)
    assert float(o.vT()[0]) == pytest.approx(vo + V, abs=1e-3)
    assert float(o.vz()[0]) == pytest.approx(W, abs=1e-3)


def _nat_orbit(R, vR, vT, z, vz, phi, ro, vo):
    """galpy reads plain arrays as natural units: convert physical (kpc, km/s, rad)."""
    from galpy.orbit import Orbit
    vx = np.column_stack([np.atleast_1d(R) / ro, np.atleast_1d(vR) / vo, np.atleast_1d(vT) / vo,
                          np.atleast_1d(z) / ro, np.atleast_1d(vz) / vo, np.atleast_1d(phi)])
    return Orbit(vx, ro=ro, vo=vo, zo=C.SOLAR_Z_KPC, solarmotion=orbits.galpy_solarmotion())


# ---------------------------------------------------------------- dynamics
def test_orbit_integration_conserves_energy_and_lz():
    pot, ro, vo = orbits.get_potential("MWPotential2014")
    o = _nat_orbit(8.0, 30.0, 230.0, 0.1, 20.0, 0.0, ro, vo)
    assert float(o.R()[0]) == pytest.approx(8.0)          # guards the natural-units trap
    ts = np.linspace(0, -500, 2001) * u.Myr
    o.integrate(ts, pot, method="dop853_c")
    E = o.E(ts)[0]
    Lz = o.Lz(ts)[0]
    assert np.ptp(E) / abs(E[0]) < 1e-8
    assert np.ptp(Lz) / abs(Lz[0]) < 1e-8
    # the orbit stays bound and disc-like (sanity check that units were right)
    assert 5.0 < float(np.min(o.R(ts))) and float(np.max(o.R(ts))) < 11.0


def test_actions_conserved_along_orbit_staeckel():
    """Staeckel actions should be ~constant along an orbit (fudge accuracy ~ few %)."""
    pot, ro, vo = orbits.get_potential()
    o = _nat_orbit(8.2, 25.0, 225.0, 0.05, 15.0, 0.0, ro, vo)
    ts = np.linspace(0, -300, 61) * u.Myr
    o.integrate(ts, pot, method="dop853_c")
    snaps = _nat_orbit(o.R(ts)[0], o.vR(ts)[0], o.vT(ts)[0], o.z(ts)[0], o.vz(ts)[0], o.phi(ts)[0], ro, vo)
    p = orbits.orbital_parameters(snaps)
    assert 0.0 < np.mean(p["ecc"]) < 0.3 and np.mean(p["zmax"]) < 1.0
    assert np.std(p["Lz"]) / np.mean(np.abs(p["Lz"])) < 1e-6
    assert np.std(p["J_R"]) / np.mean(p["J_R"]) < 0.05
    assert np.std(p["J_z"]) / np.mean(p["J_z"]) < 0.08
    assert np.std(p["E"]) / np.mean(np.abs(p["E"])) < 1e-4  # spline potential consistency


def test_potential_spline_matches_direct_evaluation():
    from galpy.potential import evaluatePotentials
    pot, ro, vo = orbits.get_potential()
    R = np.array([4.0, 8.2, 12.0, 20.0])
    z = np.array([0.0, 0.5, -2.0, 6.0])
    direct = np.asarray(evaluatePotentials(pot, R / ro, z / ro, use_physical=False)) * vo ** 2
    assert np.allclose(orbits.potential_RZ(R, z), direct, rtol=1e-5)


def test_monte_carlo_sampling_reproduces_covariance():
    rng = np.random.default_rng(1)
    rows = {"parallax": np.array([2.0]), "parallax_error": np.array([0.05]), "pmra": np.array([10.0]),
            "pmra_error": np.array([0.04]), "pmdec": np.array([-5.0]), "pmdec_error": np.array([0.03]),
            "rv": np.array([12.0]), "rv_error": np.array([0.5]), "parallax_pmra_corr": np.array([0.6]),
            "parallax_pmdec_corr": np.array([-0.3]), "pmra_pmdec_corr": np.array([0.2])}
    s = orbits.sample_astrometry(rows, 20000, rng)
    assert s["parallax"][0, 0] == 2.0  # sample 0 is nominal
    c = np.corrcoef([s["parallax"][0], s["pmra"][0], s["pmdec"][0]])
    assert c[0, 1] == pytest.approx(0.6, abs=0.03)
    assert c[0, 2] == pytest.approx(-0.3, abs=0.03)
    assert np.std(s["rv"][0]) == pytest.approx(0.5, rel=0.05)


def _fake_group(n, ra=60.0, dec=20.0, plx=8.0, pm=(20.0, -40.0), rv=30.0, sig_kms=0.0, seed=0):
    rng = np.random.default_rng(seed)
    k = 4.74047 / plx  # km/s per mas/yr
    return pd.DataFrame({
        "ra": ra + rng.normal(0, 0.3, n), "dec": dec + rng.normal(0, 0.3, n),
        "parallax": np.full(n, plx), "parallax_error": np.full(n, 0.02),
        "pmra": pm[0] + rng.normal(0, sig_kms / k if sig_kms else 1e-9, n),
        "pmdec": pm[1] + rng.normal(0, sig_kms / k if sig_kms else 1e-9, n),
        "pmra_error": np.full(n, 0.02), "pmdec_error": np.full(n, 0.02),
        "rv": rv + rng.normal(0, sig_kms if sig_kms else 1e-9, n), "rv_error": np.full(n, 0.2),
        "parallax_pmra_corr": 0.0, "parallax_pmdec_corr": 0.0, "pmra_pmdec_corr": 0.0,
        "zpt_used": orbits.PARALLAX_ZERO_POINT_MAS})


def test_traceback_of_expanding_group_finds_origin_epoch():
    """Synthetic association born at one point 10 Myr ago with a 2 km/s velocity dispersion.

    A base orbit is integrated back 10 Myr to define the birth site, members are
    spawned there and integrated forward to today, 'observed' from the Sun's present
    configuration, then traced back with the production code: the size minimum must
    be recovered near -10 Myr."""
    pot, ro, vo = orbits.get_potential("MWPotential2014")
    rng = np.random.default_rng(3)
    n = 25
    nat = dict(use_physical=False)
    base = _nat_orbit(ro + 0.1, 0.0, vo, 0.02, 0.0, 0.05, ro, vo)
    back = np.linspace(0, -10, 101) * u.Myr
    base.integrate(back, pot, method="dop853_c")
    b = base(back[-1])
    dv = rng.normal(0, 2.0 / vo, (n, 3))
    from galpy.orbit import Orbit
    vx = np.column_stack([np.full(n, b.R(**nat)), b.vR(**nat) + dv[:, 0], b.vT(**nat) + dv[:, 1],
                          np.full(n, b.z(**nat)), b.vz(**nat) + dv[:, 2], np.full(n, b.phi(**nat))])
    stars = Orbit(vx, ro=ro, vo=vo, zo=C.SOLAR_Z_KPC, solarmotion=orbits.galpy_solarmotion())
    fwd = np.linspace(0, 10, 101) * u.Myr
    stars.integrate(fwd, pot, method="dop853_c")
    obs = stars(fwd[-1])  # present-day phase space, same frame as the Sun at t = 0
    df = pd.DataFrame({"ra": obs.ra(), "dec": obs.dec(), "parallax": 1.0 / obs.dist(), "parallax_error": 0.002,
                       "pmra": obs.pmra(), "pmdec": obs.pmdec(), "pmra_error": 0.002, "pmdec_error": 0.002,
                       "rv": obs.vlos(), "rv_error": 0.05, "parallax_pmra_corr": 0.0, "parallax_pmdec_corr": 0.0,
                       "pmra_pmdec_corr": 0.0, "zpt_used": 0.0})
    res = traceback.group_traceback(df, lookback_myr=20, n_mc=8, potential="MWPotential2014")
    assert res["t_min_myr"]["median"] == pytest.approx(-10.0, abs=1.0)
    assert res["size_min_pc"]["median"] < 0.2 * res["size_now_pc"]
    # a random (unrelated) set of stars must not show a convergence at -10 Myr
    rnd = _fake_group(25, sig_kms=25.0, seed=9)
    r2 = traceback.group_traceback(rnd, lookback_myr=20, n_mc=8, potential="MWPotential2014")
    assert r2["fraction_min_at_present"] > 0.5


def test_traceback_reproducible_with_seed():
    df = _fake_group(5, sig_kms=1.0)
    a = traceback.group_traceback(df, 10, 6, "MWPotential2014", seed=11)
    b = traceback.group_traceback(df, 10, 6, "MWPotential2014", seed=11)
    assert a["size_pc_median"] == b["size_pc_median"]


# ---------------------------------------------------------------- chemistry
def test_pair_chi2_handles_missing_and_counts_dof():
    floor = np.zeros(4)
    xi = np.array([0.0, 0.1, np.nan, 0.2])
    ei = np.array([0.1, 0.1, 0.1, 0.1])
    Xj = np.array([[0.0, 0.1, 0.5, np.nan], [0.3, 0.1, 0.0, 0.2]])
    Ej = np.full((2, 4), 0.1)
    chi2, dof, p, terms = chemistry.pair_chi2(xi, ei, Xj, Ej, floor)
    assert list(dof) == [2, 3]
    assert chi2[0] == pytest.approx(0.0)
    assert chi2[1] == pytest.approx(0.3 ** 2 / 0.02)
    assert np.isnan(terms[0, 2]) and np.isnan(terms[0, 3])


def test_intrinsic_scatter_recovers_truth():
    rng = np.random.default_rng(2)
    n = 400
    e = rng.uniform(0.02, 0.05, n)
    x = 0.1 + rng.normal(0, 0.04, n) + rng.normal(0, 1, n) * e
    r = chemistry.fit_intrinsic_scatter(x, e)
    assert r["sigma_int"] == pytest.approx(0.04, abs=0.008)
    assert r["mean"] == pytest.approx(0.1, abs=0.01)
    r0 = chemistry.fit_intrinsic_scatter(rng.normal(0, 1, n) * e, e)
    assert r0["sigma_int"] < 0.012 and r0["sigma_int_upper95"] < 0.02


def _field(n=6000, K=5, seed=0):
    rng = np.random.default_rng(seed)
    # two-population field with correlated abundances
    a = rng.normal([-0.1, 0.05, 0.0, 0.02, 0.0][:K], [0.2, 0.05, 0.05, 0.06, 0.05][:K], (n // 2, K))
    b = rng.normal([-0.5, 0.25, 0.15, 0.1, -0.1][:K], [0.2, 0.04, 0.05, 0.06, 0.05][:K], (n - n // 2, K))
    X = np.vstack([a, b])
    E = np.full_like(X, 0.02)
    return X + rng.normal(0, 0.02, X.shape), E


def test_evidence_ratio_separates_cluster_from_field():
    X, E = _field()
    floor = np.full(X.shape[1], 0.01)
    fm = chemistry.FieldModel(X, n_components=4)
    rng = np.random.default_rng(5)
    mu = X[17]
    G = mu + rng.normal(0, 0.022, (12, X.shape[1]))
    Eg = np.full_like(G, 0.02)
    lnbf_cluster = fm.log_bayes_factor(G, Eg, floor)
    null = chemistry.calibrate_null(fm, X, E, floor, 12, n_trials=100)
    assert lnbf_cluster > np.percentile(null, 99)
    assert np.median(null) < 0
    # half-contaminated group must score lower than the pure one
    Gc = np.vstack([G[:6], X[rng.choice(len(X), 6, replace=False)]])
    assert fm.log_bayes_factor(Gc, Eg, floor) < lnbf_cluster


def test_evidence_ratio_with_missing_elements():
    X, E = _field()
    floor = np.full(X.shape[1], 0.01)
    fm = chemistry.FieldModel(X, n_components=4)
    G = X[100] + np.random.default_rng(1).normal(0, 0.02, (8, X.shape[1]))
    Eg = np.full_like(G, 0.02)
    G[0, 1] = np.nan
    G[3, [0, 2]] = np.nan
    v = fm.log_bayes_factor(G, Eg, floor)
    assert np.isfinite(v)


def test_common_likelihood_matches_bruteforce_for_single_component():
    """Analytic marginal likelihood vs numerical integration in 1D."""
    from scipy import integrate, stats
    rng = np.random.default_rng(4)
    Xref = rng.normal(0.1, 0.2, (500, 1))
    fm = chemistry.FieldModel(Xref, n_components=1)
    x = np.array([[0.05], [0.08], [0.02]])
    e = np.full_like(x, 0.03)
    floor = np.array([0.01])
    analytic = fm.log_like_common(x, e, floor)
    m, S = fm.m[0, 0], fm.S[0, 0, 0]
    sig = np.sqrt(e[:, 0] ** 2 + floor[0] ** 2)
    f = lambda mu: stats.norm.pdf(mu, m, np.sqrt(S)) * np.prod(stats.norm.pdf(x[:, 0], mu, sig))
    num, _ = integrate.quad(f, -2, 2, points=[0.05], limit=200)
    assert analytic == pytest.approx(np.log(num), abs=1e-6)


# ---------------------------------------------------------------- clustering
def test_hdbscan_recovers_synthetic_cluster_and_not_noise():
    rng = np.random.default_rng(7)
    field = pd.DataFrame({"X": rng.uniform(-300, 300, 3000), "Y": rng.uniform(-300, 300, 3000),
                          "Z": rng.uniform(-150, 150, 3000), "U": rng.normal(-10, 30, 3000),
                          "V": rng.normal(-20, 20, 3000), "W": rng.normal(-7, 15, 3000)})
    cl = pd.DataFrame({"X": rng.normal(100, 4, 40), "Y": rng.normal(-50, 4, 40), "Z": rng.normal(10, 4, 40),
                       "U": rng.normal(5, 0.8, 40), "V": rng.normal(-30, 0.8, 40), "W": rng.normal(2, 0.8, 40)})
    df = pd.concat([field, cl], ignore_index=True)
    lab = families.discover(df, "phase_space", min_cluster_size=10, min_samples=5)
    cl_lab = lab[len(field):]
    main = np.bincount(cl_lab[cl_lab >= 0]).argmax()
    recall = np.mean(cl_lab == main)
    precision = np.mean(np.arange(len(df))[lab == main] >= len(field))
    assert recall > 0.8 and precision > 0.8
    # HDBSCAN also carves chance groups out of the field's velocity distribution; the
    # velocity-shuffle null must flag the real cluster as significant and the chance groups not.
    sig = families.phase_space_significance(families.features(df, "phase_space"), lab, k=5)
    # decision rule: significant iff FAP <= 0.05.  (A large chance group, e.g. the whole
    # velocity core merged by 'eom', can be as dense as the null bound, so FAP ~ 0.2-0.5.)
    assert sig[int(main)]["false_alarm_probability"] <= 0.05 and sig[int(main)]["significant"]
    others = [v for L, v in sig.items() if L != int(main)]
    assert all(v["false_alarm_probability"] > 0.05 and not v["significant"] for v in others)
    for sel in ("eom", "leaf"):
        lab_noise = families.discover(field, "phase_space", min_cluster_size=10, min_samples=5, selection=sel)
        sig_noise = families.phase_space_significance(families.features(field, "phase_space"), lab_noise, k=5)
        assert not any(v["significant"] for v in sig_noise.values()), sel


def test_vectorised_field_likelihood_matches_direct_evaluation():
    """Batched per-pattern Gaussian-mixture densities must equal a per-star scipy loop."""
    from scipy import stats
    from scipy.special import logsumexp
    X, E = _field(n=3000, K=5, seed=3)
    fm = chemistry.FieldModel(X, n_components=4)
    rng = np.random.default_rng(8)
    G = X[:40].copy()
    Eg = rng.uniform(0.01, 0.05, G.shape)
    G[rng.random(G.shape) < 0.2] = np.nan  # random missing elements
    floor = np.full(5, 0.02)
    _, per = fm.log_like_independent(G, Eg, floor)
    for i in range(len(G)):
        o = np.isfinite(G[i])
        if not o.any():
            assert per[i] == 0.0
            continue
        D = np.diag(Eg[i, o] ** 2 + floor[o] ** 2)
        ref = logsumexp([np.log(w) + stats.multivariate_normal.logpdf(G[i, o], m[o], S[np.ix_(o, o)] + D)
                         for w, m, S in zip(fm.w, fm.m, fm.S)])
        assert per[i] == pytest.approx(ref, abs=1e-8)
    # leave-one-out via additive terms equals recomputation
    full = fm.log_bayes_factor(G, Eg, floor)
    loo = chemistry.member_contributions(fm, G, Eg, floor)
    keep = np.arange(len(G)) != 7
    assert loo[7] == pytest.approx(full - fm.log_bayes_factor(G[keep], Eg[keep], floor), abs=1e-8)
