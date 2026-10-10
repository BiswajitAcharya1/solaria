import { useEffect, useRef, useState } from 'react'
import GalaxyView from '../three/GalaxyView'
import { useApp } from '../store'
import { COLOR_FIELDS, gradientCSS } from '../three/colormap'
import { getJSON, fmt } from '../api'
import StarPanel from './StarPanel'

export default function Atlas() {
  const { points, colorBy, setColorBy, select, selected, orbits, time, setTime, group, setGroup, activePotential, setActivePotential } = useApp()
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<any[]>([])
  const [playing, setPlaying] = useState(false)
  const raf = useRef(0)
  const f = COLOR_FIELDS[colorBy]
  const run = orbits?.runs[activePotential]
  const tmin = run ? run.times_myr[run.times_myr.length - 1] : 0

  const onPick = async (i: number) => {
    const r = await getJSON(`/api/index/${i}`)
    select(r.source_id)
  }

  useEffect(() => {
    if (!q.trim()) { setHits([]); return }
    const h = setTimeout(() => getJSON(`/api/search?q=${encodeURIComponent(q)}`).then(setHits).catch(() => setHits([])), 250)
    return () => clearTimeout(h)
  }, [q])

  useEffect(() => {
    if (!playing || !run) return
    let last = performance.now()
    let t = time
    const step = (now: number) => {
      const dt = (now - last) / 1000; last = now
      t = t - dt * Math.abs(tmin) / 8   // 8 s to sweep the full interval
      if (t <= tmin) { t = tmin; setPlaying(false) }
      setTime(t)
      if (t > tmin) raf.current = requestAnimationFrame(step)
    }
    raf.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing])

  return (
    <div className="atlas">
      <div className="viewport">
        <GalaxyView onPick={onPick} />
        <div className="hud">
          <div className="card">
            <div className="row" style={{ marginBottom: 6 }}>
              <strong>Atlas</strong>
              <span className="tag measured">real data</span>
              <span className="muted small">{points ? points.n.toLocaleString() : '…'} APOGEE DR17 × Gaia DR3 stars</span>
            </div>
            <input type="text" placeholder="Search Gaia DR3 source_id, APOGEE ID or cluster (e.g. M67)" value={q}
                   onChange={e => setQ(e.target.value)} style={{ width: '100%' }} />
            {hits.length > 0 && (
              <div className="scroll" style={{ maxHeight: 200, marginTop: 6 }}>
                <table className="t"><tbody>
                  {hits.map(h => (
                    <tr key={h.source_id} className="click" onClick={() => { select(h.source_id); setQ('') }}>
                      <td className="mono">{h.source_id}</td><td>{h.cluster || h.apogee_id}</td><td className="num">{fmt(h.dist_pc, 0)} pc</td>
                    </tr>))}
                </tbody></table>
              </div>
            )}
          </div>
          <div className="card small">
            <div className="row">
              <span className="dim">Colour by</span>
              <select value={colorBy} onChange={e => setColorBy(e.target.value)}>
                {Object.entries(COLOR_FIELDS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
            <div className="legend-bar" style={{ background: gradientCSS(f.cmap) }} />
            <div className="row"><span className="muted">{f.min}</span><span className="spacer" /><span className={`tag ${f.kind}`}>{f.kind}</span><span className="spacer" /><span className="muted">{f.max}</span></div>
            <div className="muted" style={{ marginTop: 6 }}>Heliocentric Galactic frame; click any star to open its dossier. Drag to rotate, scroll to zoom.</div>
          </div>
          {group && (
            <div className="card small">
              <div className="row"><span className="tag hypo">group</span><strong>{group.name}</strong><span className="muted">{group.ids.length} stars</span>
                <span className="spacer" /><button className="btn ghost small" onClick={() => setGroup(null)}>clear</button></div>
            </div>
          )}
        </div>
        {run && (
          <div className="timebar">
            <button className="btn small" onClick={() => { if (time <= tmin) setTime(0); setPlaying(!playing) }}>{playing ? 'Pause' : 'Play'}</button>
            <span className="mono" style={{ width: 110 }}>t = {time.toFixed(1)} Myr</span>
            <input type="range" min={tmin} max={0} step={0.1} value={time} onChange={e => { setPlaying(false); setTime(Number(e.target.value)) }} />
            <select value={activePotential} onChange={e => setActivePotential(e.target.value)}>
              {Object.keys(orbits!.runs).map(p => <option key={p}>{p}</option>)}
            </select>
            <span className="tag inferred" title="Computed trajectories through a model Galactic potential">model-dependent</span>
            <span className="muted small" style={{ maxWidth: 230 }}>Only investigated stars move; background shows present-day positions. Frame co-rotates with the Sun's orbit.</span>
          </div>
        )}
      </div>
      <div className="side">
        {selected ? <StarPanel key={selected} id={selected} /> : <Welcome />}
      </div>
    </div>
  )
}

function Welcome() {
  const { select, setView } = useApp()
  return (
    <div className="grid">
      <div className="card">
        <h3>Investigate a star</h3>
        <p className="dim small">Click a star in the 3D view or search for one. Each star opens a dossier that separates
          <span className="tag measured" style={{ margin: '0 4px' }}>measured</span>observations,
          <span className="tag inferred" style={{ margin: '0 4px' }}>inferred</span>model-dependent quantities and
          <span className="tag hypo" style={{ margin: '0 4px' }}>hypotheses</span>.</p>
        <h4>Suggested starting points</h4>
        <div className="pill-list">
          <span className="pill" onClick={() => setView('families')}>Evaluate known open clusters (M67, NGC 6791 …)</span>
          <span className="pill" onClick={() => setView('constellations')}>What does the Big Dipper hide?</span>
          <span className="pill" onClick={() => setView('merger')}>Gaia–Enceladus merger debris test</span>
          <span className="pill" onClick={() => setView('anomalies')}>Anomaly scan</span>
        </div>
        <ExampleStar onPick={select} />
      </div>
    </div>
  )
}

function ExampleStar({ onPick }: { onPick: (id: string) => void }) {
  const [p, setP] = useState<any[]>([])
  useEffect(() => { getJSON('/api/presets').then(setP).catch(() => {}) }, [])
  const m67 = p.find(x => x.name === 'M67') || p[0]
  if (!m67) return null
  return <p className="small dim" style={{ marginTop: 12 }}>Or open a member of <b>{m67.name}</b>:{' '}
    <a href="#" onClick={e => { e.preventDefault(); onPick(m67.source_ids[0]) }} className="mono">{m67.source_ids[0]}</a></p>
}
