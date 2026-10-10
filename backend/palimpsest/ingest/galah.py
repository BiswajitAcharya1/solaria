"""Step 5: GALAH DR4 (Buder et al. 2025) cross-survey abundances.

GALAH is an independent optical survey (HERMES, R~28,000) with a different
line list, pipeline and calibration from APOGEE (H-band, R~22,500).  We do
*not* merge the two abundance scales.  Instead, for stars observed by both
surveys we (1) measure the APOGEE-GALAH offset and scatter per element, and
(2) keep GALAH abundances as an independent check of chemical homogeneity for
candidate groups.

Quality cuts follow the GALAH DR4 best-practice guidance:
flag_sp == 0, flag_sp_fit == 0, flag_red == 0, flag_fe_h == 0, and
for element X: flag_x_fe == 0 and snr_px_ccd3 > 30.
"""
from __future__ import annotations

import json

import numpy as np
import pandas as pd
from astropy.io import fits

from .. import config as C

PAIRS = {  # APOGEE column -> GALAH column
    "FE_H": "fe_h", "MG_FE": "mg_fe", "SI_FE": "si_fe", "CA_FE": "ca_fe", "AL_FE": "al_fe",
    "MN_FE": "mn_fe", "NI_FE": "ni_fe", "O_FE": "o_fe", "K_FE": "k_fe", "CR_FE": "cr_fe",
}


def main() -> None:
    d = fits.getdata(C.GALAH_DR4, 1)
    sid = np.asarray(d["gaiadr3_source_id"]).astype(np.int64)
    stars = pd.read_parquet(C.STARS_PARQUET, columns=["source_id"] + list(PAIRS) + [k + "_ERR" for k in PAIRS])
    sel = np.isin(sid, stars["source_id"].to_numpy())
    good = (d["flag_sp"] == 0) & (d["flag_sp_fit"] == 0) & (d["flag_red"] == 0) & (d["flag_fe_h"] == 0)
    idx = np.where(sel & good)[0]
    snr_ok = np.asarray(d["snr_px_ccd3"][idx]) > 30
    out = {"source_id": sid[idx], "galah_sobject_id": np.asarray(d["sobject_id"][idx]).astype(np.int64),
           "galah_teff": np.asarray(d["teff"][idx], float), "galah_logg": np.asarray(d["logg"][idx], float),
           "galah_age": np.asarray(d["age"][idx], float)}
    for ap, ga in PAIRS.items():
        v = np.asarray(d[ga][idx], float)
        e = np.asarray(d["e_" + ga][idx], float)
        flag = np.asarray(d["flag_" + ga][idx]) if ga != "fe_h" else np.zeros(idx.size, int)
        bad = (flag != 0) | ~snr_ok | ~np.isfinite(v) | ~np.isfinite(e)
        v[bad] = np.nan
        e[bad] = np.nan
        out["galah_" + ap] = v
        out["galah_" + ap + "_ERR"] = e
    g = pd.DataFrame(out).drop_duplicates("source_id")
    g.to_parquet(C.GALAH_PARQUET, index=False)

    # cross-survey offsets
    m = stars.merge(g, on="source_id")
    offsets = {}
    for ap in PAIRS:
        diff = (m[ap] - m["galah_" + ap]).to_numpy()
        diff = diff[np.isfinite(diff)]
        if diff.size < 20:
            continue
        med = float(np.median(diff))
        mad = float(1.4826 * np.median(np.abs(diff - med)))
        offsets[ap] = {"n": int(diff.size), "median_apogee_minus_galah": med, "robust_scatter": mad}
    meta = {"n_matched": int(len(g)), "offsets": offsets,
            "note": "Offsets are reported, not applied: the surveys are kept on their own scales."}
    (C.CACHE / "galah_cross_survey.json").write_text(json.dumps(meta, indent=1))
    print(f"GALAH DR4: {len(g)} stars in common with the APOGEE analysis sample")
    for k, v in offsets.items():
        print(f"  {k:6s} n={v['n']:6d}  APOGEE-GALAH median={v['median_apogee_minus_galah']:+.3f}  scatter={v['robust_scatter']:.3f}")


if __name__ == "__main__":
    main()
