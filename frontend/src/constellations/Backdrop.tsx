// Deep-space backdrop: three drifting star layers (parallax), slow nebula clouds and a vignette.
// Pure CSS animation, so it costs nothing per frame in JS.
import { useMemo } from 'react'

const field = (n: number, size: number, seed: number) => {
  let x = seed
  const rnd = () => ((x = (x * 16807) % 2147483647) / 2147483647)
  const out: string[] = []
  for (let i = 0; i < n; i++) {
    const a = 0.35 + rnd() * 0.65
    const hue = rnd() < 0.15 ? '255,225,190' : rnd() < 0.3 ? '190,210,255' : '235,240,255'
    out.push(`${Math.round(rnd() * 2400)}px ${Math.round(rnd() * 2400)}px 0 ${size > 1.5 ? 0.3 : 0}px rgba(${hue},${a.toFixed(2)})`)
  }
  return out.join(',')
}

export default function Backdrop({ dim = false, faint = false }: { dim?: boolean; faint?: boolean }) {
  const layers = useMemo(() => [
    { s: 1, shadow: field(700, 1, 7), dur: 260 },
    { s: 1.5, shadow: field(220, 1.5, 13), dur: 180 },
    { s: 2, shadow: field(70, 2, 29), dur: 120 },
  ], [])
  return (
    <div className={`cx-space ${dim ? 'dim' : ''} ${faint ? 'faint' : ''}`} aria-hidden>
      <div className="cx-nebula n1" />
      <div className="cx-nebula n2" />
      <div className="cx-nebula n3" />
      <div className="cx-milkyway" />
      {layers.map((l, i) => (
        <div key={i} className="cx-stars" style={{ animationDuration: `${l.dur}s` }}>
          <i style={{ width: l.s, height: l.s, boxShadow: l.shadow }} />
          <i style={{ width: l.s, height: l.s, boxShadow: l.shadow, top: 2400 }} />
        </div>
      ))}
      <div className="cx-twinkles">
        {Array.from({ length: 26 }, (_, i) => (
          <b key={i} style={{ left: `${(i * 37.7) % 100}%`, top: `${(i * 61.3) % 100}%`, animationDelay: `${(i * 0.73) % 6}s` }} />
        ))}
      </div>
      <div className="cx-vignette" />
    </div>
  )
}
