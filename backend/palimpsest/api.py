"""FastAPI application: scientific computation endpoints + the built web client."""
from __future__ import annotations

import inspect
import json
import math
import threading
from contextlib import asynccontextmanager

import numpy as np
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import analysis, chemistry, families, orbits, report
from . import config as C
from .store import STORE

MAX_DISCOVER_STARS = 30000   # same limit as analysis.discover (HDBSCAN: ~10 s at 28k stars)
MAX_GROUP = 400
# Orbit budget per request, in units of "orbits x 100 Myr": ~4000 integrations of 100 Myr
# take ~10 s in the McMillan (2017) potential on a laptop, keeping requests interactive.
ORBIT_BUDGET = 4000
MAX_GROUP_MC = 4000          # members x Monte Carlo samples for a group traceback


def clean(o):
    """Recursively convert numpy types and replace NaN/inf by null (strict JSON)."""
    if isinstance(o, dict):
        return {str(k): clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [clean(v) for v in o]
    if isinstance(o, np.ndarray):
        return clean(o.tolist())
    if isinstance(o, (np.floating, float)):
        f = float(o)
        return f if math.isfinite(f) else None
    if isinstance(o, np.integer):
        return int(o)
    if isinstance(o, np.bool_):
        return bool(o)
    return o


class SafeJSON(JSONResponse):
    def render(self, content) -> bytes:
        return json.dumps(clean(content), separators=(",", ":"), allow_nan=False).encode()


_ready = {"potential": False, "stars": False, "anomaly": False, "error": None}


def _warm():
    try:
        if not C.STARS_PARQUET.exists():
            raise FileNotFoundError(f"{C.STARS_PARQUET} missing - run scripts/build_dataset.py")
        _ = STORE.stars
        _ready["stars"] = True
        orbits.get_potential(C.DEFAULT_POTENTIAL)
        orbits.get_potential("MWPotential2014")
        _ready["potential"] = True
        analysis.anomaly_model()
        _ready["anomaly"] = True
    except Exception as e:  # surfaced via /api/status
        _ready["error"] = repr(e)


@asynccontextmanager
async def lifespan(_app):
    threading.Thread(target=_warm, daemon=True).start()
    yield


app = FastAPI(title="Palimpsest - Galactic archaeology workbench", default_response_class=SafeJSON,
              lifespan=lifespan)
app.add_middleware(GZipMiddleware, minimum_size=2000)


def _guard(fn, *a, **k):
    """Map scientific-layer exceptions to HTTP errors."""
    try:
        return fn(*a, **k)
    except FileNotFoundError as e:
        raise HTTPException(503, f"dataset not available: {e}")
    except KeyError as e:
        raise HTTPException(404, str(e).strip("'\""))
    except (ValueError, np.linalg.LinAlgError) as e:
        raise HTTPException(400, str(e))


def _ids(values: list[str] | list[int], lo: int = 1, hi: int = MAX_GROUP) -> list[int]:
    try:
        out = [int(str(v).strip()) for v in values]
    except ValueError:
        raise HTTPException(400, "source_ids must be Gaia DR3 integer identifiers")
    out = list(dict.fromkeys(out))  # de-duplicate, keep order
    if not lo <= len(out) <= hi:
        raise HTTPException(400, f"between {lo} and {hi} distinct source_ids required (got {len(out)})")
    return out


def _stars():
    if not C.STARS_PARQUET.exists():
        raise HTTPException(503, "dataset not built: run `python scripts/build_dataset.py`")
    return STORE.stars


@app.get("/api/status")
def status():
    return _ready


@app.get("/api/meta")
def meta():
    s = _stars()
    X = STORE.chem[0]
    n_el = np.isfinite(X).sum(axis=1)
    return {
        "n_stars": len(s),
        "n_with_full_chemistry": int((n_el == X.shape[1]).sum()),
        "n_with_ge6_elements": int((n_el >= 6).sum()),
        "n_galah_matched": int(s["galah_FE_H"].notna().sum()) if "galah_FE_H" in s else 0,
        "n_giants": int(s["is_giant"].sum()), "n_occam_members": int((s["occam_cg_prob"] >= 0.7).sum()),
        "distance_pc_percentiles": [float(np.percentile(s["dist_pc"], q)) for q in (5, 50, 95)],
        "potentials": C.POTENTIALS, "default_potential": C.DEFAULT_POTENTIAL,
        "elements": [{"key": e, "label": C.CHEM_LABELS[e]} for e in C.CHEM_ELEMENTS],
        "floor": dict(zip(C.CHEM_ELEMENTS, map(float, STORE.floor))),
        "floor_by_class": {k: dict(zip(C.CHEM_ELEMENTS, map(float, chemistry.default_floor(k))))
                           for k in ("giant", "dwarf")},
        "selection": C.SELECTION, "provenance": analysis.provenance({}),
        "galah_offsets": STORE.galah_offsets, "default_lookback_myr": C.DEFAULT_LOOKBACK_MYR,
        "max_lookback_myr": C.MAX_LOOKBACK_MYR,
    }


POINT_COLS = ["X", "Y", "Z", "U", "V", "W", "FE_H", "MG_FE", "ecc", "zmax", "Lz", "J_R", "J_z", "TEFF", "LOGG",
              "age_gyr", "R", "vT", "AL_FE", "MN_FE"]


@app.get("/api/points")
def points():
    """All stars as a row-major float32 matrix (columns in X-Columns); NaN = not measured."""
    _stars()
    buf = STORE.points_bytes(POINT_COLS)
    return Response(buf, media_type="application/octet-stream",
                    headers={"X-Columns": ",".join(POINT_COLS), "X-Rows": str(len(STORE.stars)),
                             "Access-Control-Expose-Headers": "X-Columns, X-Rows",
                             "Cache-Control": "max-age=3600"})


@app.get("/api/index/{i}")
def by_index(i: int):
    s = _stars()
    if not 0 <= i < len(s):
        raise HTTPException(404, "index out of range")
    return {"source_id": s["source_id_str"].iat[i]}


@app.get("/api/indices")
def indices(ids: str = Query(..., max_length=200000)):
    """Row indices (into /api/points) for comma-separated source_ids; unknown ids are skipped."""
    _stars()
    out = []
    for sid in ids.split(","):
        try:
            out.append(int(STORE.by_source[int(sid)]))
        except (KeyError, ValueError):
            pass
    return out


@app.get("/api/star/{source_id}")
def star(source_id: int):
    _stars()
    d = _guard(analysis.star_detail, source_id)
    d["index"] = int(STORE.by_source[source_id])
    return d


# Common names -> catalogue designations used by OCCAM / Hunt & Reffert
CLUSTER_ALIASES = {"m67": "NGC 2682", "pleiades": "Melotte 22", "m45": "Melotte 22", "praesepe": "NGC 2632",
                   "beehive": "NGC 2632", "m44": "NGC 2632", "hyades": "Melotte 25", "alpha persei": "Melotte 20",
                   "alpha per": "Melotte 20", "m35": "NGC 2168", "m11": "NGC 6705", "coma berenices": "Melotte 111"}


@app.get("/api/search")
def search(q: str = Query(..., max_length=64)):
    """Search by Gaia DR3 source_id prefix, APOGEE ID or cluster name (common names accepted)."""
    _stars()
    q = CLUSTER_ALIASES.get(q.strip().lower(), q)
    return analysis.search(q)


class OrbitReq(BaseModel):
    source_ids: list[str] = Field(..., min_length=1, max_length=50)
    lookback_myr: float = Field(C.DEFAULT_LOOKBACK_MYR, gt=0, le=C.MAX_LOOKBACK_MYR)
    n_mc: int = Field(32, ge=2, le=256)
    potentials: list[str] = Field([C.DEFAULT_POTENTIAL], min_length=1, max_length=len(C.POTENTIALS))


@app.post("/api/orbits")
def orbits_ep(r: OrbitReq):
    ids = _ids(r.source_ids, 1, 50)
    cost = len(ids) * r.n_mc * len(set(r.potentials)) * max(r.lookback_myr, 100.0) / 100.0
    if cost > ORBIT_BUDGET:
        raise HTTPException(400, f"request too large: stars x samples x potentials x (look-back/100 Myr) = "
                                 f"{cost:.0f} > {ORBIT_BUDGET}; reduce samples, stars or look-back")
    bad = [p for p in r.potentials if p not in C.POTENTIALS]
    if bad:
        raise HTTPException(400, f"unknown potential(s) {bad}; options: {list(C.POTENTIALS)}")
    return _guard(analysis.orbit_history, ids, r.lookback_myr, r.n_mc, list(dict.fromkeys(r.potentials)))


@app.get("/api/chem_neighbours/{source_id}")
def chem_neighbours(source_id: int, n: int = Query(25, ge=1, le=500)):
    _stars()
    return _guard(analysis.chemical_neighbours, source_id, n)


class SiblingReq(BaseModel):
    source_id: str
    birth_sigma_kms: float = Field(1.0, gt=0, le=20)
    p_chem: float = Field(0.05, gt=0, lt=1)
    lookback_myr: float = Field(100.0, gt=0, le=C.MAX_LOOKBACK_MYR)


@app.post("/api/siblings")
def siblings(r: SiblingReq):
    sid = _ids([r.source_id], 1, 1)[0]
    return _guard(analysis.sibling_search, sid, r.birth_sigma_kms, r.p_chem, 8, r.lookback_myr)


class DiscoverReq(BaseModel):
    center_pc: list[float] = Field([0, 0, 0], min_length=3, max_length=3)
    radius_pc: float = Field(200, gt=0, le=5000)
    mode: str = "phase_space"
    min_cluster_size: int = Field(8, ge=3, le=1000)
    min_samples: int = Field(5, ge=1, le=1000)
    min_poe: float = Field(10.0, ge=5, le=1000)
    pos_scale_pc: float = Field(10.0, gt=0)
    vel_scale_kms: float = Field(1.0, gt=0)
    selection: str = "eom"   # HDBSCAN cluster selection: 'eom' keeps rich clusters whole, 'leaf' finest structure


@app.post("/api/discover")
def discover(r: DiscoverReq):
    if r.mode not in ("phase_space", "integrals"):
        raise HTTPException(400, "mode must be 'phase_space' or 'integrals'")
    if r.selection not in ("eom", "leaf"):
        raise HTTPException(400, "selection must be 'eom' or 'leaf'")
    n = int(families.region_mask(_stars(), tuple(r.center_pc), r.radius_pc, r.min_poe).sum())
    if n > MAX_DISCOVER_STARS:
        raise HTTPException(400, f"region contains {n} stars (limit {MAX_DISCOVER_STARS} for interactive "
                                 "clustering): reduce the radius or raise the parallax/error cut")
    kw = {"selection": r.selection} if "selection" in inspect.signature(analysis.discover).parameters else {}
    return _guard(analysis.discover, tuple(r.center_pc), r.radius_pc, r.mode, r.min_cluster_size, r.min_samples,
                  r.min_poe, r.pos_scale_pc, r.vel_scale_kms, **kw)


class EvalReq(BaseModel):
    source_ids: list[str]
    lookback_myr: float = Field(50.0, gt=0, le=C.MAX_LOOKBACK_MYR)
    n_mc: int = Field(48, ge=4, le=200)
    n_null: int = Field(200, ge=50, le=2000)


@app.post("/api/evaluate")
def evaluate(r: EvalReq):
    ids = _ids(r.source_ids, 3, MAX_GROUP)
    _stars()
    # large groups: fewer Monte Carlo realisations per member keep the traceback interactive;
    # the value actually used is reported in the result (traceback.n_mc)
    scale = max(r.lookback_myr, 100.0) / 100.0
    n_mc = int(min(r.n_mc, max(8, MAX_GROUP_MC / scale // len(ids))))
    out = _guard(analysis.evaluate_group, ids, r.lookback_myr, n_mc, r.n_null)
    if n_mc < r.n_mc:
        out.setdefault("notes", []).append(f"Monte Carlo realisations per member reduced from {r.n_mc} to {n_mc} "
                                           f"for a {len(ids)}-member group to bound computation time.")
    return out


class EncReq(BaseModel):
    source_id: str
    cluster: str = Field(..., min_length=1, max_length=64)
    lookback_myr: float = Field(50.0, gt=0, le=C.MAX_LOOKBACK_MYR)
    n_mc: int = Field(200, ge=10, le=1000)
    radius_pc: float | None = Field(None, gt=0, le=1000)


@app.post("/api/encounter")
def encounter(r: EncReq):
    sid = _ids([r.source_id], 1, 1)[0]
    _stars()
    return _guard(analysis.encounter_test, sid, r.cluster, r.lookback_myr, r.n_mc, 30, r.radius_pc)


@app.get("/api/clusters")
def clusters(max_dist_pc: float = Query(1500, gt=0), with_rv: bool = True, q: str = Query("", max_length=64)):
    """Hunt & Reffert (2023) clusters, nearest first."""
    c = STORE.clusters
    if c.empty:
        return []
    m = c["dist50"] <= max_dist_pc
    if with_rv:
        m &= c["RV"].notna() & (c["n_RV"] >= 3)
    if q:
        m &= c["Name"].str.contains(q, case=False, regex=False) | \
             c["AllNames"].fillna("").str.contains(q, case=False, regex=False)
    d = c[m].sort_values("dist50")
    return [{"name": a, "type": b, "dist_pc": e, "age_myr": f, "n": int(g), "X": x, "Y": y, "Z": z, "rv": rv,
             "rt_pc": rt}
            for a, b, e, f, g, x, y, z, rv, rt in zip(d["Name"], d["Type"], d["dist50"], d["age_myr"], d["N"],
                                                       d["Xh"], d["Yh"], d["Zh"], d["RV"], d["rtpc"])]


@app.get("/api/presets")
def presets():
    """Known OCCAM open clusters in the sample (validation targets)."""
    s = _stars()
    t = s[(s["occam_cg_prob"] >= 0.7) & (s["occam_rv_prob"] >= 0.5)]
    out = []
    for name, g in t.groupby("occam_cluster"):
        if len(g) >= 6:
            out.append({"name": name, "n": int(len(g)), "dist_pc": float(g["dist_pc"].median()),
                        "centroid_pc": [float(v) for v in g[["X", "Y", "Z"]].median()],
                        "source_ids": g["source_id_str"].tolist()})
    return sorted(out, key=lambda r: -r["n"])


@app.get("/api/constellations")
def constellations():
    if not STORE.constellations:
        raise HTTPException(503, "constellation data not built")
    return analysis.constellation_overview()


@app.get("/api/constellations/{abbr}")
def constellation(abbr: str):
    if not STORE.constellations:
        raise HTTPException(503, "constellation data not built")
    return _guard(analysis.constellation_detail, abbr)


@app.get("/api/constellations/{abbr}/traceback")
def constellation_tb(abbr: str, lookback_myr: float = Query(5.0, gt=0, le=50.0)):
    if not STORE.constellations:
        raise HTTPException(503, "constellation data not built")
    return _guard(analysis.constellation_traceback, abbr, lookback_myr)


@app.get("/api/merger")
def merger_ep():
    _stars()
    return analysis.merger_summary()


@app.get("/api/anomalies")
def anomalies_ep(n: int = Query(40, ge=1, le=1000), min_z: float = Query(5.0, ge=0)):
    _stars()
    return analysis.anomaly_model().scan(n, min_z).to_dict("records")


@app.get("/api/validation")
def validation():
    return STORE.validation


class ReportReq(BaseModel):
    kind: str
    result: dict
    title: str | None = Field(None, max_length=200)


@app.post("/api/report", response_class=PlainTextResponse)
def make_report(r: ReportReq):
    makers = {"group": lambda: report.group_report(r.result, r.title or "Candidate stellar family"),
              "siblings": lambda: report.sibling_report(r.result),
              "encounter": lambda: report.encounter_report(r.result)}
    if r.kind not in makers:
        raise HTTPException(400, f"unknown report kind {r.kind!r}; options: {list(makers)}")
    try:
        return PlainTextResponse(makers[r.kind](), media_type="text/markdown")
    except (KeyError, TypeError, IndexError) as e:
        raise HTTPException(400, f"result is not a valid '{r.kind}' result (missing/invalid field: {e})")


@app.get("/api/members.csv", response_class=PlainTextResponse)
def members_csv(ids: str = Query(..., max_length=200000)):
    _stars()
    sids = [s for s in ids.split(",") if s.strip()]
    return PlainTextResponse(report.members_csv(STORE.stars, sids), media_type="text/csv")


@app.get("/api/{path:path}", include_in_schema=False)
def api_not_found(path: str):
    raise HTTPException(404, f"no API endpoint /api/{path}")


# --- web client -----------------------------------------------------------
DIST = C.ROOT / "frontend" / "dist"
if DIST.exists() and (DIST / "assets").exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        f = (DIST / path).resolve()
        if path and f.is_file() and DIST.resolve() in f.parents:
            return FileResponse(f)
        return FileResponse(DIST / "index.html")
