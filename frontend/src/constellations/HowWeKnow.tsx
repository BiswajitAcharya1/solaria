// "how do we know?" as pictures: the measurement pipeline, a parallax animation, and the
// evidence chart for the current constellation (every star pair: separation vs speed difference).
import { useMemo, useState } from 'react'
import { type Kinship, type Star, LY_PER_PC, VERDICT_COLORS, pairInfo } from './data'
import './howweknow.css'

const SEP_LIMIT_LY = 50 * LY_PER_PC // 163 ly, same rule as physics.ts / the backend

export default function HowWeKnow({ name, stars, kin, sources, skySource, onClose }: {
  name: string; stars: Star[]; kin: Kinship; sources: Record<string, string>; skySource: string; onClose: () => void
}) {
  const pairs = useMemo(() => {
    const out: { a: Star; b: Star; sepLy: number; dv: number; dvErr: number; status: string }[] = []
    for (let i = 0; i < stars.length; i++) for (let j = i + 1; j < stars.length; j++) {
      const p = pairInfo(stars[i], stars[j])
      out.push({ a: stars[i], b: stars[j], sepLy: p.sep * LY_PER_PC, dv: p.dv, dvErr: p.dvErr, status: p.status })
    }
    return out
  }, [stars])
  const n = {
    stars: stars.length,
    plx: stars.filter(s => s.distReliable).length,
    rv: stars.filter(s => s.hasRv).length,
    pairs: pairs.length,
    co: pairs.filter(p => p.status === 'comoving').length,
    no: pairs.filter(p => p.status === 'not comoving').length,
    un: pairs.filter(p => p.status === 'undetermined').length,
  }

  return (
    <div className="hw-wrap" onClick={onClose}>
      <div className="hw" onClick={e => e.stopPropagation()} role="dialog" aria-label="how do we know">
        <button className="hw-x" onClick={onClose} aria-label="close">×</button>
        <header>
          <h2>how do we know?</h2>
          <p>from raw measurements to a verdict for <b>{name}</b>, step by step.</p>
        </header>

        <section className="hw-row">
          <Pipeline n={n} kin={kin} />
        </section>

        <section className="hw-grid">
          <figure className="hw-card">
            <figcaption><b>1 · distance from parallax</b><span>as earth circles the sun, a nearby star shifts against far-away ones. a smaller shift means a farther star: d = 1 / parallax.</span></figcaption>
            <Parallax />
          </figure>
          <figure className="hw-card wide">
            <figcaption><b>2 · the evidence for {name}</b><span>each dot is one pair of its stars. pairs inside the green zone sit close together <i>and</i> move alike: they count as family. hollow dots are pairs whose speeds are too uncertain to decide.</span></figcaption>
            <Evidence pairs={pairs} />
          </figure>
        </section>

        <footer>
          <p>the sky: {skySource.toLowerCase()}. colours from each star’s measured b−v. the milky way glow is an illustration.</p>
          <p>{Object.values(sources).join(' · ').toLowerCase()}. bright-star radial velocities are partly a literature compilation (xhip): treat single verdicts as indicative.</p>
        </footer>
      </div>
    </div>
  )
}

/** Measurements -> derived quantities -> pair test -> outcome, with this constellation's counts. */
function Pipeline({ n, kin }: { n: Record<string, number>; kin: Kinship }) {
  const W = 980, H = 210
  const node = (x: number, y: number, w: number, title: string, sub: string, tone = '#8fd0ff', delay = 0) => (
    <g className="hw-node" style={{ animationDelay: `${delay}ms` }}>
      <rect x={x} y={y} width={w} height={54} rx={27} fill="rgba(12,18,38,0.9)" stroke={tone} strokeOpacity="0.55" />
      <text x={x + w / 2} y={y + 23} textAnchor="middle" className="hw-nt">{title}</text>
      <text x={x + w / 2} y={y + 40} textAnchor="middle" className="hw-ns">{sub}</text>
    </g>
  )
  const flow = (d: string, tone = '#8fd0ff', delay = 0) => (
    <>
      <path d={d} className="hw-edge" stroke={tone} />
      <path d={d} className="hw-flow" stroke={tone} style={{ animationDelay: `${delay}ms` }} />
    </>
  )
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="hw-pipe" aria-label="measurement pipeline">
      {flow('M 160 40 C 200 40 210 40 250 40')}
      {flow('M 160 112 C 200 112 210 112 250 112')}
      {flow('M 160 184 C 200 184 210 140 250 130')}
      {flow('M 410 40 C 470 40 470 100 520 100', '#8fd0ff', 300)}
      {flow('M 410 121 C 470 121 470 100 520 100', '#8fd0ff', 300)}
      {flow('M 720 100 C 770 100 770 40 810 40', VERDICT_COLORS.family, 600)}
      {flow('M 720 100 C 770 100 770 104 810 104', VERDICT_COLORS.illusion, 600)}
      {flow('M 720 100 C 770 100 770 168 810 168', '#9aa6c4', 600)}
      {node(10, 13, 150, 'parallax', `${n.plx} of ${n.stars} reliable`, '#8fd0ff', 0)}
      {node(10, 85, 150, 'proper motion', `${n.stars} stars`, '#8fd0ff', 60)}
      {node(10, 157, 150, 'radial velocity', `${n.rv} of ${n.stars} measured`, '#8fd0ff', 120)}
      {node(250, 13, 160, 'distance', `${Math.round(kin.nearest.dist * LY_PER_PC)}–${Math.round(kin.farthest.dist * LY_PER_PC).toLocaleString()} ly`, '#c3a6ff', 200)}
      {node(250, 94, 160, '3d velocity', 'km/s through space', '#c3a6ff', 260)}
      <g className="hw-node" style={{ animationDelay: '380ms' }}>
        <rect x={520} y={46} width={200} height={108} rx={30} fill="rgba(12,18,38,0.95)" stroke="#ffc95c" strokeOpacity="0.6" />
        <text x={620} y={70} textAnchor="middle" className="hw-nt">pair test · {n.pairs} pairs</text>
        <text x={620} y={92} textAnchor="middle" className="hw-ns">closer than 163 ly?</text>
        <text x={620} y={110} textAnchor="middle" className="hw-ns">speed gap known to ±3 km/s?</text>
        <text x={620} y={128} textAnchor="middle" className="hw-ns">gap &lt; 3 km/s (or 2σ)?</text>
      </g>
      {node(810, 13, 160, 'family', `${n.co} pairs → ${kin.nKin} stars`, VERDICT_COLORS.family, 560)}
      {node(810, 77, 160, 'not related', `${n.no} pairs`, VERDICT_COLORS.illusion, 620)}
      {node(810, 141, 160, 'can’t tell yet', `${n.un} pairs`, '#9aa6c4', 680)}
    </svg>
  )
}

function Parallax() {
  return (
    <svg viewBox="0 0 300 200" className="hw-plx" aria-label="parallax diagram">
      <defs>
        <radialGradient id="hw-sun"><stop offset="0" stopColor="#fff6d8" /><stop offset="0.45" stopColor="#ffc95c" /><stop offset="1" stopColor="#ffc95c" stopOpacity="0" /></radialGradient>
      </defs>
      {[[250, 20], [280, 70], [230, 30], [270, 120], [200, 15]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r="1.4" fill="rgba(220,230,255,0.6)" />)}
      <ellipse cx="80" cy="150" rx="60" ry="22" fill="none" stroke="rgba(143,208,255,0.35)" strokeDasharray="3 4" />
      <circle cx="80" cy="150" r="16" fill="url(#hw-sun)" />
      <g className="hw-earth"><circle r="5" fill="#4aa3ff" /></g>
      <g className="hw-sight">
        <line x1="0" y1="0" x2="160" y2="-110" stroke="rgba(255,255,255,0.35)" strokeDasharray="2 3" />
      </g>
      <g className="hw-wob"><circle cx="210" cy="55" r="4.5" fill="#fff" /><circle cx="210" cy="55" r="11" fill="rgba(255,255,255,0.12)" /></g>
      <text x="80" y="190" textAnchor="middle" className="hw-ns">earth’s orbit (1 year)</text>
      <text x="210" y="80" textAnchor="middle" className="hw-ns">apparent shift</text>
    </svg>
  )
}

/** Separation (ly, log) vs |Δv| (km/s, log) for every pair, family zone shaded. */
function Evidence({ pairs }: { pairs: { a: Star; b: Star; sepLy: number; dv: number; dvErr: number; status: string }[] }) {
  const [hov, setHov] = useState<number | null>(null)
  const W = 560, H = 260, L = 46, B = 34, T = 10, R = 12
  const xMin = 3, xMax = Math.max(400, ...pairs.map(p => p.sepLy)) * 1.15
  const yMin = 0.3, yMax = 150
  const x = (v: number) => L + (Math.log(Math.max(xMin, v) / xMin) / Math.log(xMax / xMin)) * (W - L - R)
  const y = (v: number) => T + (1 - Math.log(Math.max(yMin, Math.min(yMax, v)) / yMin) / Math.log(yMax / yMin)) * (H - T - B)
  const xt = [10, 30, 100, 300, 1000, 3000].filter(v => v < xMax)
  const yt = [0.3, 1, 3, 10, 30, 100]
  const col = (s: string) => (s === 'comoving' ? VERDICT_COLORS.family : s === 'undetermined' ? '#9aa6c4' : VERDICT_COLORS.illusion)
  const h = hov !== null ? pairs[hov] : null
  return (
    <div className="hw-ev">
      <svg viewBox={`0 0 ${W} ${H}`} aria-label="evidence chart">
        <rect x={x(xMin)} y={y(3)} width={x(SEP_LIMIT_LY) - x(xMin)} height={y(yMin) - y(3)} rx="10" className="hw-zone" />
        <text x={x(xMin) + 8} y={y(3) + 16} className="hw-zone-t">family zone</text>
        <line x1={x(SEP_LIMIT_LY)} x2={x(SEP_LIMIT_LY)} y1={T} y2={H - B} className="hw-lim" />
        <line x1={L} x2={W - R} y1={y(3)} y2={y(3)} className="hw-lim" />
        <text x={x(SEP_LIMIT_LY) + 4} y={T + 10} className="hw-tick">163 ly</text>
        <text x={W - R} y={y(3) - 4} textAnchor="end" className="hw-tick">3 km/s</text>
        {xt.map(v => <g key={v}><line x1={x(v)} x2={x(v)} y1={T} y2={H - B} className="hw-grid" /><text x={x(v)} y={H - B + 14} textAnchor="middle" className="hw-tick">{v.toLocaleString()}</text></g>)}
        {yt.map(v => <g key={v}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="hw-grid" /><text x={L - 6} y={y(v) + 3} textAnchor="end" className="hw-tick">{v}</text></g>)}
        <text x={(L + W) / 2} y={H - 4} textAnchor="middle" className="hw-axis">how far apart the two stars are (light-years)</text>
        <text x={12} y={(H - B) / 2} textAnchor="middle" className="hw-axis" transform={`rotate(-90 12 ${(H - B) / 2})`}>difference in speed (km/s)</text>
        {pairs.map((p, i) => {
          const c = col(p.status)
          const hollow = p.status === 'undetermined'
          return (
            <g key={i} className="hw-pt" style={{ animationDelay: `${Math.min(i, 120) * 6}ms` }} onMouseEnter={() => setHov(i)} onMouseLeave={() => setHov(null)}>
              {hollow && <line x1={x(p.sepLy)} x2={x(p.sepLy)} y1={y(Math.max(yMin, p.dv - p.dvErr))} y2={y(p.dv + p.dvErr)} stroke={c} strokeOpacity="0.35" />}
              <circle cx={x(p.sepLy)} cy={y(p.dv)} r={hov === i ? 6 : 3.6} fill={hollow ? 'none' : c} stroke={c} strokeWidth="1.3" fillOpacity="0.85" />
            </g>
          )
        })}
      </svg>
      <p className="hw-read">
        {h ? <>{h.a.label.toLowerCase()} ↔ {h.b.label.toLowerCase()}: {Math.round(h.sepLy).toLocaleString()} ly apart, speed gap {h.dv.toFixed(1)} ± {h.dvErr.toFixed(1)} km/s → <b style={{ color: col(h.status) }}>{h.status === 'comoving' ? 'family' : h.status === 'undetermined' ? 'can’t tell' : 'not related'}</b></>
          : 'hover a dot to see the pair.'}
      </p>
    </div>
  )
}
