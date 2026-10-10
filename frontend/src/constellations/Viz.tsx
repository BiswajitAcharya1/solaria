// Small SVG visualisations: they carry the data so the words don't have to.
import { type Kinship, type Sketch, type Star, KIN_COLORS, LY_PER_PC, VERDICT_COLORS, bvColor, ly } from './data'

const NOW_YEAR = new Date().getFullYear()

/** One slice per star; related stars are lit in their family colour. */
export function KinDonut({ kin, stars, size = 132 }: { kin: Kinship; stars: Star[]; size?: number }) {
  const r = size / 2 - 10, c = size / 2
  const n = stars.length
  const order = [...stars].sort((a, b) => (kin.groupOf.get(a.hip) ?? 99) - (kin.groupOf.get(b.hip) ?? 99))
  const gap = n > 1 ? 0.06 : 0
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="cx-donut" aria-label={`${kin.nKin} of ${n} stars related`}>
      {order.map((s, i) => {
        const a0 = (i / n) * Math.PI * 2 - Math.PI / 2 + gap / 2
        const a1 = ((i + 1) / n) * Math.PI * 2 - Math.PI / 2 - gap / 2
        const g = kin.groupOf.get(s.hip)
        const large = a1 - a0 > Math.PI ? 1 : 0
        return (
          <path key={s.hip} className="cx-donut-seg" style={{ animationDelay: `${i * 40}ms` }}
            d={`M ${c + r * Math.cos(a0)} ${c + r * Math.sin(a0)} A ${r} ${r} 0 ${large} 1 ${c + r * Math.cos(a1)} ${c + r * Math.sin(a1)}`}
            stroke={g !== undefined ? KIN_COLORS[g % KIN_COLORS.length] : 'rgba(170,185,230,0.22)'}
            strokeWidth={g !== undefined ? 12 : 8} fill="none" strokeLinecap="round">
            <title>{s.label.toLowerCase()}</title>
          </path>
        )
      })}
      <text x={c} y={c - 2} textAnchor="middle" className="cx-donut-big">{kin.nKin}<tspan className="cx-donut-of">/{n}</tspan></text>
      <text x={c} y={c + 18} textAnchor="middle" className="cx-donut-small" fill={VERDICT_COLORS[kin.verdict]}>related</text>
    </svg>
  )
}

/** Every star at its true distance from Earth (left); overlapping dots stack up. */
export function DepthSwarm({ stars, kin, focus, onFocus, width = 290 }: {
  stars: Star[]; kin: Kinship; focus: number | null; onFocus: (h: number | null) => void; width?: number
}) {
  const pad = 18, h0 = 64
  const maxPc = Math.max(...stars.map(s => s.dist))
  const x = (pc: number) => pad + (pc / maxPc) * (width - pad * 2)
  const rows: number[][] = []
  const placed = [...stars].sort((a, b) => a.vmag - b.vmag).map(s => {
    const px = x(s.dist)
    let row = 0
    while ((rows[row] ?? []).some(o => Math.abs(o - px) < 11)) row++
    ;(rows[row] ??= []).push(px)
    return { s, px, row }
  })
  const maxRow = Math.max(0, ...placed.map(p => p.row))
  const h = Math.max(h0, 40 + maxRow * 11 + 22)
  const base = h - 22
  const maxLy = maxPc * LY_PER_PC
  let unit = 1
  while (unit * 10 < maxLy) unit *= 10
  const step = [1, 2, 5].map(k => k * unit).find(v => maxLy / v <= 4) ?? unit * 10
  const ticks: number[] = []
  for (let v = step; v <= maxLy; v += step) ticks.push(v)
  return (
    <svg width={width} height={h} viewBox={`0 0 ${width} ${h}`} className="cx-swarm">
      <defs>
        <linearGradient id="cx-axis" x1="0" x2="1"><stop offset="0" stopColor="#8fd0ff" /><stop offset="1" stopColor="#8fd0ff" stopOpacity="0.1" /></linearGradient>
      </defs>
      <line x1={pad} x2={width - pad} y1={base} y2={base} stroke="url(#cx-axis)" strokeWidth="1.5" strokeLinecap="round" />
      {ticks.map(t => (
        <g key={t}>
          <line x1={x(t / LY_PER_PC)} x2={x(t / LY_PER_PC)} y1={base - 3} y2={base + 3} stroke="rgba(160,180,230,0.4)" />
          <text x={x(t / LY_PER_PC)} y={base + 16} textAnchor="middle" className="cx-axis-txt">{t.toLocaleString()}</text>
        </g>
      ))}
      <circle cx={pad} cy={base} r="4.5" fill="#bfe6ff" className="cx-earth" />
      <text x={pad} y={base + 16} textAnchor="middle" className="cx-axis-txt">earth</text>
      {placed.map(({ s, px, row }, i) => {
        const g = kin.groupOf.get(s.hip)
        const cy = base - 12 - row * 11
        return (
          <g key={s.hip} className={`cx-swarm-dot ${focus === s.hip ? 'on' : ''}`} style={{ animationDelay: `${120 + i * 30}ms` }}
            onMouseEnter={() => onFocus(s.hip)} onMouseLeave={() => onFocus(null)}>
            <circle cx={px} cy={cy} r={focus === s.hip ? 6 : 4.2} fill={bvColor(s.bv)}
              stroke={g !== undefined ? KIN_COLORS[g % KIN_COLORS.length] : 'none'} strokeWidth="2" />
            <title>{`${s.label.toLowerCase()} · ${ly(s.dist)} ly`}</title>
          </g>
        )
      })}
      <text x={width - pad} y={12} textAnchor="end" className="cx-axis-txt">light-years →</text>
    </svg>
  )
}

/** When the light you see tonight set off, on a calendar. */
export function LightTimeline({ stars, kin, focus, onFocus, width = 290 }: {
  stars: Star[]; kin: Kinship; focus: number | null; onFocus: (h: number | null) => void; width?: number
}) {
  const pad = 18, h = 58, base = 30
  const years = stars.map(s => NOW_YEAR - s.dist * LY_PER_PC)
  const minY = Math.min(...years)
  const span = NOW_YEAR - minY
  let unit = 1
  while (unit * 10 < span) unit *= 10
  const step = [1, 2, 5].map(k => k * unit).find(v => span / v <= 4) ?? unit * 10
  const x = (yr: number) => pad + ((yr - minY) / Math.max(span, 1)) * (width - pad * 2)
  const ticks: number[] = []
  for (let v = Math.ceil(minY / step) * step; v < NOW_YEAR - step * 0.3; v += step) ticks.push(v)
  const fmt = (y: number) => (y < 0 ? `${Math.round(-y).toLocaleString()} bc` : `${Math.round(y)}`)
  return (
    <svg width={width} height={h} viewBox={`0 0 ${width} ${h}`} className="cx-swarm">
      <line x1={pad} x2={width - pad} y1={base} y2={base} stroke="rgba(255,201,92,0.35)" strokeWidth="1.5" strokeLinecap="round" />
      {ticks.map(t => (
        <text key={t} x={x(t)} y={base + 20} textAnchor="middle" className="cx-axis-txt">{fmt(t)}</text>
      ))}
      <text x={width - pad} y={base + 20} textAnchor="end" className="cx-axis-txt">tonight</text>
      {stars.map((s, i) => {
        const g = kin.groupOf.get(s.hip)
        return (
          <g key={s.hip} className={`cx-swarm-dot ${focus === s.hip ? 'on' : ''}`} style={{ animationDelay: `${200 + i * 30}ms` }}
            onMouseEnter={() => onFocus(s.hip)} onMouseLeave={() => onFocus(null)}>
            <circle cx={x(years[i])} cy={base} r={focus === s.hip ? 6 : 4} fill={g !== undefined ? KIN_COLORS[g % KIN_COLORS.length] : bvColor(s.bv)} />
            <title>{`${s.label.toLowerCase()}: light left in ${fmt(years[i])}`}</title>
          </g>
        )
      })}
      <circle cx={width - pad} cy={base} r="4.5" fill="#bfe6ff" className="cx-earth" />
    </svg>
  )
}

/** Mini star-map of a figure, inside a circle. */
export function Thumb({ sk, size = 56, tint, animate = false }: { sk: Sketch; size?: number; tint?: string; animate?: boolean }) {
  const c = size / 2, k = size * 0.34
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={`cx-thumb ${animate ? 'draw' : ''}`} aria-hidden>
      {sk.segs.map(([a, b], i) => (
        <line key={i} x1={c + sk.pts[a].x * k} y1={c + sk.pts[a].y * k} x2={c + sk.pts[b].x * k} y2={c + sk.pts[b].y * k}
          stroke={tint ?? 'rgba(200,215,255,0.6)'} strokeWidth={size > 80 ? 1.1 : 0.9} strokeLinecap="round"
          pathLength={1} style={animate ? { animationDelay: `${i * 60}ms` } : undefined} />
      ))}
      {sk.pts.map(p => (
        <circle key={p.hip} cx={c + p.x * k} cy={c + p.y * k} r={p.r * (size / 72)} fill={p.col} />
      ))}
    </svg>
  )
}

/** The headline result across every constellation. */
export function ImpactRing({ counts, size = 150 }: { counts: { family: number; mixed: number; illusion: number }; size?: number }) {
  const total = counts.family + counts.mixed + counts.illusion
  const r = size / 2 - 12, c = size / 2, circ = 2 * Math.PI * r
  let acc = 0
  const parts = (['illusion', 'mixed', 'family'] as const).map(k => {
    const len = (counts[k] / total) * circ
    const out = { k, len, off: acc }
    acc += len
    return out
  })
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="cx-impact-ring">
      <circle cx={c} cy={c} r={r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="14" />
      {parts.map(p => (
        <circle key={p.k} cx={c} cy={c} r={r} fill="none" stroke={VERDICT_COLORS[p.k]} strokeWidth="14"
          strokeDasharray={`${Math.max(0, p.len - 3)} ${circ}`} strokeDashoffset={-p.off} strokeLinecap="round"
          transform={`rotate(-90 ${c} ${c})`} className="cx-impact-seg" />
      ))}
      <text x={c} y={c + 4} textAnchor="middle" className="cx-donut-big">{Math.round((counts.illusion / total) * 100)}%</text>
      <text x={c} y={c + 24} textAnchor="middle" className="cx-donut-small" fill={VERDICT_COLORS.illusion}>pure illusion</text>
    </svg>
  )
}
