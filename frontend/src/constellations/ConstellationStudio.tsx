// solaria: constellations seen from Earth, tested against their real 3D structure.
// One WebGL sky (SkyEngine) is shared by the opening film and the explorer; everything
// on top of it is a text overlay. React holds only discrete state; the per-frame work
// (camera, time-lapse, label positions) happens inside the engine and plain DOM writes.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SkyEngine, frameStars, type Projected } from './SkyEngine'
import { SCRIPT, TITLE_HOLD_MS, type Shot } from './Prologue'
import {
  type Catalog, type Kinship, type Star, KIN_COLORS, VERDICT_COLORS, analyse, bvColor, figureHips, loadCatalog, ly,
  pairInfo,
} from './data'
import ResearchPanel from '../research/ResearchPanel'
import './solaria.css'
import StarJourney from './StarJourney'
import Families from './FamilyDock'
import HowWeKnow from './HowWeKnow'
import EarthGlobe from './EarthGlobe'
import StarTiles from './StarTiles'
import StarCollision from '../intro/StarCollision'

const FEATURED = ['UMa', 'Ori', 'Tau', 'Cas', 'Sco', 'Cyg', 'Leo', 'Cru']
const VERDICT_WORD = { family: 'a real family', mixed: 'partly a family', illusion: 'a trick of perspective' }
const TIMELAPSE_MS = 9000 // -1 Myr -> +1 Myr

const starsOf = (cat: Catalog, lines: number[][]) =>
  figureHips(lines).map(h => cat.stars.get(h)).filter((s): s is Star => !!s)

const timeWords = (t: number) => {
  if (Math.abs(t) < 0.004) return 'today'
  const yrs = Math.round(Math.abs(t) * 1000) * 1000
  return `${yrs.toLocaleString('en-US')} years ${t < 0 ? 'ago' : 'from now'}`
}


export default function ConstellationStudio() {
  const [cat, setCat] = useState<Catalog | null>(null)
  const [error, setError] = useState<string | null>(null)
  // the film opens every visit (skip button jumps straight to the sky); ?intro=5 starts at shot 5
  const [mode, setMode] = useState<'crash' | 'film' | 'title' | 'app'>('crash')
  const [shot, setShot] = useState(() => Math.max(0, Math.min(SCRIPT.length - 1, Number(new URLSearchParams(location.search).get('intro')) || 0)))
  const [abbr, setAbbr] = useState('UMa')
  const [focus, setFocus] = useState<number | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  const [playing, setPlaying] = useState(false)
  const [tState, setTState] = useState(0) // coarse copy of time for text (updated a few times/s)
  const [picker, setPicker] = useState(false)
  const [query, setQuery] = useState('')
  const [info, setInfo] = useState(false)
  const [research, setResearch] = useState(false)
  const [family, setFamily] = useState<string | null>(null) // a birth family shown across the sky
  const [labelMode, setLabelMode] = useState<'names' | 'distance' | null>('names')
  const [paused, setPaused] = useState(false) // auto-drift paused by the user (shows a hint)

  const canvas = useRef<HTMLCanvasElement>(null)
  const engine = useRef<SkyEngine | null>(null)
  const labels = useRef(new Map<number, HTMLDivElement>())
  const timeEl = useRef<HTMLSpanElement>(null)
  const lastProj = useRef<Projected[]>([])
  const magOf = useRef(new Map<number, number>())

  useEffect(() => { loadCatalog().then(setCat, e => setError(String(e?.message ?? e))) }, [])

  // ---------------------------------------------------------------- engine
  useEffect(() => {
    if (!cat || !canvas.current) return
    const eng = new SkyEngine(canvas.current, cat.sky, cat.all)
    eng.setAllFigures(cat.stars, cat.figures)
    engine.current = eng
    if (import.meta.env.DEV) (window as unknown as { __sky: SkyEngine }).__sky = eng // console debugging
    const ro = new ResizeObserver(() => eng.resize())
    ro.observe(canvas.current)
    let lastT = 0
    eng.onTime = t => {
      if (timeEl.current) timeEl.current.textContent = timeWords(t)
      if (Math.abs(t - lastT) > 0.02 || ((t === 0 || Math.abs(t) >= 0.999) && t !== lastT)) { lastT = t; setTState(t) }
    }
    eng.onFrame = proj => {
      lastProj.current = proj
      const mag = magOf.current
      const placed: [number, number, number, number][] = []
      for (const p of [...proj].sort((a, b) => (mag.get(a.hip) ?? 9) - (mag.get(b.hip) ?? 9))) {
        const el = labels.current.get(p.hip)
        if (!el) continue
        if (!p.visible) { el.style.opacity = '0'; continue }
        el.style.opacity = ''
        el.style.transform = `translate3d(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px, 0)`
        const text = el.querySelector('span')
        if (!text) continue
        const w = text.offsetWidth || 80
        const r: [number, number, number, number] = [p.x + 12, p.y - 26, w + 6, 22]
        const clash = placed.some(o => r[0] < o[0] + o[2] && r[0] + r[2] > o[0] && r[1] < o[1] + o[3] && r[1] + r[3] > o[1])
        text.style.visibility = clash && !el.classList.contains('on') ? 'hidden' : ''
        if (!clash) placed.push(r)
      }
    }
    return () => { ro.disconnect(); eng.dispose(); engine.current = null }
  }, [cat])

  const figure = cat?.figures.find(f => f.abbr === abbr)
  const figStars = useMemo(() => (cat && figure ? starsOf(cat, figure.lines) : []), [cat, figure])
  const kin = useMemo(() => analyse(figStars), [figStars])
  useEffect(() => { magOf.current = new Map(figStars.map(st => [st.hip, st.vmag])) }, [figStars])
  // the star you point at or pick grows into a big turning sphere
  useEffect(() => { engine.current?.setBodyFocus(focus ?? hover) }, [focus, hover])

  const show = useCallback((a: string | null, opts: { kin?: boolean; fly?: number; zoom?: number; home?: boolean } = {}) => {
    const eng = engine.current
    if (!eng || !cat) return
    const f = a ? cat.figures.find(x => x.abbr === a) : null
    if (!f) { eng.setFigure([], [], null, KIN_COLORS); return }
    const stars = starsOf(cat, f.lines)
    const k = analyse(stars)
    eng.setFigure(stars, f.lines, opts.kin === false ? null : k?.groupOf ?? null, KIN_COLORS)
    const fr = frameStars(stars, canvas.current ? canvas.current.clientWidth / Math.max(1, canvas.current.clientHeight) : 1.6)
    // in the explorer the story (left) and star tiles (right) cover the sides, so frame into the middle gap
    const sides = eng.offsetTargetX > 0.01 && window.innerWidth > 1100 ? 1.55 : 1
    eng.frameScale = (opts.zoom ?? 1) * 1.12 * sides
    const target = { ...fr, fov: Math.min(110, fr.fov * eng.frameScale) }
    if (opts.home !== false) eng.setHome(target, true, opts.fly ?? 2600)
    else eng.flyTo(target, opts.fly ?? 2600)
  }, [cat])

  // ---------------------------------------------------------------- the opening film
  useEffect(() => {
    const eng = engine.current
    if (mode !== 'film' || !eng || !cat) return
    const s: Shot = SCRIPT[shot]
    eng.autoDrift = false
    eng.setOffset(0, window.innerHeight < 820 ? -0.2 : -0.15)
    if (s.cam) eng.flyTo(s.cam, s.fly)
    if (s.figure !== undefined) {
      if (s.figure) {
        setAbbr(s.figure)
        show(s.figure, { kin: !!s.kin, fly: s.fly, zoom: s.zoom })
      } else show(null)
    }
    if (s.frame && s.figure === undefined) show(s.frame, { fly: s.fly, zoom: s.zoom })
    eng.showAllFigures(!!s.allFigures)
    setLabelMode(s.labels ?? null)
    if (s.time) {
      const tm = s.time
      window.setTimeout(() => eng.animateTime(tm.to, tm.ms, tm.back ? () => eng.animateTime(0, 1800) : undefined), s.fly)
    } else eng.setTime(0)
    const next = window.setTimeout(() => {
      if (shot + 1 < SCRIPT.length) setShot(shot + 1)
      else setMode('title')
    }, s.hold)
    return () => clearTimeout(next)
  }, [mode, shot, cat, show])

  useEffect(() => {
    if (mode !== 'title') return
    const t = window.setTimeout(() => enterApp(), TITLE_HOLD_MS)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  const enterApp = useCallback(() => {
    const eng = engine.current
    setMode('app')
    setLabelMode('names')
    if (eng) {
      eng.setOffset(window.innerWidth > 1100 ? 0.05 : 0, window.innerWidth > 1100 ? 0 : 0.08)
      eng.showAllFigures(false)
      eng.setTime(0)
      eng.autoDrift = true
    }
  }, [])

  // entering the explorer (or arriving directly): frame the current constellation
  useEffect(() => {
    if (mode !== 'app' || !cat || !engine.current) return
    engine.current.autoDrift = true
    engine.current.setOffset(window.innerWidth > 1100 ? 0.05 : 0, window.innerWidth > 1100 ? 0 : 0.08)
    show(abbr, { fly: 2200 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, cat])

  const choose = (a: string) => {
    setAbbr(a)
    setFocus(null)
    setPicker(false)
    setPlaying(false)
    engine.current?.setTime(0)
    show(a)
  }

  // ---------------------------------------------------------------- time-lapse
  const play = () => {
    const eng = engine.current
    if (!eng) return
    if (playing) { eng.stopTime(); setPlaying(false); return }
    const start = eng.t >= 0.999 ? -1 : eng.t
    eng.setTime(start)
    setPlaying(true)
    eng.animateTime(1, TIMELAPSE_MS * (1 - start) / 2, () => setPlaying(false))
  }
  const jump = (to: number) => { setPlaying(false); engine.current?.animateTime(to, 2600) }

  // ---------------------------------------------------------------- pointer
  useEffect(() => {
    const cv = canvas.current
    if (!cv || mode !== 'app') return
    let drag: { x: number; y: number; moved: boolean } | null = null
    const pts = new Map<number, [number, number]>()
    let pinch = 0
    const hit = (x: number, y: number) => {
      let best: number | null = null, bd = 22
      for (const p of lastProj.current) {
        if (!p.visible) continue
        const d = Math.hypot(p.x - x, p.y - y)
        if (d < bd) { bd = d; best = p.hip }
      }
      return best
    }
    const pause = () => { engine.current?.touch(); setPaused(true) }
    const down = (e: PointerEvent) => {
      cv.setPointerCapture(e.pointerId)
      pts.set(e.pointerId, [e.clientX, e.clientY])
      drag = { x: e.clientX, y: e.clientY, moved: false }
      pause()
      if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = Math.hypot(a[0] - b[0], a[1] - b[1]) }
    }
    const move = (e: PointerEvent) => {
      const r = cv.getBoundingClientRect()
      if (!drag) { const h = hit(e.clientX - r.left, e.clientY - r.top); setHover(h); cv.style.cursor = h != null ? 'pointer' : 'grab'; return }
      pts.set(e.pointerId, [e.clientX, e.clientY])
      if (pts.size === 2) {
        const [a, b] = [...pts.values()]
        const d = Math.hypot(a[0] - b[0], a[1] - b[1])
        if (pinch > 0) engine.current?.zoomBy(pinch / d)
        pinch = d
        drag.moved = true
        pause()
        return
      }
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y
      if (!drag.moved && Math.hypot(dx, dy) < 4) return
      drag.moved = true
      drag.x = e.clientX; drag.y = e.clientY
      cv.style.cursor = 'grabbing'
      engine.current?.pan(dx, dy)
      pause()
    }
    const up = (e: PointerEvent) => {
      pts.delete(e.pointerId)
      if (pts.size < 2) pinch = 0
      if (drag && !drag.moved) {
        const r = cv.getBoundingClientRect()
        const h = hit(e.clientX - r.left, e.clientY - r.top)
        setFocus(f => (h === null ? null : f === h ? null : h))
      }
      if (pts.size === 0) { drag = null; cv.style.cursor = 'grab' }
    }
    const wheel = (e: WheelEvent) => { e.preventDefault(); engine.current?.zoomBy(Math.exp(e.deltaY * 0.0012)); pause() }
    cv.addEventListener('pointerdown', down)
    cv.addEventListener('pointermove', move)
    cv.addEventListener('pointerup', up)
    cv.addEventListener('pointercancel', up)
    cv.addEventListener('wheel', wheel, { passive: false })
    return () => {
      cv.removeEventListener('pointerdown', down)
      cv.removeEventListener('pointermove', move)
      cv.removeEventListener('pointerup', up)
      cv.removeEventListener('pointercancel', up)
      cv.removeEventListener('wheel', wheel)
    }
  }, [mode])

  // the "paused" hint disappears when the drift resumes
  useEffect(() => {
    if (!paused) return
    const id = window.setInterval(() => { if ((engine.current?.idleFor ?? 0) > (engine.current?.idleResumeMs ?? 30000)) setPaused(false) }, 1000)
    return () => clearInterval(id)
  }, [paused])

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return
      if (e.key === 'Escape') { setFocus(null); setPicker(false); setInfo(false); setResearch(false) }
      if (mode === 'app' && e.key === ' ') { e.preventDefault(); play() }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  })

  // ---------------------------------------------------------------- render
  if (error) return <div className="sl sl-center"><p>couldn’t load the sky: {error}</p></div>

  const all = cat ? cat.figures.map(f => ({ f, kin: analyse(starsOf(cat, f.lines)) })) : []
  const shown = all.filter(r => !query || `${r.f.name} ${r.f.english}`.toLowerCase().includes(query.toLowerCase()))
  const s = SCRIPT[shot]
  const focusStar = focus != null ? cat?.stars.get(focus) : hover != null ? cat?.stars.get(hover) : undefined

  return (
    <div className={`sl sl-${mode}`}>
      <canvas ref={canvas} className="sl-sky" aria-label="the night sky seen from earth" />
      {!cat && <div className="sl-center"><p className="sl-soft">opening the sky…</p></div>}

      {/* star labels, positioned every frame by the engine */}
      <div className="sl-labels" aria-hidden>
        {figStars.map(st => {
          const gi = kin?.groupOf.get(st.hip)
          const showFamily = mode === 'app' || s?.kin
          const on = focus === st.hip || hover === st.hip
          const named = labelMode && (on || (st.name && st.vmag < 3.8) || (figStars.length <= 7 && st.vmag < 5))
          return (
            <div key={`${abbr}-${st.hip}`} className={`sl-label ${on ? 'on' : ''}`}
              ref={el => { if (el) labels.current.set(st.hip, el); else labels.current.delete(st.hip) }}>
              {showFamily && gi !== undefined && <i className="sl-ring" style={{ borderColor: KIN_COLORS[gi % KIN_COLORS.length] }} />}
              {named && (
                <span>
                  {st.label}
                  {(labelMode === 'distance' || mode === 'app') && <em> {ly(st.dist)} ly</em>}
                </span>
              )}
            </div>
          )
        })}
      </div>

      {/* --------------------------------------------- the film: captions */}
      {mode === 'crash' && <StarCollision onDone={() => setMode('film')} />}

      {mode === 'film' && cat && (
        <>
          <div className="sl-caption" key={shot}>
            <span className="sl-era">{s.era}</span>
            <p>{s.text}</p>
          </div>
          <div className="sl-progress">{SCRIPT.map((_, i) => <i key={i} className={i < shot ? 'done' : i === shot ? 'on' : ''} />)}</div>
          <button className="sl-skip" onClick={enterApp}>skip the film →</button>
        </>
      )}
      {mode === 'title' && (
        <div className="sl-title" onClick={enterApp}>
          <h1>{'solaria'.split('').map((c, i) => <span key={i} style={{ animationDelay: `${120 + i * 90}ms` }}>{c}</span>)}</h1>
          <p>constellations, seen from earth</p>
          <button className="sl-enter">enter the sky</button>
        </div>
      )}

      {/* --------------------------------------------- the explorer overlay */}
      {mode === 'app' && cat && figure && kin && (
        <>
          <header className="sl-brand">
            <b>solaria</b><span>constellations, seen from earth</span>
          </header>

          <section className="sl-story" aria-live="polite">
            <h2 key={abbr}>{figure.name.toLowerCase()}</h2>
            {figure.english && <p className="sl-english">{figure.english.toLowerCase()}</p>}
            {Math.abs(tState) < 0.004 ? (
              <>
                <p className="sl-verdict" style={{ color: VERDICT_COLORS[kin.verdict] }}>{VERDICT_WORD[kin.verdict]}</p>
                <p className="sl-line">{storyLine(kin)}</p>
                <p className="sl-line sl-dim">
                  its stars are {ly(kin.nearest.dist)} to {ly(kin.farthest.dist)} light-years away
                  {kin.depthRatio > 1.5 && <> · {kin.depthRatio >= 10 ? Math.round(kin.depthRatio) : kin.depthRatio.toFixed(1)}× deeper than it looks</>}
                </p>
                {kin.nUndetermined > 0 && <p className="sl-line sl-dim">{kin.nUndetermined} nearby pair{kin.nUndetermined > 1 ? 's' : ''} can’t be decided yet: velocities too uncertain</p>}
              </>
            ) : (
              <>
                <p className="sl-verdict sl-when">{timeWords(tState)}</p>
                <p className="sl-line">{kin.nKin ? 'the families drift as one. the strangers wander off.' : 'every star goes its own way. the shape dissolves.'}</p>
              </>
            )}
          </section>

          <StarTiles stars={figStars} kin={kin} focus={focus ?? hover} hidden={focus != null}
            onHover={setHover} onPick={h => setFocus(f => (f === h ? null : h))} />

          {/* hover: a quick note. click: the star's full story, step by step */}
          {focus != null && cat.stars.get(focus)
            ? <StarJourney star={cat.stars.get(focus)!} constellation={figStars} catalog={cat.all}
                travelsWith={new Set(kin.groups[kin.groupOf.get(focus) ?? -1] ?? [])}
                onClose={() => setFocus(null)} onPick={h => setFocus(h)} onFamily={id => { setFocus(null); setFamily(id) }} />
            : focusStar && <StarNote star={focusStar} others={figStars} />}
          <Families engine={engine} selected={family} onSelect={setFamily} />
          <EarthGlobe />

          <nav className="sl-picker">
            {FEATURED.filter(a => cat.figures.some(f => f.abbr === a)).map(a => (
              <button key={a} className={a === abbr ? 'on' : ''} onClick={() => choose(a)}>
                {cat.figures.find(f => f.abbr === a)!.name.toLowerCase()}
              </button>
            ))}
            <button className={picker ? 'on' : ''} onClick={() => setPicker(p => !p)}>all {cat.figures.length} ↗</button>
          </nav>

          <div className="sl-time">
            <button onClick={() => jump(-1)} title="one million years ago">← 1 million years ago</button>
            <button className="sl-play" onClick={play} aria-label={playing ? 'pause time-lapse' : 'play time-lapse'}>{playing ? '❚❚' : '▶'}</button>
            <span ref={timeEl} className="sl-now">today</span>
            {Math.abs(tState) > 0.004 && <button onClick={() => jump(0)}>back to today</button>}
            <button onClick={() => jump(1)} title="one million years from now">1 million years ahead →</button>
          </div>

          <div className="sl-corner">
            {paused && <span className="sl-hint">camera paused · drifts again after 30 s</span>}
            <button onClick={() => setResearch(r => !r)} className={research ? 'on' : ''}>data</button>
            <button onClick={() => setInfo(i => !i)} className={info ? 'on' : ''}>how do we know?</button>
            <button onClick={() => { setShot(0); setMode('film') }}>replay the film</button>
          </div>

          {picker && (
            <div className="sl-overlay" onClick={() => setPicker(false)}>
              <div className="sl-overlay-in" onClick={e => e.stopPropagation()}>
                <input autoFocus placeholder="search a star or constellation…" value={query} onChange={e => setQuery(e.target.value)} />
                {query.trim().length > 1 && (
                  <div className="sj-found">
                    {cat.all.filter(st => st.name?.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 8).map(st => {
                      const home = cat.figures.find(f => f.lines.some(seg => seg.includes(st.hip)))
                      return home && (
                        <button key={st.hip} onClick={() => { choose(home.abbr); setFocus(st.hip) }}>
                          {st.label}<small>in {home.name.toLowerCase()}</small>
                        </button>
                      )
                    })}
                  </div>
                )}
                <p className="sl-legend">
                  {(['family', 'mixed', 'illusion'] as const).map(k => (
                    <span key={k} style={{ color: VERDICT_COLORS[k] }}>{all.filter(r => r.kin?.verdict === k).length} {VERDICT_WORD[k]}</span>
                  ))}
                </p>
                <div className="sl-names">
                  {shown.map(r => (
                    <button key={r.f.abbr} onClick={() => choose(r.f.abbr)} className={r.f.abbr === abbr ? 'on' : ''}
                      style={{ color: r.kin ? VERDICT_COLORS[r.kin.verdict] : undefined }}>
                      {r.f.name.toLowerCase()}<small>{r.f.english.toLowerCase()}</small>
                    </button>
                  ))}
                  {!shown.length && <p className="sl-soft">nothing matches “{query}”</p>}
                </div>
              </div>
            </div>
          )}

          {info && <HowWeKnow name={figure.name.toLowerCase()} stars={figStars} kin={kin} sources={cat.sources} skySource={cat.skySource} onClose={() => setInfo(false)} />}
          {research && (
            <div className="sl-research">
              <button className="sl-x" onClick={() => setResearch(false)} aria-label="close">×</button>
              <ResearchPanel key={abbr} name={figure.name.toLowerCase()} stars={figStars} kin={kin} focus={focus ?? hover}
                onFocus={setFocus} sources={cat.sources} />
            </div>
          )}
        </>
      )}
    </div>
  )
}

function storyLine(kin: Kinship) {
  if (kin.verdict === 'illusion') return 'none of these stars are related. they only line up from where we stand.'
  return `${kin.nKin} of ${kin.n} stars move through space together: they were born together.`
}

function StarNote({ star, others }: { star: Star; others: Star[] }) {
  const year = new Date().getFullYear() - star.dist * 3.26156
  const twin = others.filter(o => o.hip !== star.hip).map(o => ({ o, p: pairInfo(star, o) }))
    .filter(x => x.p.comoving).map(x => x.o.label)
  return (
    <div className="sl-note">
      <h3><i style={{ background: bvColor(star.bv) }} />{star.label}</h3>
      <p><b>{ly(star.dist)}</b> light-years away <span>± {ly(star.distErr)}</span></p>
      <p><b>{Math.hypot(...star.vel).toFixed(0)}</b> km/s through space{star.hasRv ? '' : ' (sideways motion only)'}</p>
      <p>the light you see left it {year < 0 ? `around ${Math.round(-year).toLocaleString('en-US')} bc` : `in ${Math.round(year)}`}</p>
      {star.spType && <p className="sl-dim">spectral type {star.spType}</p>}
      {twin.length > 0 && <p className="sl-dim">moves with {twin.join(', ')}</p>}
      {star.group && <p className="sl-dim">literature group: {star.group}</p>}
    </div>
  )
}
