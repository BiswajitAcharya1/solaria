"""Central configuration: paths, physical assumptions and sample-selection constants.

Every number that changes a scientific result lives here so that it can be cited
in exported reports (see ``report.provenance``).
"""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data"
RAW = DATA / "raw"
CACHE = DATA / "cache"

APOGEE_ALLSTAR = RAW / "allStarLite-dr17-synspec_rev1.fits"
APOGEE_ASTRONN = RAW / "apogee_astroNN-DR17.fits"
OCCAM_MEMBERS = RAW / "occam_member-DR17.fits"
OCCAM_CLUSTERS = RAW / "occam_cluster-DR17.fits"
GALAH_DR4 = RAW / "galah_dr4_allstar_240705.fits"

STARS_PARQUET = CACHE / "stars.parquet"          # final analysis table
APOGEE_PARQUET = CACHE / "apogee_base.parquet"   # step 1 output
GAIA_PARQUET = CACHE / "gaia_dr3.parquet"        # step 2 output
CLUSTERS_PARQUET = CACHE / "clusters_hr23.parquet"
CONSTELLATIONS_JSON = CACHE / "constellations.json"
GALAH_PARQUET = CACHE / "galah_dr4_matched.parquet"
CALIBRATION_JSON = CACHE / "chem_calibration.json"
VALIDATION_JSON = CACHE / "validation.json"

# --------------------------------------------------------------------------
# Sample selection (documented in README and every report)
# --------------------------------------------------------------------------
SELECTION = {
    "apogee_snr_min": 70,
    "teff_range_K": (3700.0, 6500.0),
    "exclude_aspcapflag_bits": {"STAR_BAD": 23},
    "exclude_extratarg_bits": {"DUPLICATE": 4},
    "parallax_over_error_min": 5.0,
    "ruwe_max": 1.4,
    "require_gaia_dr3_source_id": True,
}

# APOGEE DR17 elements used for chemical fingerprinting.  C and N are excluded
# because they change on the giant branch (first dredge-up / mixing) and so do
# not trace birth composition; Na, V, Co, Cu, P, Ce have large errors or
# documented problems in DR17 (Holtzman et al. 2018; Jonsson et al. 2020).
CHEM_ELEMENTS = ["FE_H", "MG_FE", "SI_FE", "CA_FE", "AL_FE", "MN_FE", "NI_FE", "O_FE", "K_FE", "CR_FE"]
CHEM_LABELS = {
    "FE_H": "[Fe/H]", "MG_FE": "[Mg/Fe]", "SI_FE": "[Si/Fe]", "CA_FE": "[Ca/Fe]",
    "AL_FE": "[Al/Fe]", "MN_FE": "[Mn/Fe]", "NI_FE": "[Ni/Fe]", "O_FE": "[O/Fe]",
    "K_FE": "[K/Fe]", "CR_FE": "[Cr/Fe]",
}

# --------------------------------------------------------------------------
# Galactic model assumptions
# --------------------------------------------------------------------------
# Solar motion relative to the local standard of rest (Schoenrich, Binney &
# Dehnen 2010).  The Sun's Galactocentric radius and the circular speed are
# taken from each potential's own normalisation so that the solar position is
# self-consistent with the gravitational model being integrated.
SOLAR_MOTION_UVW = (11.1, 12.24, 7.25)  # km/s
SOLAR_Z_KPC = 0.0208                     # Bennett & Bovy (2019)

POTENTIALS = {
    "McMillan17": {
        "label": "McMillan (2017)",
        "reference": "McMillan 2017, MNRAS 465, 76",
        "description": "Bulge, thin+thick stellar discs, HI+H2 gas discs and NFW halo fitted to kinematic data.",
    },
    "MWPotential2014": {
        "label": "MWPotential2014 (Bovy 2015)",
        "reference": "Bovy 2015, ApJS 216, 29",
        "description": "Power-law bulge, Miyamoto-Nagai disc and NFW halo; lighter halo than McMillan17.",
    },
}
DEFAULT_POTENTIAL = "McMillan17"

# Default historical interval for orbit reconstruction.  Beyond a few hundred
# Myr the Galactic potential is time-dependent (bar, spiral arms, GMCs) and
# traceback of individual stars loses meaning.
DEFAULT_LOOKBACK_MYR = 100.0
MAX_LOOKBACK_MYR = 500.0
