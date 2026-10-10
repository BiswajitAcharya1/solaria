import { useEffect, useMemo, useState } from 'react'
import { getJSON, fmt } from '../api'
import { useApp } from '../store'
import Plot from '../components/Plot'

export default function Merger() {
  const { points } = useApp()
  const [m, setM] = useState<any>(null)
  useEffect(() => { getJSON('/api/merger').then(setM) }, [])

  const plots = useMemo(() => {
    if (!points) return null
    const Lz = points.col('Lz'), JR = points.col('J_R'), feh = points.col('FE_H'), mg = points.col('MG_FE'), al = points.col('AL_FE'), mn = points.col('MN_FE')
    // subsample disc stars for readability; keep all halo-like stars
    const a: number[][] = [[], [], [], [], [], []]
    for (let i = 0; i < points.n; i++) {
      const sj = Math.sqrt(Math.max(0, JR[i]))
      const halo = sj > 15 || Math.abs(Lz[i]) < 1200
      if (!halo && i % 12 !== 0) continue
      const kin = Math.abs(Lz[i]) <= 500 && sj >= 30 && sj <= 55
      a[0].push(Lz[i]); a[1].push(sj); a[2].push(kin ? 1 : 0); a[3].push(al[i]); a[4].push(mg[i] - mn[i]); a[5].push(feh[i])
    }
    const idx = a[0].map((_, i) => i)
    const sel = idx.filter(i => a[2][i] === 1), rest = idx.filter(i => a[2][i] === 0)
    const pick = (ix: number[], k: number) => ix.map(i => a[k][i])
    const action = [
      { x: pick(rest, 0), y: pick(rest, 1), mode: 'markers', type: 'scattergl', name: 'other stars (disc subsampled)', marker: { size: 2, color: pick(rest, 5), colorscale: 'Plasma', cmin: -2, cmax: 0.4, opacity: 0.5 } },
      { x: pick(sel, 0), y: pick(sel, 1), mode: 'markers', type: 'scattergl', name: 'GSE kinematic selection', marker: { size: 3, color: '#ff9fd0' } },
    ]
    const chem = [
      { x: pick(rest, 3), y: pick(rest, 4), mode: 'markers', type: 'scattergl', name: 'not kinematically selected', marker: { size: 2, color: '#3a4766', opacity: 0.5 } },
      { x: pick(sel, 3), y: pick(sel, 4), mode: 'markers', type: 'scattergl', name: 'GSE kinematic selection', marker: { size: 4, color: '#ff9fd0' } },
    ]
    return { action, chem, nsel: sel.length }
  }, [points])

  return (
    <div className="page">
      <h2>Ancient merger debris: Gaia–Sausage/Enceladus</h2>
      <p className="lede">About 8–11 Gyr ago a dwarf galaxy merged with the Milky Way. Its stars should share (1) highly radial orbits and (2) the chemistry of a low-mass galaxy. Here the two are tested <b>independently</b>: stars are selected by dynamics only, and their chemistry is then compared with control populations.</p>
      {m && <div className="grid g3">
        <div className="card"><h3>Kinematic selection</h3><p className="small dim">{m.criteria.kinematic}</p><div style={{ fontSize: 28, fontWeight: 600 }}>{m.n_kinematic_gse.toLocaleString()}</div><p className="small muted">stars with measured Al, Mg, Mn, Fe</p></div>
        <div className="card"><h3>Accreted-like chemistry</h3><p className="small dim">{m.criteria.chemical}</p>
          <table className="t"><tbody>
            <tr><td>GSE kinematic selection</td><td className="num"><b>{fmt(100 * m.accreted_chem_fraction.gse_kinematic, 1)}%</b></td></tr>
            <tr><td>Other eccentric halo stars (n={m.n_controls.other_eccentric_halo})</td><td className="num">{fmt(100 * m.accreted_chem_fraction.other_eccentric_halo, 1)}%</td></tr>
            <tr><td>Metal-poor cold-disc control (n={m.n_controls.metal_poor_cold_disc})</td><td className="num">{fmt(100 * m.accreted_chem_fraction.metal_poor_cold_disc, 1)}%</td></tr>
          </tbody></table></div>
        <div className="card"><h3>Interpretation</h3><p className="small dim">{m.interpretation}</p>
          <div className="note" style={{ marginTop: 8 }}>This tests consistency with a known merger; it does not reconstruct the merger's mass, timing or orbit, which requires population-level modelling. Individual orbits cannot be reversed to the accretion epoch.</div></div>
      </div>}
      {plots && <div className="grid g2" style={{ marginTop: 14 }}>
        <div className="card"><h3>Action space <span className="tag inferred">McMillan17</span></h3>
          <Plot data={plots.action as any} height={420} layout={{ xaxis: { title: { text: 'L_z [kpc km/s]' }, range: [-3000, 3500] }, yaxis: { title: { text: '√J_R [(kpc km/s)^½]' }, range: [0, 60] }, legend: { orientation: 'h', y: -0.2 },
            shapes: [{ type: 'rect', x0: -500, x1: 500, y0: 30, y1: 55, line: { color: '#ff9fd0', dash: 'dash' } }] }} /></div>
        <div className="card"><h3>Chemical plane <span className="tag measured">APOGEE</span></h3>
          <Plot data={plots.chem as any} height={420} layout={{ xaxis: { title: { text: '[Al/Fe]' }, range: [-0.6, 0.6] }, yaxis: { title: { text: '[Mg/Mn]' }, range: [-0.4, 0.8] }, legend: { orientation: 'h', y: -0.2 },
            shapes: [{ type: 'rect', x0: -0.6, x1: -0.075, y0: 0.25, y1: 0.8, line: { color: '#ffcf6e', dash: 'dash' } }] }} />
          <p className="small muted">Dashed box: accreted region (Das et al. 2020; Horta et al. 2021). Selection on the left panel never used these abundances.</p></div>
      </div>}
    </div>
  )
}
