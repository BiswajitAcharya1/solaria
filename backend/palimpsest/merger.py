"""Accreted-origin test: is a star (or population) consistent with Gaia-Sausage/
Enceladus (GSE) merger debris?

Two *independent* criteria from the literature are evaluated separately:

Dynamics  Feuillet et al. (2021, MNRAS 508, 1489) GSE selection in action space:
          -500 <= L_z <= 500 kpc km/s and 30 <= sqrt(J_R) <= 55 (kpc km/s)^1/2.
Chemistry Das, Hawkins & Jofre (2020, MNRAS 493, 5195) and Horta et al. (2021,
          MNRAS 500, 1385): stars formed in lower-mass systems populate the
          high-[Mg/Mn], low-[Al/Fe] region; we use [Al/Fe] < -0.075 and
          [Mg/Mn] > 0.25 (with metallicity [Fe/H] < -0.7).

Reconstructing the merger itself (mass, time, orbit) requires population-level
modelling and is outside the scope of this test: individual orbits cannot be
reversed to the epoch of accretion (~8-11 Gyr ago).
"""
from __future__ import annotations

import numpy as np
import pandas as pd

KIN_REF = "Feuillet et al. 2021: |L_z| <= 500 kpc km/s, 30 <= sqrt(J_R) <= 55"
CHEM_REF = "Das et al. 2020; Horta et al. 2021: [Al/Fe] < -0.075, [Mg/Mn] > 0.25, [Fe/H] < -0.7"


def flags(df: pd.DataFrame) -> pd.DataFrame:
    sjr = np.sqrt(df["J_R"].clip(0))
    kin = (df["Lz"].abs() <= 500) & (sjr >= 30) & (sjr <= 55)
    mgmn = df["MG_FE"] - df["MN_FE"]
    chem_ok = df["AL_FE"].notna() & mgmn.notna() & df["FE_H"].notna()
    chem = chem_ok & (df["AL_FE"] < -0.075) & (mgmn > 0.25) & (df["FE_H"] < -0.7)
    return pd.DataFrame({"gse_kinematic": kin, "accreted_chemistry": chem, "chem_measured": chem_ok,
                         "mg_mn": mgmn}, index=df.index)


FEH_MAX = -0.7  # all populations are compared at the same metallicity


def _wilson(k: int, n: int, z: float = 1.0) -> list[float | None]:
    """Wilson score interval (default 68%) for a binomial fraction."""
    if n == 0:
        return [None, None]
    p = k / n
    den = 1 + z * z / n
    c = (p + z * z / (2 * n)) / den
    h = z * np.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den
    return [float(c - h), float(c + h)]


def population_summary(stars: pd.DataFrame) -> dict:
    """Fraction of stars with accreted-like chemistry in a dynamically selected GSE sample vs controls.

    Every population is restricted to good astrometry, measured Al/Mg/Mn/Fe and
    [Fe/H] < -0.7, so the chemical criterion's own metallicity cut cannot by
    itself create a difference between populations."""
    f = flags(stars)
    base = ((stars["ruwe"] < 1.4) & (stars["parallax_corr"] / stars["parallax_error"] > 5)
            & f["chem_measured"] & (stars["FE_H"] < FEH_MAX)).to_numpy()
    kin = f["gse_kinematic"].to_numpy() & base
    disc = (stars["zmax"] < 0.5).to_numpy() & (stars["ecc"] < 0.2).to_numpy() & base
    halo_other = (~f["gse_kinematic"]).to_numpy() & (stars["ecc"] > 0.5).to_numpy() & base
    acc = f["accreted_chemistry"].to_numpy()

    def frac(m):
        n, k = int(m.sum()), int((acc & m).sum())
        return {"n": n, "k": k, "fraction": (k / n) if n else None, "interval_68": _wilson(k, n)}

    return {
        "criteria": {"kinematic": KIN_REF, "chemical": CHEM_REF},
        "common_cuts": f"RUWE < 1.4, parallax/error > 5, [Al/Fe], [Mg/Fe], [Mn/Fe] measured, [Fe/H] < {FEH_MAX}",
        "n_kinematic_gse": int(kin.sum()),
        "populations": {
            "gse_kinematic": frac(kin),
            "other_eccentric_halo": frac(halo_other),
            "metal_poor_cold_disc_control": frac(disc),
        },
        # flat view kept for simple clients
        "accreted_chem_fraction": {
            "gse_kinematic": frac(kin)["fraction"],
            "metal_poor_cold_disc_control": frac(disc)["fraction"],
            "other_eccentric_halo": frac(halo_other)["fraction"],
        },
        "n_controls": {"metal_poor_cold_disc": int(disc.sum()), "other_eccentric_halo": int(halo_other.sum())},
        "interpretation": (
            "If GSE debris is real and chemically distinct, the kinematically selected stars should show a "
            "much higher fraction of accreted-like chemistry than the metallicity-matched controls, even though "
            "chemistry was not used to select them."),
    }


def star_test(row: pd.Series) -> dict:
    v = lambda k: float(row[k]) if row[k] is not None and np.isfinite(float(row[k])) else float("nan")
    lz, jr, al, mg, mn, feh = v("Lz"), v("J_R"), v("AL_FE"), v("MG_FE"), v("MN_FE"), v("FE_H")
    sjr = np.sqrt(max(jr, 0.0)) if np.isfinite(jr) else float("nan")
    mgmn = mg - mn
    chem_ok = bool(np.isfinite(al) and np.isfinite(mgmn) and np.isfinite(feh))
    return {"gse_kinematic": bool(abs(lz) <= 500 and 30 <= sjr <= 55),
            "accreted_chemistry": bool(chem_ok and al < -0.075 and mgmn > 0.25 and feh < -0.7),
            "chem_measured": chem_ok, "Lz": lz, "sqrt_JR": sjr, "Al_Fe": al,
            "Mg_Mn": mgmn if np.isfinite(mgmn) else None, "Fe_H": feh,
            "criteria": {"kinematic": KIN_REF, "chemical": CHEM_REF}}
