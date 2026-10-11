// One family's origin, in a few steps. Small dots are the family's real member stars (Gaia + Hipparcos);
// the view looks down on the Milky Way's disc. Time only runs forward: birth -> gas blown away
// (by supernovae for Scorpius-Centaurus) -> drifting apart -> today's sky -> why it matters.
import { useEffect, useMemo, useRef, useState } from 'react'
import { type Family, SN_PUBLISHED, SN_TIMES, buildSim, ironAt, phases } from './familyData'
import { LY_PER_PC, ly } from './physics'

const PHASE_MS = 6500
const ease = (x: number) => x * x * (3 - 2 * x)
const myr = (t: number) => (t < 0.05 ? 'today' : `${t >= 10 ? Math.round(t) : t.toFixed(1)} million years ago`)

export default function OriginSim({ family: f, onClose }: { family: Family; onClose: () => void }) {
  const ph = useMemo(() => phases(f), [f])
  const sim = useMemo(() => buildSim(f), [f])
  const [step, setStep] = useState(0)
  const [p, setP] = useState(0) // progress through the current step
  const [playing, setPlaying] = useState(true)
  const cv = useRef<HTMLCanvasElement>(null)
  const cam = useRef<{ x: number; y: number; r: number } | null>(null)

  const cur = ph[step]
  const t = cur.from + (cur.to - cur.from) * ease(p)

  // advance time; move to the next step at the end of each
  const pRef = useRef(0)
  useEffect(() => {
    if (!playing) return
    let raf = 0, last = performance.now()
    const dur = cur.key === 'today' ? PHASE_MS * 0.5 : PHASE_MS
    const tick = (now: number) => {
      let nx = pRef.current + (now - last) / dur
      last = now
      if (nx >= 1) {
        if (step < ph.length - 1) { pRef.current = 0; setP(0); setStep(step + 1); return }
        nx = 1
        setPlaying(false)
      }
      pRef.current = nx
      setP(nx)
      if (nx < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, step, cur.key, ph.length])

  // ------------------------------------------------------------------ draw
  useEffect(() => {
    const c = cv.current
    if (!c) return
    const ctx = c.getContext('2d')!
    const dpr = window.devicePixelRatio || 1
    const W = c.clientWidth, H = c.clientHeight
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr) }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, W, H)

    const C = sim.centreAt(t)
    const s = sim.birthScale + (1 - sim.birthScale) * sim.spreadAt(t)
    const pts = sim.rel.map(r => [C[0] + r.dx * s, C[1] + r.dy * s] as [number, number])
    // camera: frame the family; also the Sun when Earth is part of the story
    const withSun = f.exploded || cur.key === 'today' || cur.key === 'why'
    const fitPts = withSun ? [...pts, [0, 0] as [number, number]] : pts
    const xs = fitPts.map(q => q[0]), ys = fitPts.map(q => q[1])
    const target = {
      x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2,
      r: Math.max(12, (Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / 2) * 1.25),
    }
    const cm = cam.current ?? (cam.current = { ...target })
    const k = 0.08
    cm.x += (target.x - cm.x) * k; cm.y += (target.y - cm.y) * k; cm.r *= Math.exp(Math.log(target.r / cm.r) * k)
    const scale = Math.min(W, H) / 2 / cm.r
    const cx = W / 2, cy = H / 2
    const P = (q: [number, number]): [number, number] => [cx + (q[0] - cm.x) * scale, cy - (q[1] - cm.y) * scale]

    // birth gas: a soft cloud that is blown away
    const gasOut = sim.gasOutAt, gasGone = ph[1].to
    const gasA = t > gasOut ? 0.4 : Math.max(0, 0.4 * (1 - (gasOut - t) / Math.max(0.01, gasOut - gasGone)))
    if (gasA > 0.005) {
      const [gx, gy] = P(C)
      const gr = Math.max(30, 8 * scale) * (1 + 2.5 * (1 - gasA / 0.4))
      const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, gr)
      g.addColorStop(0, `rgba(170,140,255,${gasA})`); g.addColorStop(1, 'rgba(170,140,255,0)')
      ctx.fillStyle = g
      ctx.beginPath(); ctx.arc(gx, gy, gr, 0, Math.PI * 2); ctx.fill()
    }

    // supernovae (Scorpius-Centaurus only): a flash, then a blast wave racing outward
    if (f.exploded) {
      SN_TIMES.forEach((ts, i) => {
        const since = ts - t
        if (since < 0 || since > 1.2) return
        const cc = sim.centreAt(ts)
        const src = sim.rel[(i * 7) % sim.rel.length]
        const ss = sim.birthScale + (1 - sim.birthScale) * sim.spreadAt(ts)
        const [x, y] = P([cc[0] + src.dx * ss, cc[1] + src.dy * ss])
        const q = since / 1.2
        const flash = Math.max(0, 1 - q * 4)
        if (flash > 0) {
          const g = ctx.createRadialGradient(x, y, 0, x, y, 30)
          g.addColorStop(0, `rgba(255,255,255,${flash})`); g.addColorStop(0.35, `rgba(255,96,96,${0.7 * flash})`); g.addColorStop(1, 'rgba(255,96,96,0)')
          ctx.fillStyle = g
          ctx.beginPath(); ctx.arc(x, y, 30, 0, Math.PI * 2); ctx.fill()
        }
        ctx.strokeStyle = `rgba(255,96,96,${0.55 * (1 - q)})`
        ctx.lineWidth = SN_PUBLISHED.has(ts) ? 2 : 1.2
        ctx.beginPath(); ctx.arc(x, y, 4 + q * 160 * scale, 0, Math.PI * 2); ctx.stroke()
      })
    } else if (cur.key === 'blast') {
      // starlight and winds push the gas out: one gentle ring
      const [x, y] = P(C)
      ctx.strokeStyle = `rgba(170,140,255,${0.5 * (1 - p)})`
      ctx.lineWidth = 1.5
      ctx.beginPath(); ctx.arc(x, y, 10 + p * Math.min(W, H) * 0.35, 0, Math.PI * 2); ctx.stroke()
    }

    // the family's stars
    const named = new Map<string, [number, number][]>()
    sim.rel.forEach((r, i) => {
      const [x, y] = P(pts[i])
      const big = r.bright && r.bright.mag < 4.5
      const rad = big ? 2.6 : Math.max(1, 2.2 - (r.mag - 6) * 0.12)
      ctx.fillStyle = f.color
      ctx.globalAlpha = big ? 1 : 0.8
      ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill()
      if (big) { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, rad * 0.45, 0, Math.PI * 2); ctx.fill() }
      if (r.bright?.constellation) named.set(r.bright.constellation, [...(named.get(r.bright.constellation) ?? []), [x, y]])
    })
    ctx.globalAlpha = 1

    // today: which constellation each group of stars shows up in
    if (cur.key === 'today' || cur.key === 'why') {
      ctx.font = '600 13px Nunito, system-ui, sans-serif'
      ctx.textAlign = 'center'
      const a = cur.key === 'today' ? Math.min(1, p * 2) : 1
      for (const [name, list] of named) {
        if (list.length < 1) continue
        const mx = list.reduce((s0, q) => s0 + q[0], 0) / list.length, my = Math.min(...list.map(q => q[1]))
        ctx.fillStyle = `rgba(255,255,255,${0.9 * a})`
        ctx.fillText(name, mx, my - 12)
      }
      ctx.textAlign = 'start'
    }

    // the Sun and Earth, or an arrow pointing to them
    const [ex, ey] = P([0, 0])
    const hit = f.exploded && ironAt(t)
    ctx.font = '600 12px Nunito, system-ui, sans-serif'
    if (ex > 20 && ex < W - 20 && ey > 20 && ey < H - 20) {
      const g = ctx.createRadialGradient(ex, ey, 0, ex, ey, hit ? 26 : 14)
      g.addColorStop(0, hit ? 'rgba(255,96,96,0.8)' : 'rgba(111,182,255,0.6)'); g.addColorStop(1, 'rgba(111,182,255,0)')
      ctx.fillStyle = g
      ctx.beginPath(); ctx.arc(ex, ey, hit ? 26 : 14, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = '#6fb6ff'
      ctx.beginPath(); ctx.arc(ex, ey, 4.5, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = '#e8f3ff'
      ctx.fillText(hit ? 'Earth: iron-60 arriving' : 'Sun & Earth', ex + 10, ey + 4)
    } else {
      const ang = Math.atan2(ey - cy, ex - cx)
      const rr = Math.min(W, H) / 2 - 40
      const ax = cx + Math.cos(ang) * rr, ay = cy + Math.sin(ang) * rr
      ctx.fillStyle = '#6fb6ff'
      ctx.save(); ctx.translate(ax, ay); ctx.rotate(ang)
      ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(-4, -6); ctx.lineTo(-4, 6); ctx.closePath(); ctx.fill()
      ctx.restore()
      const d = Math.hypot(...sim.centreAt(t))
      ctx.fillStyle = '#cfe6ff'
      ctx.textAlign = 'center'
      ctx.fillText(`Earth · ${ly(d)} ly`, ax - Math.cos(ang) * 22, ay - Math.sin(ang) * 22 + 4)
      ctx.textAlign = 'start'
    }

    // scale bar
    const lyTarget = (cm.r * 0.4) * LY_PER_PC
    const bar = [5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000].find(v => v >= lyTarget * 0.6) ?? 5000
    const px = (bar / LY_PER_PC) * scale
    ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(24, H - 24); ctx.lineTo(24 + px, H - 24); ctx.stroke()
    ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '11px Nunito, system-ui, sans-serif'
    ctx.fillText(`${bar.toLocaleString('en-US')} light-years`, 24, H - 30)
  })

  const go = (i: number) => { setStep(Math.max(0, Math.min(ph.length - 1, i))); pRef.current = 0; setP(0); setPlaying(true) }
  const cons = f.constellations.map(c => c[0])
  const consText = cons.length > 1 ? `${cons.slice(0, -1).slice(0, 4).join(', ')} and ${cons[Math.min(cons.length - 1, 4)]}` : cons[0] ?? 'faint stars no constellation uses'

  const caption: Record<string, string> = f.exploded ? {
    birth: `${Math.round(f.age)} million years ago, these stars form together in one cloud of gas. that is why they share one chemical fingerprint.`,
    blast: 'its heaviest stars live only a few million years, then explode as supernovae. the blasts and radiation blow the gas away and start carving the Local Bubble.',
    drift: 'the stars drift apart. dust and radiation from the explosions reach Earth: radioactive iron-60 settles on the sea floor, and cosmic rays rise.',
    today: `today its stars are spread across ${consText}. from Earth they look like parts of different pictures.`,
    why: '',
  } : {
    birth: `${Math.round(f.age)} million years ago, these stars form together in one cloud of gas. that is why they share one chemical fingerprint.`,
    blast: 'light and winds from its brightest young stars push the leftover gas away. without the gas’s gravity, the cluster loosens.',
    drift: 'small differences in speed carry the stars apart, while the whole family keeps circling the galaxy.',
    today: `today its stars are spread across ${consText}. from Earth they look like parts of different pictures.`,
    why: '',
  }

  return (
    <div className="os">
      <canvas ref={cv} className="os-canvas" />
      <header className="os-top">
        <div>
          <p className="os-kicker" style={{ color: f.color }}>{f.name}</p>
          <p className="os-when">{cur.key === 'why' ? 'why it matters' : myr(t)}</p>
        </div>
        <button className="os-close" onClick={onClose}>back to the sky</button>
      </header>

      <ul className="os-key">
        <li><i style={{ background: f.color }} />its stars (real members)</li>
        <li><i style={{ background: 'rgba(170,140,255,0.7)' }} />birth gas</li>
        {f.exploded && <li><i className="ring" />supernova</li>}
        <li><i style={{ background: '#6fb6ff' }} />Sun & Earth</li>
        <li className="os-view">looking down on the galaxy</li>
      </ul>

      <section className="os-cap" key={cur.key}>
        <h3>{cur.title}</h3>
        {cur.key !== 'why' ? <p>{caption[cur.key]}</p> : f.exploded ? (
          <ul>
            <li>Earth sits inside the <b>Local Bubble</b> these explosions blew: thin, hot gas about 1,000 light-years across.</li>
            <li>their <b>iron-60</b> is in deep-sea crust (two pulses, 8.7–6.5 and 3.2–1.7 million years ago) and still falls in Antarctic snow.</li>
            <li>their <b>cosmic rays</b>, steered by the galaxy’s magnetic field, raised radiation at Earth for thousands of years. links to climate and extinctions are still being tested.</li>
            <li className="os-src">Wallner 2016 · Breitschwerdt 2016 · Koll 2019 · Zucker 2022</li>
          </ul>
        ) : (
          <ul>
            <li>siblings keep the <b>same chemical fingerprint</b> long after they have spread across the sky.</li>
            <li>matching fingerprints and motions is how researchers find families that no longer look like one, including the <b>Sun’s own lost siblings</b>.</li>
            <li>each family is a clock: how far its stars have spread tells how long ago, and where, they formed.</li>
          </ul>
        )}
      </section>

      <nav className="os-steps">
        <button onClick={() => (playing ? setPlaying(false) : step === ph.length - 1 && p >= 1 ? go(0) : setPlaying(true))} className="os-play" aria-label={playing ? 'pause' : 'play'}>
          {playing ? '❚❚' : step === ph.length - 1 && p >= 1 ? '↺' : '▶'}
        </button>
        {ph.map((x, i) => (
          <button key={x.key} className={i === step ? 'on' : i < step ? 'done' : ''} onClick={() => go(i)}>
            <span className="os-bar"><span style={{ width: i < step ? '100%' : i === step ? `${p * 100}%` : '0%' }} /></span>
            {x.title}
          </button>
        ))}
      </nav>
    </div>
  )
}
