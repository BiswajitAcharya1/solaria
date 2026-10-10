// Start-up: a short history of constellations, ending on the idea behind solaria.
import { useEffect, useMemo, useState } from 'react'
import Backdrop from './Backdrop'
import Cosmos from './Cosmos'
import { type Catalog, type Sketch, sketch } from './data'
import { Thumb } from './Viz'

const LESSON = [
  { era: '13.8 billion years ago', text: 'the big bang. all matter and energy burst out of a single hot, dense state.' },
  { era: '13.6 billion years ago', text: 'gravity pulls the cooling gas into clumps. the first stars ignite.' },
  { era: '13 billion years ago', text: 'stars gather into galaxies. our milky way begins to turn.' },
  { era: '4.6 billion years ago', text: 'the sun is born in a cluster of sibling stars, which slowly drift apart.' },
  { era: 'babylon · c. 1000 bc', text: 'people join the brightest stars into pictures: a lion, a bull, a scorpion.' },
  { era: '1922', text: 'astronomers fix 88 official constellations, drawn without knowing any star’s distance.' },
  { era: '1989 → today', text: 'the hipparcos and gaia satellites measure each star’s distance and motion.' },
  { era: 'now', text: 'so we can test every constellation: a real stellar family, or a trick of perspective?' },
]
const COSMIC = 4 // chapters drawn by the particle prologue
const STEP_MS = 3600

const seen = () => { try { return localStorage.getItem('solaria-intro') === '1' } catch { return false } }
const markSeen = () => { try { localStorage.setItem('solaria-intro', '1') } catch { /* private mode */ } }

export default function Splash({ cat, onDone }: { cat: Catalog | null; onDone: () => void }) {
  const [step, setStep] = useState(() => {
    // ?intro replays the history lesson (?intro=3 starts at a given chapter); returning visitors skip to the title
    const q = new URLSearchParams(location.search).get('intro')
    if (q !== null) return Math.max(0, Math.min(LESSON.length, Number(q) || 0))
    return seen() ? LESSON.length : 0
  })
  const [leaving, setLeaving] = useState(false)

  const sk = useMemo(() => {
    if (!cat) return null
    const get = (a: string) => { const f = cat.figures.find(x => x.abbr === a); return f ? sketch(cat.stars, f.lines) : null }
    return {
      babylon: ['Leo', 'Tau', 'Sco'].map(get).filter((x): x is Sketch => !!x),
      all: cat.figures.map(f => sketch(cat.stars, f.lines)),
      orion: get('Ori'),
    }
  }, [cat])

  useEffect(() => {
    if (step >= LESSON.length || !cat) return
    const t = setTimeout(() => setStep(s => s + 1), step === LESSON.length - 1 ? STEP_MS + 1400 : step < COSMIC ? STEP_MS + 700 : STEP_MS)
    return () => clearTimeout(t)
  }, [step, cat])

  const onTitle = step >= LESSON.length
  useEffect(() => {
    if (!onTitle || !cat || leaving) return
    const t = setTimeout(() => { markSeen(); setLeaving(true) }, 4200)
    return () => clearTimeout(t)
  }, [onTitle, cat, leaving])
  useEffect(() => {
    if (!leaving) return
    const t = setTimeout(onDone, 1100)
    return () => clearTimeout(t)
  }, [leaving, onDone])

  const enter = () => { if (cat) { markSeen(); setLeaving(true) } }
  const lesson = LESSON[Math.min(step, LESSON.length - 1)]

  return (
    <div className={`cx-splash ${leaving ? 'out' : ''}`}>
      <div className={`cx-backdrop-wrap ${step < COSMIC ? 'hidden' : ''}`}><Backdrop /></div>
      {step < COSMIC && <Cosmos chapter={step} />}

      {!onTitle && sk && (
        <div className="cx-lesson" key={step}>
          <div className="cx-lesson-art">
            {step === 4 && (
              <div className="cx-row">
                {sk.babylon.map((s, i) => <div key={i} className="cx-art-in" style={{ animationDelay: `${i * 300}ms` }}><Thumb sk={s} size={210} animate /></div>)}
              </div>
            )}
            {step === 5 && (
              <div className="cx-all88">
                {sk.all.map((s, i) => <div key={i} className="cx-art-in" style={{ animationDelay: `${i * 18}ms` }}><Thumb sk={s} size={40} /></div>)}
              </div>
            )}
            {step === 6 && <Parallax />}
            {step === 7 && sk.orion && <Unfold sk={sk.orion} />}
          </div>
          <div className="cx-lesson-text">
            <span className="cx-era">{lesson.era}</span>
            <p>{lesson.text}</p>
          </div>
        </div>
      )}
      {!onTitle && !cat && <div className="cx-splash-load solo"><span><i /><i /><i /></span></div>}

      {!onTitle && (
        <div className="cx-progress">
          {LESSON.map((_, i) => <i key={i} className={i < step ? 'done' : i === step ? 'on' : ''} />)}
        </div>
      )}

      {onTitle && (
        <div className="cx-splash-title">
          <h1 aria-label="solaria">
            {'solaria'.split('').map((ch, i) => <span key={i} style={{ animationDelay: `${150 + i * 110}ms` }}>{ch}</span>)}
          </h1>
          <p>constellations, unfolded</p>
          <div className="cx-splash-load">
            {cat ? <button className="cx-pill-btn" onClick={enter}>enter the sky</button> : <span><i /><i /><i /></span>}
          </div>
        </div>
      )}

      {!onTitle && <button className="cx-skip" onClick={() => setStep(LESSON.length)}>skip intro →</button>}
    </div>
  )
}

/** Earth circles the Sun; a nearby star seems to shift against far-off ones. That shift gives its distance. */
function Parallax() {
  return (
    <svg width="520" height="300" viewBox="0 0 520 300" className="cx-parallax cx-art-in">
      <defs>
        <radialGradient id="cx-sun"><stop offset="0" stopColor="#fff6d8" /><stop offset="0.45" stopColor="#ffc95c" /><stop offset="1" stopColor="#ffc95c" stopOpacity="0" /></radialGradient>
      </defs>
      <ellipse cx="160" cy="170" rx="110" ry="42" fill="none" stroke="rgba(143,208,255,0.35)" strokeDasharray="3 5" />
      <circle cx="160" cy="170" r="22" fill="url(#cx-sun)" />
      <g className="cx-orbit"><circle r="6" fill="#4aa3ff" /><circle r="11" fill="none" stroke="rgba(120,190,255,0.5)" /></g>
      <line x1="160" y1="170" x2="430" y2="90" stroke="rgba(255,255,255,0.2)" strokeDasharray="2 4" />
      <g className="cx-wobble"><circle cx="430" cy="90" r="5" fill="#fff" /><circle cx="430" cy="90" r="13" fill="rgba(255,255,255,0.14)" /></g>
      {[[470, 40], [505, 120], [390, 30], [480, 210], [360, 120], [300, 40]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r="1.6" fill="rgba(220,230,255,0.6)" />)}
      <text x="160" y="240" textAnchor="middle" className="cx-axis-txt">earth’s yearly orbit</text>
      <text x="430" y="62" textAnchor="middle" className="cx-axis-txt">a nearby star seems to wobble</text>
    </svg>
  )
}

/** Orion, flat, then turned side-on in real CSS 3D: its stars spread out by true distance. */
function Unfold({ sk }: { sk: Sketch }) {
  const maxD = Math.max(...sk.pts.map(p => p.dist))
  return (
    <div className="cx-unfold cx-art-in">
      <div className="cx-unfold-rig">
        <div className="cx-unfold-lines"><Thumb sk={{ ...sk, pts: sk.pts.map(p => ({ ...p, r: 0 })) }} size={300} /></div>
        {sk.pts.map(p => (
          <i key={p.hip} style={{
            left: 150 + p.x * 102, top: 150 + p.y * 102, width: p.r * 3 + 2, height: p.r * 3 + 2, background: p.col,
            boxShadow: `0 0 ${6 + p.r * 4}px ${p.col}`, '--z': `${-(p.dist / maxD) * 460 + 160}px`,
          } as React.CSSProperties} />
        ))}
      </div>
    </div>
  )
}
