"""Chemical fingerprinting.

Three levels of analysis, each with an interpretable statistic:

1. **Pairs** – chi-square of abundance differences over the elements measured in
   both stars, with measurement errors plus an empirical systematic floor.  The
   p-value answers "are these two stars chemically indistinguishable given the
   errors?" (it is *not* a probability of common birth).

2. **Groups** – per-element mean and intrinsic scatter (maximum likelihood,
   errors deconvolved) with a one-sided 95% upper limit.

3. **Hypothesis comparison** – Bayesian evidence ratio between
     H_A  "single birth cloud": every member shares one abundance vector mu,
          observed with its errors + floor; mu itself is drawn from the field
          abundance distribution (so H_A pays for its free parameter);
     H_B  "independent field stars": every member is an independent draw from
          the field abundance distribution of comparable stars.
   The field distribution is a Gaussian mixture fitted to a matched reference
   sample.  Both evidences are analytic (Gaussian x Gaussian-mixture), including
   missing elements, which are simply marginalised.
   Because the GMM is only an approximation, the evidence ratio is always
   reported together with an *empirical null distribution* from random field
   groups of the same size (``calibrate_null``).
"""
from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache

import numpy as np
from scipy import optimize, stats
from scipy.special import logsumexp
from sklearn.mixture import GaussianMixture

from . import config as C

ELEMENTS = C.CHEM_ELEMENTS


def matrices(df, elements=ELEMENTS):
    # explicit copies: pandas may hand back read-only views of Arrow-backed data
    X = np.array(df[list(elements)].to_numpy(float), dtype=float, copy=True)
    E = np.array(df[[e + "_ERR" for e in elements]].to_numpy(float), dtype=float, copy=True)
    X[~np.isfinite(E)] = np.nan
    E[~np.isfinite(X)] = np.nan
    return X, E


# ---------------------------------------------------------------------------
# Pairwise comparison
# ---------------------------------------------------------------------------
def pair_chi2(xi, ei, Xj, Ej, floor):
    """chi^2 between star i (K,) and stars j (M,K).  Returns chi2, dof, p, per-element terms."""
    xi = np.atleast_1d(xi)[None, :]
    ei = np.atleast_1d(ei)[None, :]
    Xj = np.atleast_2d(Xj)
    Ej = np.atleast_2d(Ej)
    var = ei ** 2 + Ej ** 2 + 2.0 * np.asarray(floor)[None, :] ** 2
    terms = (xi - Xj) ** 2 / var
    ok = np.isfinite(terms)
    terms = np.where(ok, terms, 0.0)
    chi2 = terms.sum(1)
    dof = ok.sum(1)
    with np.errstate(invalid="ignore"):
        p = np.where(dof > 0, stats.chi2.sf(chi2, np.maximum(dof, 1)), np.nan)
    terms[~ok] = np.nan
    return chi2, dof, p, terms


# ---------------------------------------------------------------------------
# Group statistics
# ---------------------------------------------------------------------------
@dataclass
class ElementFit:
    element: str
    n: int
    mean: float
    mean_err: float
    sigma_int: float
    sigma_int_upper95: float
    median_err: float


def _nll_sigma(s, x, v):
    w = 1.0 / (v + s * s)
    mu = np.sum(w * x) / np.sum(w)
    return 0.5 * np.sum(np.log(v + s * s) + (x - mu) ** 2 * w)


def fit_intrinsic_scatter(x, e, floor=0.0):
    """MLE mean + intrinsic scatter beyond (errors^2 + floor^2)."""
    ok = np.isfinite(x) & np.isfinite(e)
    x, e = x[ok], e[ok]
    n = x.size
    if n < 2:
        return dict(n=n, mean=float(x[0]) if n else np.nan, mean_err=float(e[0]) if n else np.nan,
                    sigma_int=np.nan, sigma_int_upper95=np.nan, median_err=float(np.median(e)) if n else np.nan)
    v = e ** 2 + floor ** 2
    hi = max(1.0, 3 * np.std(x))
    res = optimize.minimize_scalar(_nll_sigma, bounds=(0.0, hi), args=(x, v), method="bounded")
    s = float(res.x)
    nll0 = _nll_sigma(s, x, v)
    # one-sided 95% profile-likelihood upper limit (delta(2 nll) = 2.71)
    f = lambda t: _nll_sigma(t, x, v) - nll0 - 1.355
    try:
        up = optimize.brentq(f, s, hi * 2) if f(hi * 2) > 0 else np.nan
    except ValueError:
        up = np.nan
    w = 1.0 / (v + s * s)
    mu = float(np.sum(w * x) / np.sum(w))
    return dict(n=n, mean=mu, mean_err=float(np.sqrt(1.0 / np.sum(w))), sigma_int=s,
                sigma_int_upper95=float(up), median_err=float(np.median(e)))


def group_summary(X, E, floor, elements=ELEMENTS):
    return [ElementFit(element=el, **fit_intrinsic_scatter(X[:, k], E[:, k], floor[k])).__dict__
            for k, el in enumerate(elements)]


# ---------------------------------------------------------------------------
# Field model and evidence ratio
# ---------------------------------------------------------------------------
LOG2PI = np.log(2.0 * np.pi)


@dataclass
class StarTerms:
    """Per-star additive pieces of both evidences (so groups, leave-one-out and
    null trials are sums instead of recomputations)."""
    lb: np.ndarray       # (n,)   log p_field(x_i)                       [H_B]
    prec: np.ndarray     # (n,K)  1/var on observed elements, 0 if missing [H_A]
    b: np.ndarray        # (n,K)  x/var
    const: np.ndarray    # (n,K)  -0.5 log(2 pi var) - 0.5 x^2/var


class FieldModel:
    """Gaussian-mixture model of the abundance distribution of a reference population."""

    def __init__(self, X_ref: np.ndarray, n_components: int = 8, seed: int = 0):
        full = np.all(np.isfinite(X_ref), axis=1)
        Xf = X_ref[full]
        if Xf.shape[0] < 50:
            raise ValueError(f"reference sample too small for a field model ({Xf.shape[0]} complete stars)")
        k = int(min(n_components, max(1, Xf.shape[0] // 60)))
        self.gmm = GaussianMixture(n_components=k, covariance_type="full", reg_covar=1e-4,
                                   random_state=seed).fit(Xf)
        self.n_ref = int(Xf.shape[0])
        self.w = self.gmm.weights_
        self.m = self.gmm.means_
        self.S = self.gmm.covariances_
        self.Sinv = np.linalg.inv(self.S)
        self.logdetS = np.linalg.slogdet(self.S)[1]
        self.mSm = np.einsum("ci,cij,cj->c", self.m, self.Sinv, self.m)
        self.Sinv_m = np.einsum("cij,cj->ci", self.Sinv, self.m)

    # -- per-star terms -----------------------------------------------------
    def terms(self, X, E, floor) -> StarTerms:
        X = np.atleast_2d(X)
        E = np.atleast_2d(E)
        n, K = X.shape
        obs = np.isfinite(X) & np.isfinite(E)
        var = np.where(obs, E ** 2 + np.asarray(floor)[None, :] ** 2, 1.0)
        x0 = np.where(obs, X, 0.0)
        prec = np.where(obs, 1.0 / var, 0.0)
        b = x0 * prec
        const = np.where(obs, -0.5 * (LOG2PI + np.log(var)) - 0.5 * x0 ** 2 * prec, 0.0)
        lb = np.zeros(n)
        # batched Gaussian-mixture log density, grouped by missing-data pattern
        patterns, inv = np.unique(obs, axis=0, return_inverse=True)
        inv = np.asarray(inv).ravel()
        for p_idx, pat in enumerate(patterns):
            rows = np.where(inv == p_idx)[0]
            o = np.where(pat)[0]
            if o.size == 0:
                continue
            xo = X[np.ix_(rows, o)]
            vo = var[np.ix_(rows, o)]
            comp = np.empty((self.w.size, rows.size))
            for c in range(self.w.size):
                cov = self.S[c][np.ix_(o, o)][None, :, :] + vo[:, :, None] * np.eye(o.size)[None]
                L = np.linalg.cholesky(cov)
                y = np.linalg.solve(L, (xo - self.m[c, o])[:, :, None])[:, :, 0]
                comp[c] = (np.log(self.w[c]) - 0.5 * (o.size * LOG2PI + np.sum(y ** 2, axis=1))
                           - np.sum(np.log(np.diagonal(L, axis1=1, axis2=2)), axis=1))
            lb[rows] = logsumexp(comp, axis=0)
        return StarTerms(lb=lb, prec=prec, b=b, const=const)

    def _common_from_sums(self, prec_sum, b_sum, const_sum) -> float:
        """log integral p_field(mu) prod_i N(x_i | mu, var_i) dmu from summed terms."""
        vals = np.empty(self.w.size)
        for c in range(self.w.size):
            A = self.Sinv[c] + np.diag(prec_sum)
            L = np.linalg.cholesky(A)
            alpha = np.linalg.solve(L, self.Sinv_m[c] + b_sum)
            vals[c] = (np.log(self.w[c]) + const_sum - 0.5 * self.logdetS[c]
                       - np.sum(np.log(np.diag(L))) - 0.5 * self.mSm[c] + 0.5 * alpha @ alpha)
        return float(logsumexp(vals))

    def lnbf_from_terms(self, t: StarTerms, idx=None) -> float:
        sel = slice(None) if idx is None else idx
        return (self._common_from_sums(t.prec[sel].sum(0), t.b[sel].sum(0), t.const[sel].sum())
                - float(t.lb[sel].sum()))

    # -- public API (unchanged signatures) -----------------------------------
    def log_like_independent(self, X, E, floor):
        """sum_i log p_field(x_i) with per-star errors (H_B)."""
        t = self.terms(X, E, floor)
        return float(t.lb.sum()), t.lb

    def log_like_common(self, X, E, floor):
        """log of  integral p_field(mu) prod_i N(x_i | mu, diag(e_i^2+floor^2)) dmu  (H_A),
        evaluated analytically in information form (O(K^3) per component)."""
        t = self.terms(X, E, floor)
        return self._common_from_sums(t.prec.sum(0), t.b.sum(0), t.const.sum())

    def log_bayes_factor(self, X, E, floor):
        return self.lnbf_from_terms(self.terms(X, E, floor))


def element_contributions(field: FieldModel, X, E, floor, elements=ELEMENTS):
    """Leave-one-element-out change in ln(BF): positive => element supports H_A."""
    full = field.log_bayes_factor(X, E, floor)
    out = []
    for k, el in enumerate(elements):
        Xk = X.copy()
        Xk[:, k] = np.nan
        out.append({"element": el, "delta_lnBF": float(full - field.log_bayes_factor(Xk, E, floor)),
                    "n_measured": int(np.isfinite(X[:, k]).sum())})
    return full, out


def member_contributions(field: FieldModel, X, E, floor):
    """Leave-one-star-out change in ln(BF): negative => star weakens the common-origin case."""
    t = field.terms(X, E, floor)
    full = field.lnbf_from_terms(t)
    P, B, Cn, LB = t.prec.sum(0), t.b.sum(0), t.const.sum(), t.lb.sum()
    vals = np.empty(X.shape[0])
    for i in range(X.shape[0]):
        loo = field._common_from_sums(P - t.prec[i], B - t.b[i], Cn - t.const[i].sum()) - (LB - t.lb[i])
        vals[i] = full - loo
    return vals


def calibrate_null(field: FieldModel, Xref, Eref, floor, group_size: int, n_trials: int = 300,
                   seed: int = 0, terms: StarTerms | None = None):
    """ln(BF) for random groups drawn from the reference population (the null)."""
    rng = np.random.default_rng(seed)
    t = terms if terms is not None else field.terms(Xref, Eref, floor)
    n = t.lb.size
    return np.array([field.lnbf_from_terms(t, rng.choice(n, size=min(group_size, n), replace=False))
                     for _ in range(n_trials)])


# ---------------------------------------------------------------------------
# Systematic floors (calibrated per evolutionary class)
# ---------------------------------------------------------------------------
CLASSES = ("giant", "dwarf")


def star_class(logg) -> np.ndarray:
    return np.where(np.asarray(logg, float) < 3.5, "giant", "dwarf")


@lru_cache(maxsize=4)
def default_floor(klass: str | None = None) -> np.ndarray:
    """Systematic floor per element, calibrated on held-out open clusters
    (validate.py).  ASPCAP systematics differ strongly between giants and dwarfs,
    so a floor per evolutionary class is used when available."""
    import json

    if C.CALIBRATION_JSON.exists():
        cal = json.loads(C.CALIBRATION_JSON.read_text())
        if klass is not None and klass in cal.get("floor_by_class", {}):
            return np.array([cal["floor_by_class"][klass][el] for el in ELEMENTS])
        return np.array([cal["floor"][el] for el in ELEMENTS])
    return np.full(len(ELEMENTS), 0.03)
