"""Constellations as an entry point into 3D Galactic structure.

For the stars of a constellation figure we compute true 3D positions, space
velocities, the apparent figure at past/future epochs and pairwise kinematic
relationships.  Over the +-1 Myr shown, Galactic accelerations displace stars by
< 0.1 pc relative to straight-line motion, so the apparent-figure evolution
uses linear propagation of the heliocentric 3D velocity; longer traceback goes
through the full orbit integrator.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from astropy import units as u
from astropy.coordinates import SkyCoord

K = 4.740470446  # km/s per (arcsec/yr * pc)
PC_PER_MYR = 1.0227  # pc/Myr per km/s
MAX_SEP_PC = 50.0     # co-moving test: maximum present separation
MAX_DV_ERR = 3.0      # co-moving test: only decided when the velocity difference is known to <= 3 km/s


def _group_name(v):
    """XHIP group names arrive as scalars or lists with nulls; return a clean string or None."""
    vals = v if isinstance(v, (list, tuple)) else [v]
    vals = [str(x).strip() for x in vals if x is not None and str(x).strip() not in ("", "nan", "None")]
    # numeric values are XHIP group *indices* (meaningless without XHIP's group table): drop them
    vals = [x for x in vals if not x.replace(".", "", 1).isdigit()]
    return "; ".join(dict.fromkeys(vals)) or None


def stars_frame(data: dict) -> pd.DataFrame:
    df = pd.DataFrame(data["stars"])
    if "GrpName" in df:
        df["GrpName"] = df["GrpName"].map(_group_name)
    df["dist_pc"] = 1000.0 / df["parallax"]
    df["dist_err_pc"] = df["dist_pc"] * df["parallax_error"] / df["parallax"]
    df["distance_reliable"] = (df["parallax"] / df["parallax_error"]) >= 5
    has_rv = df["rv"].notna()
    c = SkyCoord(ra=df["ra"].to_numpy() * u.deg, dec=df["dec"].to_numpy() * u.deg,
                 distance=df["dist_pc"].to_numpy() * u.pc,
                 pm_ra_cosdec=df["pmra"].to_numpy() * u.mas / u.yr, pm_dec=df["pmdec"].to_numpy() * u.mas / u.yr,
                 radial_velocity=df["rv"].fillna(0).to_numpy() * u.km / u.s).galactic
    v = c.cartesian.differentials["s"]
    df["X"], df["Y"], df["Z"] = (c.cartesian.x.to_value(u.pc), c.cartesian.y.to_value(u.pc),
                                 c.cartesian.z.to_value(u.pc))
    for name, comp in (("U", v.d_x), ("V", v.d_y), ("W", v.d_z)):
        vals = comp.to_value(u.km / u.s)
        df[name] = np.where(has_rv, vals, np.nan)   # full 3D velocity only with an RV
        df[name + "_tan"] = vals                     # RV set to 0: tangential motion only (for sky propagation)
    # velocity uncertainty (linear propagation of parallax, pm and RV errors)
    d = df["dist_pc"].to_numpy()
    vt_err = K * d / 1000 * np.hypot(df["pmra_error"], df["pmdec_error"]).to_numpy() / np.sqrt(2)
    vt = K * d / 1000 * np.hypot(df["pmra"], df["pmdec"]).to_numpy()
    df["v_err"] = np.sqrt(vt_err ** 2 + (vt * df["parallax_error"] / df["parallax"]) ** 2 + df["rv_error"].fillna(5) ** 2)
    return df


def figure_analysis(data: dict, abbr: str, epochs_kyr=(-1000, -500, -200, -100, 0, 100, 200, 500, 1000)) -> dict:
    fig = next((f for f in data["figures"] if f["abbr"].lower() == abbr.lower()), None)
    if fig is None:
        raise KeyError(abbr)
    hips = sorted({h for seg in fig["lines"] for h in seg})
    all_df = stars_frame(data)
    df = all_df[all_df["HIP"].isin(hips)].copy().reset_index(drop=True)
    pos = df[["X", "Y", "Z"]].to_numpy()
    vel = df[["U", "V", "W"]].to_numpy()
    # stars without an RV are propagated with their tangential motion only
    vel_prop = np.where(np.isfinite(vel), vel, df[["U_tan", "V_tan", "W_tan"]].to_numpy())
    # apparent figure at other epochs (Sun-centred, linear motion)
    sky = []
    for t in epochs_kyr:
        p = pos + vel_prop * PC_PER_MYR * (t / 1000.0)
        r = np.linalg.norm(p, axis=1)
        lon = np.degrees(np.arctan2(p[:, 1], p[:, 0])) % 360
        lat = np.degrees(np.arcsin(p[:, 2] / r))
        g = SkyCoord(l=lon * u.deg, b=lat * u.deg, frame="galactic").icrs
        sky.append({"t_kyr": t, "ra": g.ra.deg.tolist(), "dec": g.dec.deg.tolist(), "dist_pc": r.tolist(),
                    "valid": np.isfinite(vel).all(axis=1).tolist()})
    # pairwise relationships
    n = len(df)
    pairs = []
    for i in range(n):
        for j in range(i + 1, n):
            sep = float(np.linalg.norm(pos[i] - pos[j]))
            reliable = bool(df["distance_reliable"][i] and df["distance_reliable"][j])
            if np.isfinite(vel[i]).all() and np.isfinite(vel[j]).all():
                dv = float(np.linalg.norm(vel[i] - vel[j]))
                dv_err = float(np.hypot(df["v_err"][i], df["v_err"][j]))
            else:
                dv, dv_err = None, None
            if dv is None or not reliable or dv_err > MAX_DV_ERR or sep >= MAX_SEP_PC:
                status = "undetermined" if (sep < MAX_SEP_PC and (dv is None or not reliable or dv_err > MAX_DV_ERR)) \
                    else "not comoving"
            else:
                status = "comoving" if dv < max(3.0, 2 * dv_err) else "not comoving"
            pairs.append({"a": int(df["HIP"][i]), "b": int(df["HIP"][j]), "sep_pc": sep, "dv_kms": dv,
                          "dv_err_kms": dv_err, "status": status, "comoving": status == "comoving"})
    # connected components of co-moving pairs
    parent = {int(h): int(h) for h in df["HIP"]}
    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a
    for p in pairs:
        if p["comoving"]:
            parent[find(p["a"])] = find(p["b"])
    groups = {}
    for h in parent:
        groups.setdefault(find(h), []).append(h)
    comoving = [sorted(g) for g in groups.values() if len(g) > 1]
    cols = ["HIP", "name", "ra", "dec", "dist_pc", "dist_err_pc", "distance_reliable", "X", "Y", "Z", "U", "V", "W", "v_err",
            "astrometry_source", "rv", "rv_error", "rv_source", "feh_xhip", "e_feh_xhip", "r_feh_xhip",
            "age_xhip", "age_lo_xhip", "age_hi_xhip", "SpType", "Vmag", "Hpmag", "GrpName",
            "parallax", "parallax_error", "pmra", "pmra_error", "pmdec", "pmdec_error",
            "parallax_pmra_corr", "parallax_pmdec_corr", "pmra_pmdec_corr"]
    stars = json_safe(df[[c for c in cols if c in df]])
    dists = df["dist_pc"]
    return {
        "abbr": fig["abbr"], "name": fig["name"], "english": fig["english"], "lines": fig["lines"],
        "stars": stars, "sky_epochs": sky, "pairs": pairs, "comoving_groups": comoving,
        "summary": {
            "n_stars": n, "nearest_pc": float(dists.min()), "farthest_pc": float(dists.max()),
            "depth_ratio": float(dists.max() / dists.min()),
            "n_with_rv": int(np.isfinite(vel).all(axis=1).sum()),
            "n_with_feh": int(df["feh_xhip"].notna().sum()),
            "n_unreliable_distance": int((~df["distance_reliable"]).sum()),
            "n_pairs_undetermined": int(sum(p["status"] == "undetermined" for p in pairs)),
        },
        "caveats": [
            "Distances of the brightest stars come mostly from Hipparcos; Gaia DR3 saturates for G < ~3.",
            "Radial velocities, [Fe/H] and ages for bright stars are heterogeneous literature compilations "
            "(XHIP), not a homogeneous survey; chemical comparisons between these stars are indicative only.",
            "'Co-moving' means separation < 50 pc and |dv| < max(3 km/s, 2 sigma), decided only when the "
            "velocity difference is known to <= 3 km/s and both parallaxes have parallax/error >= 5; otherwise "
            "the pair is 'undetermined'. Co-motion is necessary, not sufficient, for a shared origin.",
            "Stars without a radial velocity are propagated on the sky with their tangential motion only.",
        ],
    }


def json_safe(df: pd.DataFrame) -> list[dict]:
    return [{k: (None if (isinstance(v, float) and not np.isfinite(v)) else
                 (v.item() if hasattr(v, "item") else v)) for k, v in r.items()}
            for r in df.to_dict("records")]


def overview(data: dict) -> list[dict]:
    df = stars_frame(data)
    out = []
    for f in data["figures"]:
        hips = {h for seg in f["lines"] for h in seg}
        d = df[df["HIP"].isin(hips)]
        if len(d) == 0:
            continue
        out.append({"abbr": f["abbr"], "name": f["name"], "english": f["english"], "n_stars": int(len(d)),
                    "nearest_pc": float(d["dist_pc"].min()), "farthest_pc": float(d["dist_pc"].max())})
    return sorted(out, key=lambda r: r["name"])
