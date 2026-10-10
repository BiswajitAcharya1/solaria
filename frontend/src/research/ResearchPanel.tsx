// Research panels for solaria: the measurements behind each verdict, with units, errors and method.
// Self-contained: give it the figure's stars and kinship result; it only reads ../constellations/data.
//   <ResearchPanel name="ursa major" stars={figStars} kin={kin} focus={focus} onFocus={setFocus} sources={cat.sources} />
//   <StatusBar nStars={cat.all.length} nFigures={cat.figures.length} unfold={unfold} tMyr={tMyr} />
import { useMemo, useState } from 'react'
import { type Kinship, type Star, KIN_COLORS, LY_PER_PC, VERDICT_COLORS, bvColor, pairInfo } from '../constellations/data'
import './research.css'

type Tab = 'overview' | 'kinematics' | 'members' | 'method'
const VERDICT_WORD = { family: 'co-moving family', mixed: 'partly co-moving', illusion: 'chance alignment' }
const fmtLy = (pc: number) => Math.round(pc * LY_PER_PC).toLocaleString()

export default function ResearchPanel({ name, stars, kin, focus, onFocus, sources }: {
  name: string; stars: Star[]; kin: Kinship; focus: number | null; onFocus: (h: number | null) => void
  sources: Record<string, string>
}) {
  const [tab, setTab] = useState<Tab>('overview')
  const stats = useMemo(() => {
    let maxGroupDv = 0
    for (const g of kin.groups) for (const a of g) for (const b of g) {
      const sa = stars.find(s => s.hip === a), sb = stars.find(s => s.hip === b)
      if (sa && sb && a < b) maxGroupDv = Math.max(maxGroupDv, pairInfo(sa, sb).dv)
    }
    const medErr = [...stars.map(s => s.distErr / s.dist)].sort((a, b) => a - b)[Math.floor(stars.length / 2)]
    return { maxGroupDv, medErr }
  }, [stars, kin])

  return (
    <aside className="rx-panel" aria-label="analysis">
      <header className="rx-head">
        <div>
          <span className="rx-kicker">target</span>
          <h2>{name}</h2>
        </div>
        <span className="rx-chip" style={{ color: VERDICT_COLORS[kin.verdict], borderColor: VERDICT_COLORS[kin.verdict] }}>
          {VERDICT_WORD[kin.verdict]}
        </span>
      </header>

      <nav className="rx-tabs" role="tablist">
        {(['overview', 'kinematics', 'members', 'method'] as Tab[]).map(t => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t}</button>
        ))}
      </nav>

      <div className="rx-body" key={tab}>
        {tab === 'overview' && (
          <>
            <div className="rx-metrics">
              <Metric k="stars in figure" v={String(kin.n)} />
              <Metric k="co-moving" v={`${kin.nKin} / ${kin.n}`} tone={VERDICT_COLORS[kin.verdict]} />
              <Metric k="nearest" v={`${fmtLy(kin.nearest.dist)} ly`} sub={kin.nearest.label} />
              <Metric k="farthest" v={`${fmtLy(kin.farthest.dist)} ly`} sub={kin.farthest.label} />
              <Metric k="depth ratio" v={`${kin.depthRatio.toFixed(1)}×`} sub="farthest ÷ nearest" />
              <Metric k="max Δv in group" v={kin.groups.length ? `${stats.maxGroupDv.toFixed(1)} km/s` : '—'} />
              <Metric k="groups found" v={String(kin.groups.length)} />
              <Metric k="median σd / d" v={`${(stats.medErr * 100).toFixed(1)} %`} sub="distance precision" />
            </div>
            <Figure title="distance from earth" caption="each dot is a star at its measured distance; bars show ±1σ. co-moving stars are ringed in their group colour.">
              <DistancePlot stars={stars} kin={kin} focus={focus} onFocus={onFocus} />
            </Figure>
          </>
        )}

        {tab === 'kinematics' && (
          <>
            <Figure title="velocity space (u, v)" caption="each star's velocity relative to the sun. u points to the galactic centre, v along galactic rotation. stars born together sit close together here, whatever their position on the sky.">
              <UVPlot stars={stars} kin={kin} focus={focus} onFocus={onFocus} />
            </Figure>
            <Figure title="pairwise velocity difference |Δv|" caption="each cell compares two stars. dark = moving alike. a gold outline means the pair passes the co-moving test (|Δv| < max(3 km/s, 2σ) and < 163 ly apart).">
              <DvMatrix stars={stars} focus={focus} onFocus={onFocus} />
            </Figure>
          </>
        )}

        {tab === 'members' && <Members stars={stars} kin={kin} focus={focus} onFocus={onFocus} />}

        {tab === 'method' && (
          <div className="rx-method">
            <dl>
              <dt>distance</dt><dd>d = 1000 / ϖ (pc), with σd = d · σϖ / ϖ. bright stars use hipparcos-2 parallaxes, where gaia dr3 saturates.</dd>
              <dt>3d velocity</dt><dd>proper motion (μα*, μδ) × 4.74 d plus radial velocity, rotated into galactic (u, v, w). heliocentric; no lsr correction.</dd>
              <dt>co-moving test</dt><dd>|Δv| &lt; max(3 km/s, 2σΔv) and separation &lt; 50 pc, linked into groups transitively. identical to backend/palimpsest/constellations.py.</dd>
              <dt>time evolution</dt><dd>straight-line motion over ±1 myr; galactic accelerations shift positions by &lt; 0.1 pc in that span.</dd>
              <dt>limitations</dt><dd>a shared velocity is necessary, not sufficient, for a shared birth. radial velocities for many bright stars come from the xhip literature compilation and are heterogeneous.</dd>
            </dl>
            <p className="rx-src">{Object.entries(sources).map(([k, v]) => <span key={k}><b>{k.replace(/_/g, ' ')}</b> {v.toLowerCase()}</span>)}</p>
          </div>
        )}
      </div>
    </aside>
  )
}

function Metric({ k, v, sub, tone }: { k: string; v: string; sub?: string; tone?: string }) {
  return (
    <div className="rx-metric">
      <span>{k}</span>
      <b style={tone ? { color: tone } : undefined}>{v}</b>
      {sub && <small>{sub.toLowerCase()}</small>}
    </div>
  )
}

function Figure({ title, caption, children }: { title: string; caption: string; children: React.ReactNode }) {
  return (
    <figure className="rx-fig">
      <figcaption><b>{title}</b></figcaption>
      {children}
      <p>{caption}</p>
    </figure>
  )
}

const W = 300

/** Distance with ±1σ error bars, one row per star, sorted near to far. */
function DistancePlot({ stars, kin, focus, onFocus }: { stars: Star[]; kin: Kinship; focus: number | null; onFocus: (h: number | null) => void }) {
  const sorted = [...stars].sort((a, b) => a.dist - b.dist)
  const max = Math.max(...stars.map(s => s.dist + s.distErr)) * LY_PER_PC
  const L = 74, R = W - 10, row = 13, top = 6
  const H = top + sorted.length * row + 26
  const x = (ly: number) => L + (ly / max) * (R - L)
  const ticks = niceTicks(max)
  return (
    <svg width={W} height={H} className="rx-svg">
      {ticks.map(t => <g key={t}><line x1={x(t)} x2={x(t)} y1={top} y2={H - 22} className="rx-grid" /><text x={x(t)} y={H - 8} textAnchor="middle" className="rx-tick">{t.toLocaleString()}</text></g>)}
      <text x={R} y={H - 8} textAnchor="end" className="rx-tick rx-unit">ly</text>
      {sorted.map((s, i) => {
        const y = top + i * row + row / 2
        const g = kin.groupOf.get(s.hip)
        const d = s.dist * LY_PER_PC, e = s.distErr * LY_PER_PC
        return (
          <g key={s.hip} className={`rx-row ${focus === s.hip ? 'on' : ''}`} onMouseEnter={() => onFocus(s.hip)} onMouseLeave={() => onFocus(null)}>
            <rect x={0} y={y - row / 2} width={W} height={row} className="rx-hit" />
            <text x={L - 8} y={y + 3.5} textAnchor="end" className="rx-label">{s.label.toLowerCase().slice(0, 12)}</text>
            <line x1={x(Math.max(0, d - e))} x2={x(d + e)} y1={y} y2={y} stroke="rgba(170,190,240,0.55)" strokeWidth="1.2" />
            <circle cx={x(d)} cy={y} r={3.2} fill={bvColor(s.bv)} stroke={g !== undefined ? KIN_COLORS[g % KIN_COLORS.length] : 'none'} strokeWidth="1.8" />
          </g>
        )
      })}
    </svg>
  )
}

/** U-V velocity plane (Toomre-style), km/s. */
function UVPlot({ stars, kin, focus, onFocus }: { stars: Star[]; kin: Kinship; focus: number | null; onFocus: (h: number | null) => void }) {
  const H = 230, P = 34
  const us = stars.map(s => s.uvw[0]), vs = stars.map(s => s.uvw[1])
  const span = Math.max(20, ...us.map(Math.abs), ...vs.map(Math.abs)) * 1.1
  const x = (u: number) => P + ((u + span) / (2 * span)) * (W - P - 10)
  const y = (v: number) => 10 + ((span - v) / (2 * span)) * (H - 10 - P)
  const ticks = niceTicks(span).filter(t => t < span)
  return (
    <svg width={W} height={H} className="rx-svg">
      {[0, ...ticks, ...ticks.map(t => -t)].map(t => (
        <g key={t}>
          <line x1={x(t)} x2={x(t)} y1={10} y2={H - P} className={t === 0 ? 'rx-axis' : 'rx-grid'} />
          <line x1={P} x2={W - 10} y1={y(t)} y2={y(t)} className={t === 0 ? 'rx-axis' : 'rx-grid'} />
          <text x={x(t)} y={H - P + 13} textAnchor="middle" className="rx-tick">{t}</text>
          <text x={P - 5} y={y(t) + 3} textAnchor="end" className="rx-tick">{t}</text>
        </g>
      ))}
      <text x={(P + W) / 2} y={H - 4} textAnchor="middle" className="rx-tick rx-unit">u (km/s) → galactic centre</text>
      <text x={9} y={(H - P) / 2} textAnchor="middle" className="rx-tick rx-unit" transform={`rotate(-90 9 ${(H - P) / 2})`}>v (km/s)</text>
      {kin.groups.map((g, i) => {
        const pts = g.map(h => stars.find(s => s.hip === h)!).filter(Boolean)
        const cu = pts.reduce((a, s) => a + s.uvw[0], 0) / pts.length, cv = pts.reduce((a, s) => a + s.uvw[1], 0) / pts.length
        const r = Math.max(10, ...pts.map(s => Math.hypot(x(s.uvw[0]) - x(cu), y(s.uvw[1]) - y(cv)) + 8))
        return <circle key={i} cx={x(cu)} cy={y(cv)} r={r} fill={KIN_COLORS[i % KIN_COLORS.length]} fillOpacity="0.08" stroke={KIN_COLORS[i % KIN_COLORS.length]} strokeDasharray="3 3" strokeOpacity="0.6" />
      })}
      {stars.map(s => {
        const g = kin.groupOf.get(s.hip)
        return (
          <circle key={s.hip} cx={x(s.uvw[0])} cy={y(s.uvw[1])} r={focus === s.hip ? 5.5 : 3.6}
            fill={g !== undefined ? KIN_COLORS[g % KIN_COLORS.length] : 'rgba(200,210,240,0.55)'}
            className="rx-pt" onMouseEnter={() => onFocus(s.hip)} onMouseLeave={() => onFocus(null)}>
            <title>{`${s.label.toLowerCase()}: u ${s.uvw[0].toFixed(1)}, v ${s.uvw[1].toFixed(1)}, w ${s.uvw[2].toFixed(1)} km/s`}</title>
          </circle>
        )
      })}
    </svg>
  )
}

/** n x n heatmap of |Δv|, pairs that pass the co-moving test outlined. */
function DvMatrix({ stars, focus, onFocus }: { stars: Star[]; focus: number | null; onFocus: (h: number | null) => void }) {
  const list = [...stars].sort((a, b) => a.dist - b.dist)
  const n = list.length, L = 6, cell = Math.min(16, (W - L - 10) / n)
  const size = cell * n
  const col = (dv: number) => {
    const t = Math.min(1, dv / 40)
    return `rgb(${Math.round(20 + 200 * t)},${Math.round(30 + 90 * t * (1 - t) * 2)},${Math.round(70 + 60 * (1 - t))})`
  }
  return (
    <div>
      <svg width={W} height={size + 30} className="rx-svg">
        {list.map((a, i) => list.map((b, j) => {
          if (i === j) return <rect key={`${i}-${j}`} x={L + j * cell} y={i * cell} width={cell - 1} height={cell - 1} fill="rgba(255,255,255,0.06)" />
          const p = pairInfo(a, b)
          const hot = focus === a.hip || focus === b.hip
          return (
            <rect key={`${i}-${j}`} x={L + j * cell} y={i * cell} width={cell - 1} height={cell - 1} rx="2" fill={col(p.dv)}
              stroke={p.comoving ? '#ffc95c' : hot ? 'rgba(255,255,255,0.5)' : 'none'} strokeWidth={p.comoving ? 1.4 : 1}
              onMouseEnter={() => onFocus(a.hip)} onMouseLeave={() => onFocus(null)}>
              <title>{`${a.label.toLowerCase()} ↔ ${b.label.toLowerCase()}: |Δv| ${p.dv.toFixed(1)} km/s, ${fmtLy(p.sep)} ly apart`}</title>
            </rect>
          )
        }))}
        <defs><linearGradient id="rx-dv"><stop offset="0" stopColor={col(0)} /><stop offset="0.5" stopColor={col(20)} /><stop offset="1" stopColor={col(40)} /></linearGradient></defs>
        <rect x={L} y={size + 10} width={160} height={7} rx="3.5" fill="url(#rx-dv)" />
        <text x={L} y={size + 28} className="rx-tick">0</text>
        <text x={L + 80} y={size + 28} textAnchor="middle" className="rx-tick">20</text>
        <text x={L + 160} y={size + 28} textAnchor="end" className="rx-tick">40+ km/s</text>
        <rect x={L + 190} y={size + 9} width={9} height={9} rx="2" fill="none" stroke="#ffc95c" strokeWidth="1.4" />
        <text x={L + 204} y={size + 17} className="rx-tick">co-moving</text>
      </svg>
    </div>
  )
}

type SortKey = 'name' | 'dist' | 'speed' | 'group'

function Members({ stars, kin, focus, onFocus }: { stars: Star[]; kin: Kinship; focus: number | null; onFocus: (h: number | null) => void }) {
  const [key, setKey] = useState<SortKey>('dist')
  const [asc, setAsc] = useState(true)
  const val = (s: Star) => key === 'name' ? s.label : key === 'dist' ? s.dist : key === 'speed' ? Math.hypot(...s.vel) : (kin.groupOf.get(s.hip) ?? 99)
  const rows = [...stars].sort((a, b) => {
    const A = val(a), B = val(b)
    const c = typeof A === 'string' ? A.localeCompare(B as string) : (A as number) - (B as number)
    return asc ? c : -c
  })
  const head = (k: SortKey, label: string, cls = '') => (
    <th className={cls}><button onClick={() => { if (k === key) setAsc(!asc); else { setKey(k); setAsc(true) } }}>
      {label}{key === k ? (asc ? ' ↑' : ' ↓') : ''}</button></th>
  )
  return (
    <div className="rx-table-wrap">
      <table className="rx-table">
        <thead><tr>{head('group', '', 'c')}{head('name', 'star')}{head('dist', 'd (ly)', 'n')}<th className="n">±σ</th>{head('speed', 'v (km/s)', 'n')}<th>type</th><th>rv source</th></tr></thead>
        <tbody>
          {rows.map(s => {
            const g = kin.groupOf.get(s.hip)
            return (
              <tr key={s.hip} className={focus === s.hip ? 'on' : ''} onMouseEnter={() => onFocus(s.hip)} onMouseLeave={() => onFocus(null)}>
                <td className="c"><i style={{ background: g !== undefined ? KIN_COLORS[g % KIN_COLORS.length] : 'transparent', borderColor: bvColor(s.bv) }} /></td>
                <td>{s.label.toLowerCase()}</td>
                <td className="n">{fmtLy(s.dist)}</td>
                <td className="n dim">{fmtLy(s.distErr)}</td>
                <td className="n">{Math.hypot(...s.vel).toFixed(1)}</td>
                <td className="dim">{(s.spType ?? '—').toLowerCase()}</td>
                <td className="dim">{s.rvSource.toLowerCase().replace(' compilation', '')}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="rx-note">hover a row to highlight the star in the sky. ±σ is the 1σ distance error from parallax.</p>
    </div>
  )
}

/** Thin instrument status line along the bottom of the screen. */
export function StatusBar({ nStars, nFigures, unfold, tMyr }: { nStars: number; nFigures: number; unfold: number; tMyr: number }) {
  return (
    <footer className="rx-status">
      <span><i className="rx-led" />live</span>
      <span>catalogue hipparcos-2 · gaia dr3 · xhip</span>
      <span>{nStars} stars · {nFigures} iau figures</span>
      <span>criterion |Δv| &lt; max(3 km/s, 2σ) ∧ sep &lt; 50 pc</span>
      <span>view {unfold < 0.5 ? 'geocentric gnomonic' : 'heliocentric 3d'}</span>
      <span>epoch j2016 {tMyr >= 0 ? '+' : '−'} {Math.abs(tMyr).toFixed(2)} myr</span>
    </footer>
  )
}

function niceTicks(max: number) {
  let unit = 1
  while (unit * 10 < max) unit *= 10
  const step = [1, 2, 5].map(k => k * unit).find(v => max / v <= 4) ?? unit * 10
  const out: number[] = []
  for (let v = step; v <= max; v += step) out.push(v)
  return out
}
