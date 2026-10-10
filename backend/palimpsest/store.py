"""In-memory access to the cached analysis tables.

All tables are loaded lazily, once, behind a lock: since Python 3.12
``functools.cached_property`` no longer locks, and the API warms the store in a
background thread while the first requests may already be arriving.
"""
from __future__ import annotations

import json
import threading

import numpy as np
import pandas as pd

from . import chemistry, config as C


def _once(fn):
    """Thread-safe lazily computed attribute (re-entrant: loaders may use each other)."""
    name = "_" + fn.__name__

    @property
    def prop(self):
        try:
            return self.__dict__[name]
        except KeyError:
            pass
        with self._lock:
            if name not in self.__dict__:
                self.__dict__[name] = fn(self)
            return self.__dict__[name]
    return prop


def _read_json(path) -> dict:
    return json.loads(path.read_text()) if path.exists() else {}


class Store:
    def __init__(self) -> None:
        self._lock = threading.RLock()

    @_once
    def stars(self) -> pd.DataFrame:
        df = pd.read_parquet(C.STARS_PARQUET)
        if C.GALAH_PARQUET.exists():
            g = pd.read_parquet(C.GALAH_PARQUET).drop_duplicates("source_id")
            df = df.merge(g, on="source_id", how="left", validate="one_to_one")
        df = df.sort_values("idx").reset_index(drop=True)
        if not df["source_id"].is_unique:
            raise ValueError("duplicate Gaia source_id in the analysis table")
        df["source_id_str"] = df["source_id"].astype(str)
        return df

    @_once
    def by_source(self) -> dict[int, int]:
        s = self.stars
        return dict(zip(s["source_id"].to_numpy().tolist(), s.index.to_numpy().tolist()))

    @_once
    def chem(self) -> tuple[np.ndarray, np.ndarray]:
        return chemistry.matrices(self.stars)

    @_once
    def floor(self) -> np.ndarray:
        return chemistry.default_floor()

    @_once
    def clusters(self) -> pd.DataFrame:
        return pd.read_parquet(C.CLUSTERS_PARQUET) if C.CLUSTERS_PARQUET.exists() else pd.DataFrame()

    @_once
    def constellations(self) -> dict:
        return _read_json(C.CONSTELLATIONS_JSON)

    @_once
    def validation(self) -> dict:
        return _read_json(C.VALIDATION_JSON)

    @_once
    def calibration(self) -> dict:
        return _read_json(C.CALIBRATION_JSON)

    @_once
    def galah_offsets(self) -> dict:
        return _read_json(C.CACHE / "galah_cross_survey.json")

    def points_bytes(self, cols: list[str]) -> bytes:
        """Row-major float32 matrix of ``cols`` (cached per column list)."""
        key = "_points_" + ",".join(cols)
        if key not in self.__dict__:
            with self._lock:
                if key not in self.__dict__:
                    s = self.stars
                    arr = np.empty((len(s), len(cols)), dtype=np.float32)
                    for j, c in enumerate(cols):
                        arr[:, j] = s[c].to_numpy(np.float32, na_value=np.nan)
                    self.__dict__[key] = arr.tobytes()
        return self.__dict__[key]

    def rows(self, source_ids) -> pd.DataFrame:
        return self.stars.iloc[self.index_of(source_ids)]

    def index_of(self, source_ids) -> np.ndarray:
        try:
            ids = [int(s) for s in source_ids]
        except (TypeError, ValueError):
            raise ValueError("source_ids must be integers")
        missing = [s for s in ids if s not in self.by_source]
        if missing:
            raise KeyError(f"source_id(s) not in analysis sample: {missing[:5]}")
        return np.array([self.by_source[s] for s in ids], dtype=int)


STORE = Store()
