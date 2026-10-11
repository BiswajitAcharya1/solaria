"""Build frontend/src/constellations/generated/families.json: a few birth families near the Sun,
with their real member stars, the evidence that they belong together, and where they sit in today's sky.

A star is a member when BOTH tests pass (the "same origin" test used throughout solaria):
  motion    its 3D velocity (Gaia DR3 proper motion + parallax + radial velocity) is within
            2 km/s + 2 x the family's internal spread of the family's mean velocity
  place     it lies within the family's extent (2 x half-mass radius, 12-40 pc); internal spread capped at 1.5 km/s
Chemistry is then CHECKED, not assumed: members' [Fe/H] (APOGEE DR17 / GALAH DR4) is compared with
ordinary stars at the same distance. A real family has one chemical fingerprint; the field does not.

Naked-eye members come from Hipparcos (no radial velocity there), tested on place + the part of the
motion across the sky (proper motion predicted from the family's velocity).

Families: Hunt & Reffert 2023 clusters (mean position/velocity/age) + Scorpius-Centaurus assembled from
its HR23 sub-groups + the Ursa Major group from its published (XHIP) members.

Run:  .venv/bin/python scripts/build_families.py
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "data/cache"
OUT = ROOT / "frontend/src/constellations/generated/families.json"
K = 4.740470446
R = np.array([
    [-0.0548755604162154, -0.8734370902348850, -0.4838350155487132],
    [0.4941094278755837, -0.4448296299600112, 0.7469822444972189],
    [-0.8676661490190047, -0.1980763734312015, 0.4559837761750669],
])
rng = np.random.default_rng(7)


def basis(ra, dec):
    a, d = np.radians(ra), np.radians(dec)
    u = np.stack([np.cos(d) * np.cos(a), np.cos(d) * np.sin(a), np.sin(d)], -1)
    ea = np.stack([-np.sin(a), np.cos(a), np.zeros_like(a)], -1)
    ed = np.stack([-np.sin(d) * np.cos(a), -np.sin(d) * np.sin(a), np.cos(d)], -1)
    return u, ea, ed


def six_d(ra, dec, plx, pmra, pmdec, rv):
    """heliocentric Galactic position (pc) and velocity (km/s)"""
    d = 1000.0 / plx
    u, ea, ed = basis(ra, dec)
    kd = (K * d / 1000.0)[:, None]
    v = rv[:, None] * u + kd * (pmra[:, None] * ea + pmdec[:, None] * ed)
    return (u * d[:, None]) @ R.T, v @ R.T


# ------------------------------------------------------------------ families
c = pd.read_parquet(CACHE / "clusters_hr23.parquet")
c["sigv"] = K * np.hypot(c.s_pmRA.fillna(0), c.s_pmDE.fillna(0)) / np.sqrt(2) * c.dist50 / 1000.0
c["l"] = c.GLON % 360
sco = c[((c.l >= 285) | (c.l <= 0.5)) & c.GLAT.between(-12, 32) & c.dist50.between(90, 200)
        & c.age_myr.between(4, 25) & c.RV.notna() & (c.n_RV >= 5)]


def from_hr23(hr23, **kw):
    r = c[c.Name == hr23].iloc[0]
    return dict(parts=[(np.array([r.Xh, r.Yh, r.Zh]), np.array([r.U, r.V, r.W]), min(max(2 * r.r50pc, 12.0), 40.0), min(float(r.sigv), 1.5))],
                age=float(r.age_myr), n_cat=int(r.N), **kw)


FAMILIES = [
    dict(id="scocen", name="Scorpius–Centaurus", color="#ff8a6b", exploded=True,
         blurb="the nearest family of heavy, short-lived stars. its supernovae blew the bubble the Sun sits in.",
         parts=[(np.array([r.Xh, r.Yh, r.Zh]), np.array([r.U, r.V, r.W]), min(max(2 * r.r50pc, 12.0), 40.0), min(float(r.sigv), 1.5)) for r in sco.itertuples()],
         age=float(np.percentile(sco.age_myr, 90)), n_cat=int(sco.N.sum())),  # its oldest sub-groups (UCL, LCC)
    from_hr23("Melotte_22", id="pleiades", name="Pleiades", color="#8fc1ff", exploded=False,
              blurb="the seven sisters: a young cluster still holding together, slowly losing its outer stars."),
    from_hr23("Melotte_20", id="alphaper", name="Alpha Persei cluster", color="#b9a6ff", exploded=False,
              blurb="a young family around Mirfak, the brightest star of Perseus."),
    from_hr23("Melotte_25", id="hyades", name="Hyades", color="#ffcf7a", exploded=False,
              blurb="the nearest cluster: the V-shaped face of Taurus the bull. old, and slowly dissolving into a stream."),
]

# Ursa Major group: not in HR23 (too spread out); defined by its published members in our bright-star data
cons = json.loads((CACHE / "constellations.json").read_text())
uma = [s for s in cons["stars"] if s.get("GrpName") == "Ursa Major" and s.get("rv") is not None]
ux, uv = six_d(np.array([s["ra"] for s in uma]), np.array([s["dec"] for s in uma]), np.array([s["parallax"] for s in uma]),
               np.array([s["pmra"] for s in uma]), np.array([s["pmdec"] for s in uma]), np.array([s["rv"] for s in uma]))
FAMILIES.append(dict(id="uma", name="Ursa Major group", color="#ffe9a8", exploded=False,
                     blurb="five stars of the Big Dipper are siblings, born together about 400 million years ago.",
                     parts=[(ux.mean(0), uv.mean(0), 20.0, 1.0)], age=414.0, n_cat=len(uma)))

# ------------------------------------------------------------------ stars to test
g = pd.read_parquet(CACHE / "gaia_dr3.parquet", columns=[
    "source_id", "ra", "dec", "parallax", "parallax_error", "pmra", "pmdec", "radial_velocity", "radial_velocity_error",
    "ruwe", "phot_g_mean_mag", "bp_rp"])
g = g[(g.parallax > 2.5) & (g.parallax / g.parallax_error > 10) & (g.ruwe < 1.4) & g.radial_velocity.notna()
      & (g.radial_velocity_error < 3)].reset_index(drop=True)
gx, gv = six_d(g.ra.values, g.dec.values, g.parallax.values, g.pmra.values, g.pmdec.values, g.radial_velocity.values)

# chemistry, keyed by Gaia source_id
chem = pd.read_parquet(CACHE / "stars.parquet", columns=["source_id", "FE_H"]).dropna()
gal = pd.read_parquet(CACHE / "galah_dr4_matched.parquet", columns=["source_id", "galah_FE_H"]).dropna()
feh = dict(zip(chem.source_id, chem.FE_H))
for sid, v in zip(gal.source_id, gal.galah_FE_H):
    feh.setdefault(sid, v)
g["feh"] = g.source_id.map(feh)

# Hipparcos naked-eye sky + constellation figures (to say which constellation a star appears in)
sky = json.loads((ROOT / "frontend/src/constellations/generated/sky_backdrop.json").read_text())
hip = pd.DataFrame({k: sky[k] for k in ["hip", "ra", "dec", "plx", "pmra", "pmdec", "mag"]})
hip = hip[(hip.mag < 6.0) & (hip.plx > 2.5)].reset_index(drop=True)
names = {s["HIP"]: s.get("name") for s in cons["stars"]}
fig_of: dict[int, str] = {}
for f in cons["figures"]:
    for seg in f["lines"]:
        for h in seg:
            fig_of.setdefault(h, f["name"])
fig_stars = [s for s in cons["stars"] if s["HIP"] in fig_of]
fu, _, _ = basis(np.array([s["ra"] for s in fig_stars]), np.array([s["dec"] for s in fig_stars]))
fig_name = np.array([fig_of[s["HIP"]] for s in fig_stars])


def constellation_of(ra, dec):
    """the constellation whose figure stars are nearest on the sky (within 15 deg)"""
    u, _, _ = basis(np.atleast_1d(ra), np.atleast_1d(dec))
    cos = u @ fu.T
    j = cos.argmax(1)
    return [fig_name[k] if cos[i, k] > np.cos(np.radians(15)) else None for i, k in enumerate(j)]


def members_6d(parts):
    ok = np.zeros(len(g), bool)
    for x0, v0, reach, sig in parts:
        ok |= (np.linalg.norm(gx - x0, axis=1) < reach) & (np.linalg.norm(gv - v0, axis=1) < 2 + 2 * sig)
    return ok


def members_sky(parts):
    """Hipparcos: place + proper motion predicted from the family's velocity"""
    d = 1000.0 / hip.plx.values
    u, ea, ed = basis(hip.ra.values, hip.dec.values)
    xg = (u * d[:, None]) @ R.T
    ok = np.zeros(len(hip), bool)
    for x0, v0, reach, sig in parts:
        vi = R.T @ v0  # family velocity in ICRS axes
        df = np.clip(u @ (R.T @ x0), 1.0, None)  # the family's distance along this line of sight (not the star's noisier one)
        pa = (ea @ vi) / (K * df / 1000.0)
        pd_ = (ed @ vi) / (K * df / 1000.0)
        dvt = K * df / 1000.0 * np.hypot(hip.pmra.values - pa, hip.pmdec.values - pd_)
        # Hipparcos parallaxes can be off by ~10% (famously for the Pleiades): allow slack along the line of sight
        rel = xg - x0
        los = np.einsum("ij,j->i", rel, x0 / np.linalg.norm(x0))
        perp = np.linalg.norm(rel - los[:, None] * (x0 / np.linalg.norm(x0)), axis=1)
        ok |= (perp < reach) & (np.abs(los) < max(reach, 0.2 * np.linalg.norm(x0))) & (dvt < 2 + 2 * sig)
    return ok


out = []
for fam in FAMILIES:
    parts = fam.pop("parts")
    m = members_6d(parts)
    mem = g[m]
    mx, mv = gx[m], gv[m]
    centre = mx.mean(0) if len(mem) else parts[0][0]
    vmean = mv.mean(0) if len(mem) else parts[0][1]
    # evidence 1: motion. members' speeds relative to the family vs random stars at the same distance
    dist = np.linalg.norm(centre)
    field = np.where(~m & (np.abs(np.linalg.norm(gx, axis=1) - dist) < 60))[0]
    field = rng.choice(field, min(400, len(field)), replace=False)
    dv_mem = np.linalg.norm(mv - vmean, axis=1)
    dv_field = np.linalg.norm(gv[field] - vmean, axis=1)
    # evidence 2: chemistry
    fm = mem.feh.dropna().values
    ff = g.feh.values[field]
    ff = ff[np.isfinite(ff)]
    # stars to draw: keep it light, brightest first
    show = mem.sort_values("phot_g_mean_mag").head(220)
    sx, sv = gx[show.index], gv[show.index]
    # naked-eye members and the constellations they fall in
    hm = hip[members_sky(parts)]
    hcons = constellation_of(hm.ra.values, hm.dec.values)
    hxyz, _ = six_d(hm.ra.values, hm.dec.values, hm.plx.values, hm.pmra.values, hm.pmdec.values, np.zeros(len(hm)))
    bright = [dict(hip=int(r.hip), name=names.get(int(r.hip)) or f"HIP {int(r.hip)}", mag=round(float(r.mag), 2),
                   ra=round(float(r.ra), 4), dec=round(float(r.dec), 4), constellation=cn,
                   xyz=[round(float(a), 1) for a in p])
              for r, cn, p in zip(hm.itertuples(), hcons, hxyz)]
    counts = pd.Series([b["constellation"] for b in bright if b["constellation"]]).value_counts()
    out.append(dict(
        **fam, n=int(len(mem)),
        centre=[round(float(x), 2) for x in centre], uvw=[round(float(x), 2) for x in vmean],
        stars=[[round(float(a), 1) for a in (*p, *v)] + [round(float(gm), 1)] for p, v, gm in zip(sx, sv, show.phot_g_mean_mag)],
        bright=sorted(bright, key=lambda b: b["mag"]),
        constellations=[[k, int(n)] for k, n in counts.items()],
        evidence=dict(
            dv_members=round(float(np.median(dv_mem)), 2) if len(dv_mem) else None,
            dv_field=round(float(np.median(dv_field)), 1) if len(dv_field) else None,
            feh_members=[round(float(x), 3) for x in fm[:120]],
            feh_field=[round(float(x), 3) for x in rng.permutation(ff)[:120]],
        ),
    ))
    print(f"{fam['name']:24s} age {fam['age']:6.1f}  {len(mem):4d} Gaia members  {len(fm):3d} with chemistry "
          f"(spread {np.std(fm) if len(fm) > 2 else float('nan'):.3f} vs field {np.std(ff) if len(ff) > 2 else float('nan'):.3f})  "
          f"dv {np.median(dv_mem) if len(dv_mem) else float('nan'):.1f} vs {np.median(dv_field):.1f} km/s  "
          f"{len(bright)} naked-eye in {len(counts)} constellations: {', '.join(f'{k} {n}' for k, n in counts.head(6).items())}")

OUT.write_text(json.dumps({
    "source": "Gaia DR3; Hunt & Reffert 2023; APOGEE DR17; GALAH DR4; Hipparcos; XHIP",
    "families": out,
}, separators=(",", ":")))
print("->", OUT.relative_to(ROOT), f"{OUT.stat().st_size / 1024:.0f} KB")
