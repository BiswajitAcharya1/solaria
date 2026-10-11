"""Analysis package: high-level scientific investigations."""
from __future__ import annotations

from .discovery import run_discovery, DiscoveryParams
from .evaluation import evaluate_group
from .siblings import sibling_search
from .encounters import encounter_test
from .constellations import constellation_overview, constellation_detail, constellation_traceback

# Re-export from original analysis module for compatibility
from . import _legacy as _legacy
star_detail = _legacy.star_detail
search = _legacy.search
chemical_neighbours = _legacy.chemical_neighbours
orbit_history = _legacy.orbit_history
anomaly_model = _legacy.anomaly_model
merger_summary = _legacy.merger_summary
provenance = _legacy.provenance

__all__ = [
    "run_discovery", "DiscoveryParams",
    "evaluate_group",
    "sibling_search",
    "encounter_test",
    "constellation_overview", "constellation_detail", "constellation_traceback",
    "star_detail", "search", "chemical_neighbours", "orbit_history",
    "anomaly_model", "merger_summary", "provenance",
]