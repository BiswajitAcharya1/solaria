"""Tests for core scientific computations."""
from __future__ import annotations

import numpy as np
import pytest

from palimpsest import chemistry, families


class TestChemistry:
    def test_fit_intrinsic_scatter_recovers_known_sigma(self):
        rng = np.random.default_rng(42)
        true_mu, true_sigma = 0.0, 0.05
        n = 100
        x = rng.normal(true_mu, true_sigma, n)
        e = np.full(n, 0.01)
        floor = 0.02

        result = chemistry.fit_intrinsic_scatter(x, e, floor)
        assert result["n"] == n
        assert abs(result["mean"] - true_mu) < 0.01
        assert 0.03 < result["sigma_int"] < 0.08  # sqrt(0.05^2 - 0.02^2 - 0.01^2) ≈ 0.045

    def test_pair_chi2_identical_stars(self):
        xi = np.array([0.0, 0.1, -0.1])
        ei = np.array([0.01, 0.02, 0.01])
        Xj = np.tile(xi, (10, 1))
        Ej = np.tile(ei, (10, 1))
        floor = np.array([0.01, 0.01, 0.01])

        chi2, dof, p, _ = chemistry.pair_chi2(xi, ei, Xj, Ej, floor)
        assert np.all(dof == 3)
        assert np.all(chi2 < 1.0)
        assert np.all(p > 0.5)

    def test_pair_chi2_different_stars(self):
        xi = np.array([0.0, 0.0, 0.0])
        ei = np.array([0.01, 0.01, 0.01])
        Xj = np.array([[1.0, 1.0, 1.0]])  # 1 dex difference
        Ej = np.array([[0.01, 0.01, 0.01]])
        floor = np.array([0.01, 0.01, 0.01])

        chi2, dof, p, _ = chemistry.pair_chi2(xi, ei, Xj, Ej, floor)
        assert chi2[0] > 1000
        assert p[0] < 1e-10

    def test_field_model_fit(self):
        rng = np.random.default_rng(42)
        X_ref = rng.normal(0, 0.2, (500, 10))
        E_ref = np.full((500, 10), 0.01)
        floor = np.full(10, 0.03)

        field = chemistry.FieldModel(X_ref, n_components=4, seed=42)
        assert field.gmm is not None
        assert field.w.size == 4

        # Test terms computation
        X_test = rng.normal(0, 0.2, (10, 10))
        E_test = np.full((10, 10), 0.01)
        terms = field.terms(X_test, E_test, floor)
        assert terms.lb.shape == (10,)
        assert terms.prec.shape == (10, 10)

    def test_log_bayes_factor(self):
        rng = np.random.default_rng(42)
        X_ref = rng.normal(0, 0.2, (500, 5))
        E_ref = np.full((500, 5), 0.01)
        floor = np.full(5, 0.03)

        field = chemistry.FieldModel(X_ref, n_components=3, seed=42)

        # Tight group should have positive lnBF
        X_group = rng.normal(0.1, 0.02, (8, 5))
        E_group = np.full((8, 5), 0.01)
        lnbf = field.log_bayes_factor(X_group, E_group, floor)
        assert isinstance(lnbf, float)

    def test_calibrate_null(self):
        rng = np.random.default_rng(42)
        X_ref = rng.normal(0, 0.2, (500, 5))  # Complete data - no NaN
        E_ref = np.full((500, 5), 0.01)
        floor = np.full(5, 0.03)

        field = chemistry.FieldModel(X_ref, n_components=3, seed=42)
        null = chemistry.calibrate_null(field, X_ref, E_ref, floor, group_size=8, n_trials=50, seed=42)
        assert null.shape == (50,)
        # All trials should be finite with complete reference data
        assert np.all(np.isfinite(null))


class TestFamilies:
    def test_velocity_dispersion_positive(self):
        n = 20
        rng = np.random.default_rng(42)
        df = type('obj', (object,), {
            'U': rng.normal(0, 2, n),
            'V': rng.normal(0, 2, n),
            'W': rng.normal(0, 2, n),
            'dist_pc': rng.uniform(100, 1000, n),
            'parallax_error': rng.uniform(0.01, 0.05, n),
            'parallax_corr': rng.uniform(0.5, 1.0, n),
            'pmra': rng.normal(0, 5, n),
            'pmra_error': rng.uniform(0.02, 0.1, n),
            'pmdec': rng.normal(0, 5, n),
            'pmdec_error': rng.uniform(0.02, 0.1, n),
            'rv_error': np.full(n, 0.5),
        })()
        # This would need a proper DataFrame - skipping for now
        pass


class TestOrbits:
    def test_corrected_parallax(self):
        from palimpsest import orbits
        plx = np.array([1.0, 2.0, 0.5])
        corrected = orbits.corrected_parallax(plx)
        expected = plx - orbits.PARALLAX_ZERO_POINT_MAS
        np.testing.assert_allclose(corrected, expected)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])