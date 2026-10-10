import { useEffect, useState } from 'react'
import { getJSON, fmt } from '../api'
import { useApp } from '../store'

export default function Anomalies() {
  const [rows, setRows] = useState<any[] | null>(null)
  const [minZ, setMinZ] = useState(6)
  const { select, setView } = useApp()
  useEffect(() => { setRows(null); getJSON(`/api/anomalies?n=60&min_z=${minZ}`).then(setRows) }, [minZ])
  return (
    <div className="page">
      <h2>Anomaly investigation</h2>
      <p className="lede">Stars whose orbits are atypical <i>for their chemistry</i>: each star's eccentricity, z_max, L_z and actions are compared with stars in the same [Fe/H] × [Mg/Fe] bin (robust z-scores). Only stars passing quality checks (RUWE &lt; 1.4, ϖ/σ &gt; 10, no RV variability) are listed. An anomaly score is a pointer for investigation, not a result.</p>
      <div className="row" style={{ marginBottom: 10 }}><label className="f">minimum |z|<input type="number" value={minZ} onChange={e => setMinZ(+e.target.value)} /></label></div>
      <div className="card">
        {!rows ? <span className="spinner" /> : <div className="scroll" style={{ maxHeight: 600 }}><table className="t">
          <thead><tr><th>Gaia DR3 source_id</th><th className="num">max |z|</th><th>driven by</th><th className="num">[Fe/H]</th><th className="num">[Mg/Fe]</th><th className="num">e</th><th className="num">z_max [kpc]</th><th className="num">L_z</th><th></th></tr></thead>
          <tbody>{rows.map(r => <tr key={r.source_id} className="click" onClick={() => { select(r.source_id); setView('atlas') }}>
            <td className="mono">{r.source_id}</td><td className="num">{fmt(r.score, 1)}</td><td>{r.driver}</td><td className="num">{fmt(r.FE_H, 2)}</td><td className="num">{fmt(r.MG_FE, 2)}</td>
            <td className="num">{fmt(r.ecc, 2)}</td><td className="num">{fmt(r.zmax, 2)}</td><td className="num">{fmt(r.Lz, 0)}</td><td><span className="pill">investigate →</span></td></tr>)}</tbody></table></div>}
      </div>
      <p className="small muted" style={{ marginTop: 10 }}>Open a star and see the <b>origin</b> tab for the full explanation: which measurements drive the anomaly, the reference population, data-quality checks (including a Gaia-colour vs APOGEE-Teff cross-match test) and suggested follow-up observations.</p>
    </div>
  )
}
