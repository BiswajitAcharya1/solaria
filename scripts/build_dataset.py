"""Rebuild the complete Palimpsest dataset from public archives.

    python scripts/build_dataset.py            # download what is missing, then run every step
    python scripts/build_dataset.py --from derive   # re-run from a given step

Steps (each writes to data/cache/):
  download       APOGEE DR17 allStarLite + astroNN + OCCAM VACs, GALAH DR4 allstar,
                 Hunt & Reffert (2023) clusters (VizieR), Stellarium modern constellation lines
  apogee         quality cuts, astroNN ages, OCCAM membership       -> apogee_base.parquet
  gaia           Gaia DR3 astrometry/covariances/RUWE (TAP upload)  -> gaia_dr3.parquet
  derive         zero-point, RUWE cut, XYZ/UVW, actions/orbits      -> stars.parquet
  galah          GALAH DR4 cross-survey abundances and offsets      -> galah_dr4_matched.parquet
  clusters       Hunt & Reffert (2023) catalogue                    -> clusters_hr23.parquet
  constellations Stellarium figures + Hipparcos/Gaia/XHIP           -> constellations.json
  validate       chemical floor calibration + validation            -> chem_calibration.json, validation.json

Raw downloads total ~3.3 GB.  Network access to data.sdss.org, cloud.datacentral.org.au,
gaia.aip.de, vizier.cds.unistra.fr and raw.githubusercontent.com is required.
"""
from __future__ import annotations

import argparse
import importlib
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from palimpsest import config as C  # noqa: E402

DOWNLOADS = {
    C.APOGEE_ALLSTAR: "https://data.sdss.org/sas/dr17/apogee/spectro/aspcap/dr17/synspec_rev1/allStarLite-dr17-synspec_rev1.fits",
    C.APOGEE_ASTRONN: "https://data.sdss.org/sas/dr17/apogee/vac/apogee-astronn/apogee_astroNN-DR17.fits",
    C.OCCAM_MEMBERS: "https://data.sdss.org/sas/dr17/apogee/vac/apogee-occam/occam_member-DR17.fits",
    C.OCCAM_CLUSTERS: "https://data.sdss.org/sas/dr17/apogee/vac/apogee-occam/occam_cluster-DR17.fits",
    C.GALAH_DR4: "https://cloud.datacentral.org.au/teamdata/GALAH/public/GALAH_DR4/catalogs/galah_dr4_allstar_240705.fits",
    C.RAW / "stellarium_modern_index.json": "https://raw.githubusercontent.com/Stellarium/stellarium/master/skycultures/modern/index.json",
}
STEPS = ["download", "apogee", "gaia", "derive", "galah", "clusters", "constellations", "validate"]
MODULES = {"apogee": "palimpsest.ingest.apogee", "gaia": "palimpsest.ingest.gaia",
           "derive": "palimpsest.ingest.derive", "galah": "palimpsest.ingest.galah",
           "clusters": "palimpsest.ingest.clusters", "constellations": "palimpsest.ingest.constellations",
           "validate": "palimpsest.validate"}


def download() -> None:
    C.RAW.mkdir(parents=True, exist_ok=True)
    for path, url in DOWNLOADS.items():
        if path.exists() and path.stat().st_size > 0:
            print(f"  have {path.name}")
            continue
        print(f"  downloading {url}")
        tmp = path.with_suffix(path.suffix + ".part")
        urllib.request.urlretrieve(url, tmp)
        tmp.rename(path)
    hr23 = C.RAW / "hunt_reffert_2023_clusters.fits"
    if not hr23.exists():
        from astroquery.vizier import Vizier
        print("  downloading Hunt & Reffert (2023) clusters from VizieR")
        Vizier(row_limit=-1, columns=["**"]).get_catalogs("J/A+A/673/A114/clusters")[0].write(hr23, overwrite=True)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--from", dest="start", choices=STEPS, default="download")
    args = ap.parse_args()
    C.CACHE.mkdir(parents=True, exist_ok=True)
    for step in STEPS[STEPS.index(args.start):]:
        t0 = time.time()
        print(f"[{step}]", flush=True)
        if step == "download":
            download()
        else:
            importlib.import_module(MODULES[step]).main()
        print(f"[{step}] done in {time.time() - t0:.0f}s", flush=True)


if __name__ == "__main__":
    main()
