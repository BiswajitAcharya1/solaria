import { useEffect, useMemo, useState } from 'react'
import { getJSON, fmt } from '../api'
import Plot, { COLORS } from '../components/Plot'

export default function Constellations() {
  const [list, setList] = useState<any[]>([])
  const [abbr, setAbbr] = useState('UMa')
  const [d, setD] = useState<any>(null)
  const [epoch, setEpoch] = useState(4)  // index into sky_epochs (0 = -1 Myr ... 8 = +1 Myr)
  const [tb, setTb] = useState<any>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { getJSON('/api/constellations').then(setList) }, [])
  useEffect(() => { setD(null); setTb(null); getJSON(`/api/constellations/${abbr}`).then(r => { setD(r); setEpoch(r.sky_epochs.findIndex((e: any) => e.t_kyr === 0)) }) }, [abbr])

  const byHip = useMemo(() => Object.fromEntries((d?.stars || []).map((s: any, i: number) => [s.HIP, { ...s, i }])), [d])
  const groupOf = useMemo(() => {
    const m: Record<number, number> = {}
    d?.comoving_groups.forEach((g: number[], k: number) => g.forEach(h => { m[h] = k }))
    return m
  }, [d])

  const sky = useMemo(() => {
    if (!d) return null
    const e = d.sky_epochs[epoch], e0 = d.sky_epochs.find((x: any) => x.t_kyr === 0)
    const wrap = (ra: number, ref: number) => { let x = ra - ref; while (x > 180) x -= 360; while (x < -180) x += 360; return ref + x }
    const ref = e0.ra[0]
    const traces: any[] = []
    for (const seg of d.lines) {
      const pts = seg.map((h: number) => byHip[h]).filter(Boolean)
      traces.push({ x: pts.map((p: any) => wrap(e.ra[p.i], ref)), y: pts.map((p: any) => e.dec[p.i]), mode: 'lines', line: { color: '#7f9066', width: 1.5 }, hoverinfo: 'skip', showlegend: false })
      if (e.t_kyr !== 0) traces.push({ x: pts.map((p: any) => wrap(e0.ra[p.i], ref)), y: pts.map((p: any) => e0.dec[p.i]), mode: 'lines', line: { color: '#c8bead', width: 1, dash: 'dot' }, hoverinfo: 'skip', showlegend: false })
    }
    traces.push({
      x: d.stars.map((_: any, i: number) => wrap(e.ra[i], ref)), y: d.stars.map((_: any, i: number) => e.dec[i]), mode: 'markers+text',
      text: d.stars.map((s: any) => s.name || `HIP ${s.HIP}`), textposition: 'top center', textfont: { size: 10, color: '#6e6558' },
      marker: { size: d.stars.map((s: any) => Math.max(4, 14 - 2.2 * (s.Vmag ?? s.Hpmag ?? 5))), color: d.stars.map((s: any) => groupOf[s.HIP] !== undefined ? COLORS[(groupOf[s.HIP] + 1) % COLORS.length] : '#4f6a4b'),
        line: { width: 0 } },
      hovertemplate: '%{text}<extra></extra>', showlegend: false,
    })
    return traces
  }, [d, epoch, byHip, groupOf])

  const depth = useMemo(() => {
    if (!d) return null
    return [{
      x: d.stars.map((s: any) => s.name || `HIP ${s.HIP}`), y: d.stars.map((s: any) => s.dist_pc), type: 'bar',
      error_y: { type: 'data', array: d.stars.map((s: any) => s.dist_err_pc), color: '#918778' },
      marker: { color: d.stars.map((s: any) => groupOf[s.HIP] !== undefined ? COLORS[(groupOf[s.HIP] + 1) % COLORS.length] : '#5f7f66') },
    }]
  }, [d, groupOf])

  const vel = useMemo(() => {
    if (!d) return null
    const st = d.stars.filter((s: any) => s.U !== null)
    return [{
      x: st.map((s: any) => s.U), y: st.map((s: any) => s.V), mode: 'markers+text', text: st.map((s: any) => s.name || `HIP ${s.HIP}`),
      textposition: 'top center', textfont: { size: 10 }, error_x: { type: 'data', array: st.map((s: any) => s.v_err / Math.sqrt(3)) },
      error_y: { type: 'data', array: st.map((s: any) => s.v_err / Math.sqrt(3)) },
      marker: { size: 9, color: st.map((s: any) => groupOf[s.HIP] !== undefined ? COLORS[(groupOf[s.HIP] + 1) % COLORS.length] : '#4f6a4b') },
    }]
  }, [d, groupOf])

  const runTb = async () => { setBusy(true); try { setTb(await getJSON(`/api/constellations/${abbr}/traceback?lookback_myr=5`)) } finally { setBusy(false) } }

  return (
    <div className="page">
      <h2>Constellations: apparent patterns vs. real structure</h2>
      <p className="lede">A constellation is a projection. Here each figure is decomposed into true distances, 3D velocities and pairwise relationships, and its shape is propagated through time. Stars that genuinely share a motion are coloured together.</p>
      <div className="row" style={{ marginBottom: 12 }}>
        <select value={abbr} onChange={e => setAbbr(e.target.value)}>
          {list.map(c => <option key={c.abbr} value={c.abbr}>{c.name}{c.english ? ` — ${c.english}` : ''} ({c.n_stars})</option>)}
        </select>
        {d && <span className="dim">{d.summary.n_stars} figure stars · nearest {fmt(d.summary.nearest_pc, 0)} pc · farthest {fmt(d.summary.farthest_pc, 0)} pc ({fmt(d.summary.depth_ratio, 1)}× deeper than it looks flat)</span>}
      </div>
      {!d ? <span className="spinner" /> : <>
        <div className="grid g2">
          <div className="card">
            <h3>Sky figure at t = {d.sky_epochs[epoch].t_kyr > 0 ? '+' : ''}{d.sky_epochs[epoch].t_kyr} kyr <span className="tag inferred">propagated</span></h3>
            <input type="range" min={0} max={d.sky_epochs.length - 1} value={epoch} onChange={e => setEpoch(+e.target.value)} style={{ width: '100%' }} />
            <div className="row small muted"><span>−1 Myr</span><span className="spacer" /><span>today</span><span className="spacer" /><span>+1 Myr</span></div>
            <Plot data={sky as any} height={380} layout={{ xaxis: { title: { text: 'RA [deg]' }, autorange: 'reversed', scaleanchor: 'y' }, yaxis: { title: { text: 'Dec [deg]' } } }} />
            <p className="small muted">Dotted: today's figure. Linear propagation of measured 3D velocities (stars without an RV keep only their proper motion). Over ±1 Myr Galactic accelerations shift stars by &lt;0.1 pc.</p>
          </div>
          <div className="card">
            <h3>True distances <span className="tag measured">parallax</span></h3>
            <Plot data={depth as any} height={260} layout={{ yaxis: { title: { text: 'distance [pc]' } }, margin: { b: 90 } }} />
            <h3 style={{ marginTop: 10 }}>Space velocities (U, V)</h3>
            <Plot data={vel as any} height={260} layout={{ xaxis: { title: { text: 'U [km/s]' } }, yaxis: { title: { text: 'V [km/s]' } } }} />
          </div>
        </div>
        <div className="grid g2" style={{ marginTop: 14 }}>
          <div className="card">
            <h3>Physically related subsets</h3>
            {d.comoving_groups.length === 0 ? <p className="dim">No pair of figure stars shares a 3D velocity within errors and lies within 50 pc of each other: this pattern is a chance alignment of unrelated stars.</p> :
              d.comoving_groups.map((g: number[], k: number) => <div key={k} className="row" style={{ marginBottom: 6 }}>
                <span className="tag" style={{ color: COLORS[(k + 1) % COLORS.length], borderColor: COLORS[(k + 1) % COLORS.length] }}>group {k + 1}</span>
                <span>{g.map(h => byHip[h]?.name || `HIP ${h}`).join(', ')}</span>
                <span className="muted small">{Array.from(new Set(g.map(h => byHip[h]?.GrpName).filter(Boolean))).join('; ') && `literature: ${Array.from(new Set(g.map(h => byHip[h]?.GrpName).filter(Boolean))).join('; ')}`}</span></div>)}
            <p className="small muted">Criterion: |Δv| &lt; max(3 km/s, 2σ) and separation &lt; 50 pc — necessary, not sufficient, for a shared origin. Literature group names come from XHIP and were not used in the test.</p>
            <button className="btn ghost small" onClick={runTb} disabled={busy}>{busy ? 'Integrating…' : 'Trace figure stars back 5 Myr through the Galactic potential'}</button>
            {tb && <Plot height={260} data={tb.stars.map((s: any, k: number) => ({
              x: tb.times_myr, y: s.nominal.map((p: number[]) => Math.hypot(...p)), name: byHip[s.HIP]?.name || `HIP ${s.HIP}`, line: { color: groupOf[s.HIP] !== undefined ? COLORS[(groupOf[s.HIP] + 1) % COLORS.length] : COLORS[k % COLORS.length] } }))}
              layout={{ xaxis: { title: { text: 'time [Myr]' } }, yaxis: { title: { text: 'distance from Sun [pc]' } }, legend: { font: { size: 9 } } }} />}
          </div>
          <div className="card">
            <h3>Stars</h3>
            <div className="scroll" style={{ maxHeight: 420 }}><table className="t">
              <thead><tr><th>Star</th><th className="num">d [pc]</th><th>astrometry</th><th className="num">RV</th><th className="num">[Fe/H]*</th><th className="num">age* [Gyr]</th><th>Sp</th></tr></thead>
              <tbody>{d.stars.map((s: any) => <tr key={s.HIP}><td>{s.name || ''} <span className="muted mono">HIP {s.HIP}</span></td>
                <td className="num">{fmt(s.dist_pc, 0)} ± {fmt(s.dist_err_pc, 0)}</td><td className="small muted">{s.astrometry_source.startsWith('Gaia') ? 'Gaia DR3' : 'Hipparcos'}</td>
                <td className="num" title={s.rv_source}>{fmt(s.rv, 1)}</td><td className="num">{fmt(s.feh_xhip, 2)}</td>
                <td className="num">{s.age_xhip !== null ? fmt(s.age_xhip, 2) : '–'}</td><td className="small">{s.SpType}</td></tr>)}</tbody></table></div>
            <p className="small muted">* [Fe/H] and ages are heterogeneous literature compilations (XHIP, Anderson & Francis 2012), not homogeneous survey measurements; bright stars saturate APOGEE and GALAH.</p>
          </div>
        </div>
        <div className="card" style={{ marginTop: 14 }}><h3>Caveats</h3><ul className="caveats">{d.caveats.map((c: string) => <li key={c}>{c}</li>)}</ul></div>
      </>}
    </div>
  )
}
