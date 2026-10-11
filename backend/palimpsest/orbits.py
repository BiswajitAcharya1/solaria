"""Orbit reconstruction with Monte Carlo uncertainty propagation.

All dynamics use galpy (Bovy 2015).  Each Galactic potential carries its own
unit normalisation (``ro`` = solar Galactocentric radius, ``vo`` = circular
speed at ``ro``); orbits are always created with the potential's own ``ro`` and
``vo`` so the solar position is self-consistent with the mass model.

Coordinates returned to the rest of the application use a *Sun-centred,
Sun-co-rotating* frame for historical positions:

    X  toward the Galactic centre as seen from the Sun at that time
    Y  in the direction of Galactic rotation
    Z  toward the North Galactic Pole

At t = 0 this equals the usual heliocentric Galactic Cartesian frame, so
present-day positions and historical positions are directly comparable.
"""
from __future__ import annotations

import threading
import warnings
from dataclasses import dataclass

import numpy as np
from astropy import units as u

from . import config as C

warnings.filterwarnings("ignore", category=RuntimeWarning, module="galpy")

# Lindegren et al. (2021): median Gaia (E)DR3 parallax zero-point from quasars.
PARALLAX_ZERO_POINT_MAS = -0.017


def corrected_parallax(plx: np.ndarray) -> np.ndarray:
    """Apply Gaia DR3 parallax zero-point correction."""
    return np.asarray(plx, float) - PARALLAX_ZERO_POINT_MAS


_POT_CACHE: dict[str, object] = {}
_POT_LOCK = threading.Lock()


def get_potential(name: str = C.DEFAULT_POTENTIAL):
    """Return (potential, ro_kpc, vo_kms).  Construction of McMillan17 is slow
    (~1 min, it solves for the disc SCF expansion), so results are cached."""
    if name not in C.POTENTIALS:
        raise ValueError(f"unknown potential {name!r}; options: {list(C.POTENTIALS)}")
    with _POT_LOCK:
        if name not in _POT_CACHE:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                if name == "McMillan17":
                    from galpy.potential.mwpotentials import McMillan17 as pot
                else:
                    from galpy.potential.mwpotentials import MWPotential2014 as pot
                from galpy.util.conversion import get_physical
                phys = get_physical(pot)
            _POT_CACHE[name] = (pot, float(phys["ro"]), float(phys["vo"]))
        return _POT_CACHE[name]


def galpy_solarmotion() -> list[float]:
    """galpy's ``solarmotion`` argument is [-U, V, W] (its Galactocentric frame is
    left-handed); config stores the conventional (U, V, W) with U toward the GC."""
    U, V, W = C.SOLAR_MOTION_UVW
    return [-U, V, W]


def make_orbit(ra, dec, dist_kpc, pmra, pmdec, vlos, potential: str = C.DEFAULT_POTENTIAL):
    """Create a galpy Orbit array from heliocentric observables."""
    from galpy.orbit import Orbit

    _, ro, vo = get_potential(potential)
    vxvv = np.column_stack([ra, dec, dist_kpc, pmra, pmdec, vlos]).astype(float)
    return Orbit(vxvv, radec=True, ro=ro, vo=vo, zo=C.SOLAR_Z_KPC,
                 solarmotion=galpy_solarmotion())


def sun_orbit(potential: str = C.DEFAULT_POTENTIAL):
    from galpy.orbit import Orbit

    _, ro, vo = get_potential(potential)
    return Orbit(ro=ro, vo=vo, zo=C.SOLAR_Z_KPC, solarmotion=galpy_solarmotion())


def sample_astrometry(rows: dict, n_samples: int, rng: np.random.Generator) -> dict:
    """Draw Monte Carlo realisations of (parallax, pmra, pmdec, rv) for each star.

    ``rows["parallax"]`` must already be zero-point corrected (a true parallax).
    ``rows`` is a mapping of 1-D arrays (one entry per star) with keys
    parallax, parallax_error, pmra, pmra_error, pmdec, pmdec_error, rv, rv_error
    and optionally the Gaia correlation coefficients parallax_pmra_corr,
    parallax_pmdec_corr, pmra_pmdec_corr.  Sample 0 is always the nominal value.
    Returns arrays of shape (n_star, n_samples).
    """
    plx = np.asarray(rows["parallax"], float)
    n = plx.size
    sig = np.column_stack([rows["parallax_error"], rows["pmra_error"], rows["pmdec_error"]]).astype(float)
    corr = {k: np.nan_to_num(np.asarray(rows.get(k, np.zeros(n)), float)) for k in
            ("parallax_pmra_corr", "parallax_pmdec_corr", "pmra_pmdec_corr")}
    out = {k: np.empty((n, n_samples)) for k in ("parallax", "pmra", "pmdec", "rv")}
    mean = np.column_stack([plx, rows["pmra"], rows["pmdec"]]).astype(float)
    for i in range(n):
        s = sig[i]
        cov = np.diag(s ** 2)
        cov[0, 1] = cov[1, 0] = corr["parallax_pmra_corr"][i] * s[0] * s[1]
        cov[0, 2] = cov[2, 0] = corr["parallax_pmdec_corr"][i] * s[0] * s[2]
        cov[1, 2] = cov[2, 1] = corr["pmra_pmdec_corr"][i] * s[1] * s[2]
        draw = rng.multivariate_normal(mean[i], cov, size=n_samples, method="cholesky")
        draw[0] = mean[i]
        out["parallax"][i], out["pmra"][i], out["pmdec"][i] = draw.T
    rv = np.asarray(rows["rv"], float)[:, None]
    erv = np.asarray(rows["rv_error"], float)[:, None]
    out["rv"] = rv + erv * rng.standard_normal((n, n_samples))
    out["rv"][:, 0] = rv[:, 0]
    # A parallax draw <= 0 has no distance; clip at 1/5 of nominal (only
    # possible for >5 sigma excursions given the sample cut).
    out["parallax"] = np.maximum(out["parallax"], 0.2 * plx[:, None])
    return out


@dataclass
class TrajectoryBundle:
    times_myr: np.ndarray        # (nt,)  0 ... -T
    xyz_pc: np.ndarray           # (n_star, n_samples, nt, 3)  Sun-co-rotating frame
    galcen_xyz_kpc: np.ndarray   # (n_star, n_samples, nt, 3)  Galactocentric (galpy, Sun at +x)
    sun_galcen_kpc: np.ndarray   # (nt, 3)
    potential: str
    ro: float
    vo: float


def integrate_samples(ra, dec, samples: dict, lookback_myr: float, n_times: int = 201,
                      potential: str = C.DEFAULT_POTENTIAL) -> TrajectoryBundle:
    """Integrate every Monte Carlo realisation of every star backwards in time.

    ``samples["parallax"]`` are true (zero-point corrected) parallaxes in mas."""
    pot, ro, vo = get_potential(potential)
    n_star, n_s = samples["parallax"].shape
    ts = np.linspace(0.0, -abs(lookback_myr), n_times)
    d_kpc = 1.0 / samples["parallax"]
    rep = lambda a: np.repeat(np.asarray(a, float), n_s)
    o = make_orbit(rep(ra), rep(dec), d_kpc.ravel(), samples["pmra"].ravel(), samples["pmdec"].ravel(),
                   samples["rv"].ravel(), potential)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        o.integrate(ts * u.Myr, pot, method="dop853_c")
        sun = sun_orbit(potential)
        sun.integrate(ts * u.Myr, pot, method="dop853_c")
    gx = np.stack([o.x(ts * u.Myr), o.y(ts * u.Myr), o.z(ts * u.Myr)], axis=-1)  # (N, nt, 3) kpc
    sx = np.stack([sun.x(ts * u.Myr), sun.y(ts * u.Myr), sun.z(ts * u.Myr)], axis=-1).reshape(-1, 3)
    rel = to_sun_frame(gx, sx)
    nt = ts.size
    return TrajectoryBundle(
        times_myr=ts,
        xyz_pc=rel.reshape(n_star, n_s, nt, 3),
        galcen_xyz_kpc=gx.reshape(n_star, n_s, nt, 3),
        sun_galcen_kpc=sx,
        potential=potential, ro=ro, vo=vo,
    )


def to_sun_frame(galcen_xyz_kpc: np.ndarray, sun_xyz_kpc: np.ndarray) -> np.ndarray:
    """Project Galactocentric positions (…, nt, 3) into the Sun-co-rotating frame (pc).

    galpy's frame has the Sun at +x at t=0 and rotation toward +phi.
    """
    phi_sun = np.arctan2(sun_xyz_kpc[:, 1], sun_xyz_kpc[:, 0])  # (nt,)
    e_r = np.stack([np.cos(phi_sun), np.sin(phi_sun)], axis=-1)    # GC -> Sun
    e_phi = np.stack([-np.sin(phi_sun), np.cos(phi_sun)], axis=-1)  # rotation direction
    d = galcen_xyz_kpc - sun_xyz_kpc  # broadcast over leading axes
    X = -(d[..., 0] * e_r[:, 0] + d[..., 1] * e_r[:, 1])
    Y = d[..., 0] * e_phi[:, 0] + d[..., 1] * e_phi[:, 1]
    Z = d[..., 2]
    return np.stack([X, Y, Z], axis=-1) * 1000.0


_PHI_GRID: dict[str, object] = {}


def potential_RZ(R_kpc, z_kpc, potential: str = C.DEFAULT_POTENTIAL) -> np.ndarray:
    """Potential (km/s)^2 via a cached bicubic spline on an (R, |z|) grid.

    Direct evaluation of McMillan17 costs ~10 ms per point in Python; the
    spline (log-spaced in R, 0.05-40 kpc; |z| 0-15 kpc) reproduces it to
    <1e-4 relative accuracy.  Points outside the grid are evaluated directly."""
    from galpy.potential import evaluatePotentials
    from scipy.interpolate import RectBivariateSpline

    pot, ro, vo = get_potential(potential)
    if potential not in _PHI_GRID:
        f = C.CACHE / f"phi_grid_{potential}.npz"
        Rg = np.geomspace(0.05, 40.0, 160)
        zg = np.concatenate([[0.0], np.geomspace(0.005, 15.0, 90)])
        if f.exists():
            phi = np.load(f)["phi"]
        else:
            RR, ZZ = np.meshgrid(Rg, zg, indexing="ij")
            phi = np.asarray(evaluatePotentials(pot, RR.ravel() / ro, ZZ.ravel() / ro, use_physical=False)).reshape(RR.shape) * vo ** 2
            C.CACHE.mkdir(parents=True, exist_ok=True)
            np.savez(f, phi=phi, R=Rg, z=zg)
        _PHI_GRID[potential] = (RectBivariateSpline(np.log(Rg), zg, phi, kx=3, ky=3), Rg, zg)
    spl, Rg, zg = _PHI_GRID[potential]
    R = np.atleast_1d(np.asarray(R_kpc, float))
    z = np.abs(np.atleast_1d(np.asarray(z_kpc, float)))
    out = np.empty_like(R)
    inside = (R >= Rg[0]) & (R <= Rg[-1]) & (z <= zg[-1])
    out[inside] = spl.ev(np.log(R[inside]), z[inside])
    if (~inside).any():
        out[~inside] = np.asarray(evaluatePotentials(pot, R[~inside] / ro, z[~inside] / ro, use_physical=False)) * vo ** 2
    return out


STAECKEL_DELTA_KPC = 0.4  # focal length; appropriate near the solar circle (Mackereth & Bovy 2018)


def orbital_parameters(o, potential: str = C.DEFAULT_POTENTIAL) -> dict:
    """Staeckel-fudge actions and orbit shape (Binney 2012) with a fixed focal
    length, using galpy's C implementation (Mackereth & Bovy 2018)."""
    from galpy.actionAngle import actionAngleStaeckel

    pot, ro, vo = get_potential(potential)
    nat = dict(use_physical=False)
    R, vR, vT, z, vz, phi = (np.atleast_1d(o.R(**nat)), np.atleast_1d(o.vR(**nat)), np.atleast_1d(o.vT(**nat)),
                             np.atleast_1d(o.z(**nat)), np.atleast_1d(o.vz(**nat)), np.atleast_1d(o.phi(**nat)))
    aAS = actionAngleStaeckel(pot=pot, delta=STAECKEL_DELTA_KPC / ro, c=True)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        jr, lz, jz = aAS(R, vR, vT, z, vz, phi)
        e, zmax, rperi, rap = aAS.EccZmaxRperiRap(R, vR, vT, z, vz, phi)
        E = potential_RZ(R * ro, z * ro, potential) / vo ** 2 + 0.5 * (vR ** 2 + vT ** 2 + vz ** 2)
    out = {"E": E * vo ** 2, "Lz": lz * ro * vo, "J_R": jr * ro * vo, "J_z": jz * ro * vo,
           "ecc": e, "zmax": zmax * ro, "rperi": rperi * ro, "rap": rap * ro}
    return {k: np.asarray(v, dtype=float) for k, v in out.items()}
