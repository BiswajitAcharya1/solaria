"""Export the backend's constellation analysis (astropy coordinates, Python co-moving rule)
for every figure, as a fixture for the browser physics tests (frontend/tests).

    python scripts/export_constellation_reference.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from palimpsest import config as C  # noqa: E402
from palimpsest import constellations as K  # noqa: E402

OUT = ROOT / "frontend" / "tests" / "fixtures" / "backend_constellations.json"


def main() -> None:
    data = json.loads(C.CONSTELLATIONS_JSON.read_text())
    out = {}
    for f in data["figures"]:
        try:
            r = K.figure_analysis(data, f["abbr"])
        except KeyError:
            continue
        out[f["abbr"]] = {
            "stars": {str(s["HIP"]): {k: s.get(k) for k in ("dist_pc", "X", "Y", "Z", "U", "V", "W", "v_err",
                                                             "distance_reliable")}
                      for s in r["stars"]},
            "pairs": {f"{p['a']}-{p['b']}": p["status"] for p in r["pairs"]},
            "comoving_groups": r["comoving_groups"],
            "sky_epochs": {str(e["t_kyr"]): {"ra": e["ra"], "dec": e["dec"]} for e in r["sky_epochs"]
                           if e["t_kyr"] in (-1000, 0, 1000)},
            "hips": [s["HIP"] for s in r["stars"]],
        }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out))
    print(f"{len(out)} constellations -> {OUT}")


if __name__ == "__main__":
    main()
