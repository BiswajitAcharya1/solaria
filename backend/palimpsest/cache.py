"""Caching layer for expensive computations with automatic invalidation."""
from __future__ import annotations

import hashlib
import json
import threading
import time
from dataclasses import dataclass, field
from functools import wraps
from pathlib import Path
from typing import Any, Callable, TypeVar

import numpy as np

from . import config as C

T = TypeVar("T")

CACHE_DIR = C.CACHE / "compute"
CACHE_DIR.mkdir(parents=True, exist_ok=True)


@dataclass
class CacheEntry:
    key: str
    value: Any
    timestamp: float = field(default_factory=time.time)
    size_bytes: int = 0


class ComputeCache:
    """Thread-safe disk-backed cache for expensive computations."""

    def __init__(self, max_memory_mb: int = 512):
        self._memory: dict[str, CacheEntry] = {}
        self._lock = threading.RLock()
        self._max_bytes = max_memory_mb * 1024 * 1024
        self._current_bytes = 0

    def _make_key(self, func_name: str, *args, **kwargs) -> str:
        data = json.dumps([func_name, args, kwargs], sort_keys=True, default=str).encode()
        return hashlib.sha256(data).hexdigest()[:32]

    def _disk_path(self, key: str) -> Path:
        return CACHE_DIR / f"{key}.npz"

    def get(self, func_name: str, *args, **kwargs) -> Any | None:
        key = self._make_key(func_name, *args, **kwargs)
        with self._lock:
            if key in self._memory:
                return self._memory[key].value
            path = self._disk_path(key)
            if path.exists():
                try:
                    data = np.load(path, allow_pickle=True)
                    value = data["value"].item() if "value" in data else None
                    if value is not None:
                        self._store_in_memory(key, value)
                        return value
                except Exception:
                    path.unlink(missing_ok=True)
        return None

    def set(self, func_name: str, value: Any, *args, **kwargs) -> None:
        key = self._make_key(func_name, *args, **kwargs)
        with self._lock:
            self._store_in_memory(key, value)
            self._persist_to_disk(key, value)

    def _store_in_memory(self, key: str, value: Any) -> None:
        size = self._estimate_size(value)
        while self._current_bytes + size > self._max_bytes and self._memory:
            oldest = min(self._memory.items(), key=lambda kv: kv[1].timestamp)
            self._current_bytes -= oldest[1].size_bytes
            del self._memory[oldest[0]]
        self._memory[key] = CacheEntry(key, value, size_bytes=size)
        self._current_bytes += size

    def _persist_to_disk(self, key: str, value: Any) -> None:
        try:
            path = self._disk_path(key)
            np.savez_compressed(path, value=np.array(value, dtype=object))
        except Exception:
            pass  # Disk cache is best-effort

    def _estimate_size(self, value: Any) -> int:
        if isinstance(value, np.ndarray):
            return value.nbytes
        if isinstance(value, dict):
            return sum(self._estimate_size(v) for v in value.values())
        if isinstance(value, (list, tuple)):
            return sum(self._estimate_size(v) for v in value)
        if isinstance(value, str):
            return len(value.encode())
        return 1024  # rough estimate

    def clear(self) -> None:
        with self._lock:
            self._memory.clear()
            self._current_bytes = 0
            for f in CACHE_DIR.glob("*.npz"):
                f.unlink(missing_ok=True)


_CACHE = ComputeCache()


def cached_compute(func: Callable[..., T]) -> Callable[..., T]:
    """Decorator to cache expensive function results."""
    @wraps(func)
    def wrapper(*args, **kwargs):
        cached = _CACHE.get(func.__name__, *args, **kwargs)
        if cached is not None:
            return cached
        result = func(*args, **kwargs)
        _CACHE.set(func.__name__, result, *args, **kwargs)
        return result
    return wrapper


def clear_cache() -> None:
    _CACHE.clear()