"""Pytest configuration and fixtures."""
from __future__ import annotations

import pytest


@pytest.fixture(scope="session")
def rng():
    import numpy as np
    return np.random.default_rng(42)