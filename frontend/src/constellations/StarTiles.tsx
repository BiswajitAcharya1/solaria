// Right-hand column: the constellation's stars as simple tiles, grouped by what they mean,
// each anchored to something familiar (when its light set off, its colour compared with the sun).
import { useState } from 'react'
import { type Kinship, type Star, KIN_COLORS, LY_PER_PC, bvColor, ly } from './data'
import './startiles.css'

const YEAR = new Date().getFullYear()
const EVENTS: [number, string][] = [
  [1969, 'the moon landing'], [1939, 'world war ii'], [1914, 'world war i'], [1903, 'the first aeroplane'],
  [1865, 'the end of the us civil war'], [1815, 'the battle of waterloo'], [1776, 'american independence'],
  [1687, 'newton’s laws of gravity'], [1609, 'galileo’s first telescope'], [1492, 'columbus’s voyage'],
  [1347, 'the black death'], [1066, 'the battle of hastings'], [800, 'charlemagne'], [476, 'the fall of rome'],
  [30, 'the roman empire'], [-480, 'ancient greece'], [-1330, 'tutankhamun'], [-2560, 'the great pyramid'],
]

/** "1943 · around world war ii" */
function lightLeft(distPc: number) {
  const y = Math.round(YEAR - distPc * LY_PER_PC)
  const [, what] = EVENTS.reduce((best, e) => (Math.abs(e[0] - y) < Math.abs(best[0] - y) ? e : best))
  return { year: y < 0 ? `${(-y).toLocaleString('en-US')} bc` : String(y), what }
}

/** plain-words colour and temperature, from the measured b−v colour */
function colourWords(bv: number) {
  if (bv < 0) return 'blue-white · far hotter than the sun'
  if (bv < 0.3) return 'white · hotter than the sun'
  if (bv < 0.58) return 'yellow-white · a bit hotter than the sun'
  if (bv < 0.8) return 'yellow · like our sun'
  if (bv < 1.25) return 'orange · cooler than the sun'
  return 'red · much cooler than the sun'
}

export default function StarTiles({ stars, kin, focus, hidden, onHover, onPick }: {
  stars: Star[]; kin: Kinship; focus: number | null; hidden: boolean
  onHover: (hip: number | null) => void; onPick: (hip: number) => void
}) {
  const [all, setAll] = useState(false)
  const bright = [...stars].sort((a, b) => a.vmag - b.vmag)
  const family = kin.groups.map(g => bright.filter(s => g.includes(s.hip)))
  const others = bright.filter(s => !kin.groupOf.has(s.hip))
  const nFamily = family.reduce((n, g) => n + g.length, 0)
  const othersShown = all ? others : others.slice(0, Math.max(3, 6 - nFamily))
  const maxDist = Math.max(...stars.map(s => s.dist))

  const tile = (s: Star, i: number, tone?: string) => {
    const light = lightLeft(s.dist)
    return (
      <button key={s.hip} className={`st-tile ${focus === s.hip ? 'on' : ''}`} style={{ animationDelay: `${i * 45}ms`, '--tone': tone ?? 'rgba(255,255,255,0.14)' } as React.CSSProperties}
        onMouseEnter={() => onHover(s.hip)} onMouseLeave={() => onHover(null)} onClick={() => onPick(s.hip)}>
        <span className="st-orb" style={{ background: `radial-gradient(circle at 35% 30%, #fff, ${bvColor(s.bv)} 55%, rgba(0,0,0,0.4))`, boxShadow: `0 0 14px ${bvColor(s.bv)}` }} />
        <span className="st-main">
          <b>{s.label}</b>
          <small>{colourWords(s.bv)}</small>
        </span>
        <span className="st-dist"><b>{ly(s.dist)}</b><small>light-years</small></span>
        <span className="st-bar"><i style={{ width: `${Math.max(3, (s.dist / maxDist) * 100)}%`, background: tone ?? 'rgba(170,190,240,0.5)' }} /></span>
        <span className="st-light">its light left in <b>{light.year}</b> · around {light.what}</span>
      </button>
    )
  }

  return (
    <aside className={`st ${hidden ? 'st-hidden' : ''}`} aria-label="the stars of this constellation">
      {family.map((g, i) => (
        <section key={i} className="st-group">
          <header style={{ color: KIN_COLORS[i % KIN_COLORS.length] }}>
            <i style={{ background: KIN_COLORS[i % KIN_COLORS.length] }} />travel together
            <span>born in the same cloud of gas</span>
          </header>
          {g.map((s, j) => tile(s, j, KIN_COLORS[i % KIN_COLORS.length]))}
        </section>
      ))}
      {others.length > 0 && (
        <section className="st-group">
          <header className="st-others"><i />{nFamily ? 'the others' : 'not related'}<span>they only line up from where we stand</span></header>
          {othersShown.map((s, j) => tile(s, j + nFamily))}
          {others.length > othersShown.length && <button className="st-more" onClick={() => setAll(true)}>show all {others.length} →</button>}
          {all && others.length > 3 && <button className="st-more" onClick={() => setAll(false)}>show fewer</button>}
        </section>
      )}
      <p className="st-hint">distance bars: longer = farther away · click a tile for the star’s story</p>
    </aside>
  )
}
