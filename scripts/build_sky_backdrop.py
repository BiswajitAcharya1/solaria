"""Build the background sky for the solaria constellation view.

Real stars, not decoration: every Hipparcos star (van Leeuwen 2007, VizieR
I/311/hip2) brighter than Hp = 7.5 - roughly the naked-eye sky under a dark site -
with position, parallax, proper motion and B-V colour.  The browser uses them to
draw the sky from Earth and to move them during the time-lapse (tangential motion
only: most of these stars have no radial velocity in the catalogue).

    python scripts/build_sky_backdrop.py

Writes data/cache/sky_backdrop.json and copies it to
frontend/src/constellations/generated/sky_backdrop.json.
"""
from __future__ import annotations

import json
import shutil
from pathlib import Path

import numpy as np
from astroquery.vizier import Vizier

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "cache" / "sky_backdrop.json"
FRONT = ROOT / "frontend" / "src" / "constellations" / "generated" / "sky_backdrop.json"
HP_LIMIT = 7.5


def main() -> None:
    v = Vizier(row_limit=-1, columns=["HIP", "RArad", "DErad", "Plx", "e_Plx", "pmRA", "pmDE", "Hpmag", "B-V"],
               column_filters={"Hpmag": f"<{HP_LIMIT}"})
    t = v.get_catalogs("I/311/hip2")[0]
    ra = np.asarray(t["RArad"], float)   # VizieR serves these in degrees despite the name
    dec = np.asarray(t["DErad"], float)
    plx = np.asarray(t["Plx"].filled(np.nan) if hasattr(t["Plx"], "filled") else t["Plx"], float)
    eplx = np.asarray(t["e_Plx"], float)
    hp = np.asarray(t["Hpmag"], float)
    bv = np.asarray(t["B-V"].filled(np.nan) if hasattr(t["B-V"], "filled") else t["B-V"], float)
    ok = np.isfinite(ra) & np.isfinite(dec) & np.isfinite(hp)
    # parallaxes with < 3 sigma significance give no usable distance: flag with 0
    good_plx = np.isfinite(plx) & (plx > 0) & (plx > 3 * eplx)
    rows = {
        "hip": np.asarray(t["HIP"], int)[ok].tolist(),
        "ra": np.round(ra[ok], 4).tolist(),
        "dec": np.round(dec[ok], 4).tolist(),
        "plx": np.round(np.where(good_plx, plx, 0.0)[ok], 3).tolist(),
        "pmra": np.round(np.nan_to_num(np.asarray(t["pmRA"], float))[ok], 2).tolist(),
        "pmdec": np.round(np.nan_to_num(np.asarray(t["pmDE"], float))[ok], 2).tolist(),
        "mag": np.round(hp[ok], 2).tolist(),
        "bv": np.round(np.where(np.isfinite(bv), bv, 0.6)[ok], 2).tolist(),
    }
    meta = {"source": "Hipparcos new reduction (van Leeuwen 2007, VizieR I/311/hip2)",
            "selection": f"Hp < {HP_LIMIT}", "n": len(rows["hip"]),
            "notes": "plx = 0 where parallax < 3 sigma (distance unknown); magnitudes are Hipparcos Hp"}
    OUT.write_text(json.dumps({"meta": meta, **rows}, separators=(",", ":")))
    FRONT.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(OUT, FRONT)
    print(f"sky backdrop: {meta['n']} stars -> {OUT} ({OUT.stat().st_size / 1e6:.2f} MB)")


if __name__ == "__main__":
    main()
