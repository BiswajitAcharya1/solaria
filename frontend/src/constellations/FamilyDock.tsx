// Birth families beside today's constellations.
//   dock     the families, one line each
//   select   the sky frames the family's naked-eye stars and rings them, across every constellation they sit in;
//            a panel shows the two pieces of evidence (same motion, same chemistry) as pictures
//   watch    the origin simulation (OriginSim)
import { type RefObject, useEffect, useMemo, useRef, useState } from 'react'
import { type SkyEngine, frameStars } from './SkyEngine'
import { type Family, loadFamilies } from './familyData'
import { unitFromRaDec } from './physics'
import OriginSim from './OriginSim'
import './families.css'

interface Props {
  engine: RefObject<SkyEngine | null>
  selected: string | null
  onSelect: (id: string | null) => void
}

export default function Families({ engine, selected, onSelect }: Props) {
  const [fams, setFams] = useState<Family[]>([])
  const [watch, setWatch] = useState(false)
  useEffect(() => { loadFamilies().then(setFams, () => setFams([])) }, [])
  const fam = fams.find(f => f.id === selected) ?? null

  // frame the family's naked-eye stars; hand the sky back when closed
  useEffect(() => {
    const eng = engine.current
    document.body.classList.toggle('fam-on', !!fam)
    if (!eng || !fam) return
    const pts = fam.bright.map(b => ({ pos: unitFromRaDec(b.ra, b.dec), dist: 1, ra: b.ra, dec: b.dec }))
    const fr = frameStars(pts, window.innerWidth / Math.max(1, window.innerHeight))
    eng.autoDrift = false
    eng.flyTo({ ...fr, fov: Math.min(110, Math.max(28, fr.fov * 1.35)) }, 2200)
    return () => { eng.autoDrift = true; document.body.classList.remove('fam-on') }
  }, [fam, engine])

  return (
    <>
      {!fam && (
        <aside className="fd" aria-label="star families">
          <p className="fd-h">born together</p>
          <p className="fd-sub">families found by matching motion and chemistry</p>
          {fams.map(f => (
            <button key={f.id} onClick={() => onSelect(f.id)}>
              <i style={{ background: f.color }} />
              <span>{f.name}</span>
              <em>{f.constellations.slice(0, 2).map(c => c[0]).join(', ')}{f.constellations.length > 2 ? ` +${f.constellations.length - 2}` : ''}</em>
            </button>
          ))}
        </aside>
      )}

      {fam && <SkyRings engine={engine} fam={fam} />}
      {fam && !watch && <Panel fam={fam} onClose={() => onSelect(null)} onWatch={() => setWatch(true)} />}
      {fam && watch && <OriginSim family={fam} onClose={() => setWatch(false)} />}
    </>
  )
}

// ---------------------------------------------------------------- the family's stars, ringed on the sky
function SkyRings({ engine, fam }: { engine: RefObject<SkyEngine | null>; fam: Family }) {
  const cv = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = cv.current
    if (!c) return
    const ctx = c.getContext('2d')!
    const dirs = fam.bright.map(b => ({ b, u: unitFromRaDec(b.ra, b.dec) }))
    const labelled = new Set(fam.bright.filter(b => !b.name.startsWith('HIP')).slice(0, 8).map(b => b.hip))
    let raf = 0
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw)
      const eng = engine.current
      const dpr = window.devicePixelRatio || 1
      const W = c.clientWidth, H = c.clientHeight
      if (c.width !== Math.round(W * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr) }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, W, H)
      if (!eng) return
      const pulse = 0.75 + 0.25 * Math.sin(now / 600)
      ctx.font = '600 12px Nunito, system-ui, sans-serif'
      for (const { b, u } of dirs) {
        const q = eng.project(u)
        if (!q || q[0] < -20 || q[0] > W + 20 || q[1] < -20 || q[1] > H + 20) continue
        const r = Math.max(5, 9 - b.mag)
        ctx.strokeStyle = fam.color
        ctx.globalAlpha = pulse
        ctx.lineWidth = 1.6
        ctx.beginPath(); ctx.arc(q[0], q[1], r, 0, Math.PI * 2); ctx.stroke()
        ctx.globalAlpha = 1
        if (labelled.has(b.hip)) {
          ctx.fillStyle = 'rgba(255,255,255,0.85)'
          ctx.fillText(b.name, q[0] + r + 5, q[1] + 4)
        }
      }
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [engine, fam])
  return <canvas ref={cv} className="fd-rings" aria-hidden />
}

// ---------------------------------------------------------------- evidence panel
function Panel({ fam, onClose, onWatch }: { fam: Family; onClose: () => void; onWatch: () => void }) {
  const ev = fam.evidence
  return (
    <aside className="fp" aria-label={fam.name}>
      <button className="fp-x" onClick={onClose} aria-label="close">×</button>
      <p className="fp-kicker" style={{ color: fam.color }}>a family born {Math.round(fam.age)} million years ago</p>
      <h3>{fam.name}</h3>
      <p className="fp-blurb">{fam.blurb}</p>

      <p className="fp-h">its stars in today’s sky</p>
      <div className="fp-cons">
        {fam.constellations.map(([c, n]) => <span key={c}>{c}<b>{n}</b></span>)}
      </div>

      <p className="fp-h">why we know they are siblings</p>
      <Motion fam={fam} />
      {ev.feh_members.length >= 5
        ? <Chemistry fam={fam} />
        : <p className="fp-dim">chemistry: not yet measured for enough of its stars in our surveys (APOGEE, GALAH). the case rests on motion and published studies.</p>}

      <button className="fp-go" onClick={onWatch}>▶ watch how it formed and spread</button>
      <p className="fp-src">{fam.n ? `${fam.n} members with full 3D motion and chemistry (Gaia DR3 + APOGEE/GALAH) · ` : ''}{fam.bright.length} naked-eye members (Hipparcos)</p>
    </aside>
  )
}

/** Two bars on one scale: how much members' speeds differ, vs ordinary stars at the same distance. */
function Motion({ fam }: { fam: Family }) {
  const { dv_members: m, dv_field: f } = fam.evidence
  if (m == null || f == null) {
    return <p className="fp-line"><b>same motion</b> · its {fam.bright.length} bright members all drift the same way across the sky.</p>
  }
  const w = (v: number) => `${Math.max(1.5, (v / f) * 100)}%`
  return (
    <div className="fp-ev">
      <p className="fp-line"><b>same motion</b> · how much their speeds differ</p>
      <div className="fp-bar"><span style={{ width: w(m), background: fam.color }} /><em>family {m < 1 ? m.toFixed(1) : Math.round(m)} km/s</em></div>
      <div className="fp-bar"><span style={{ width: w(f), background: 'rgba(200,210,240,0.35)' }} /><em>random nearby stars {Math.round(f)} km/s</em></div>
    </div>
  )
}

/** Iron content of members vs ordinary nearby stars, on one axis: a family is one narrow stripe. */
function Chemistry({ fam }: { fam: Family }) {
  const { feh_members: mem, feh_field: fld } = fam.evidence
  const W = 300, x = (v: number) => 10 + ((Math.max(-0.8, Math.min(0.5, v)) + 0.8) / 1.3) * (W - 20)
  const sd = (a: number[]) => { const m = a.reduce((s, v) => s + v, 0) / a.length; return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length) }
  const jit = useMemo(() => [...mem, ...fld].map((_, i) => ((i * 0.618) % 1) - 0.5), [mem, fld])
  return (
    <div className="fp-ev">
      <p className="fp-line"><b>same chemistry</b> · iron content of each star</p>
      <svg viewBox={`0 0 ${W} 74`} className="fp-strip">
        {fld.map((v, i) => <circle key={`f${i}`} cx={x(v)} cy={52 + jit[mem.length + i] * 14} r="2" fill="rgba(200,210,240,0.3)" />)}
        {mem.map((v, i) => <circle key={`m${i}`} cx={x(v)} cy={18 + jit[i] * 14} r="2.2" fill={fam.color} />)}
        <text x={W - 10} y="10" textAnchor="end" className="fp-t">family: ±{sd(mem).toFixed(2)}</text>
        <text x={W - 10} y="72" textAnchor="end" className="fp-t">random stars: ±{sd(fld).toFixed(2)}</text>
        <text x="10" y="72" className="fp-t">less iron</text>
      </svg>
    </div>
  )
}
