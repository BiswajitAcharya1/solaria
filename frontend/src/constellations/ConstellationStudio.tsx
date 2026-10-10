import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import SkyCanvas, { type View } from './SkyCanvas'
import Backdrop from './Backdrop'
import Splash from './Splash'
import { DepthSwarm, ImpactRing, KinDonut, LightTimeline, Thumb } from './Viz'
import {
  type Catalog, type Kinship, type Sketch, type Star, KIN_COLORS, VERDICT_COLORS, analyse, bvColor, figureHips,
  loadCatalog, lookAt, ly, sketch,
} from './data'
import './studio.css'

const FEATURED = ['UMa', 'Ori', 'Cas', 'Sco', 'Tau']
const TIME_STOPS = [-1, -0.5, 0, 0.5, 1]
const VERDICT_WORD = { family: 'real family', mixed: 'partly family', illusion: 'pure illusion' }
type Stage = 'title' | 'flat' | 'depth' | 'kin'

const timeWords = (t: number) => {
  if (Math.abs(t) < 0.005) return 'today'
  const yrs = Math.abs(t) >= 0.995 ? '1 million years' : `${Math.round(Math.abs(t) * 1000).toLocaleString()},000 years`
  return t < 0 ? `${yrs} ago` : `${yrs} from now`
}

const starsOf = (cat: Catalog, lines: number[][]) =>
  figureHips(lines).map(h => cat.stars.get(h)).filter((s): s is Star => !!s)

export default function ConstellationStudio() {
  const [cat, setCat] = useState<Catalog | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [splash, setSplash] = useState(true)
  const [abbr, setAbbr] = useState('UMa')
  const [building, setBuilding] = useState(false)
  const [custom, setCustom] = useState<number[][]>([])
  const [pending, setPending] = useState<number | null>(null)
  const [unfold, setUnfold] = useState(0)
  const [unfoldTarget, setUnfoldTarget] = useState<number | null>(null)
  const [tMyr, setT] = useState(0)
  const [tTween, setTTween] = useState<{ to: number; rate: number } | null>(null)
  const [view, setView] = useState<View>({ ra: 180, dec: 55, yaw: 0, pitch: 0, zoom: 1 })
  const [hover, setHover] = useState<{ hip: number; x: number; y: number } | null>(null)
  const [focus, setFocus] = useState<number | null>(null)
  const [stage, setStage] = useState<Stage>('title')
  const [gallery, setGallery] = useState(false)
  const [query, setQuery] = useState('')
  const [info, setInfo] = useState(false)
  const [card, setCard] = useState(true)
  const timers = useRef<number[]>([])

  useEffect(() => { loadCatalog().then(setCat, e => setError(String(e.message ?? e))) }, [])

  const fig = cat?.figures.find(f => f.abbr === abbr)
  const lines = useMemo(() => (building ? custom : fig?.lines ?? []), [building, custom, fig])
  const figStars = useMemo(() => (cat ? starsOf(cat, lines) : []), [cat, lines])
  const kin = useMemo(() => analyse(figStars), [figStars])

  // every constellation, pre-analysed: thumbnails + the headline numbers
  const all = useMemo(() => {
    if (!cat) return null
    const rows = cat.figures.map(f => ({ f, sk: sketch(cat.stars, f.lines), kin: analyse(starsOf(cat, f.lines)) }))
    const counts = { family: 0, mixed: 0, illusion: 0 }
    rows.forEach(r => { if (r.kin) counts[r.kin.verdict]++ })
    return { rows, by: new Map(rows.map(r => [r.f.abbr, r])), counts }
  }, [cat])

  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = [] }
  const later = (ms: number, fn: () => void) => { timers.current.push(window.setTimeout(fn, ms)) }

  // the guided reveal: arrive, see the flat figure, then unfold it and show who is related
  const reveal = useCallback(() => {
    clearTimers()
    setStage('title')
    later(1300, () => setStage('flat'))
    later(3300, () => { setStage('depth'); setUnfoldTarget(1) })
    later(6600, () => setStage('kin'))
  }, [])

  const choose = useCallback((a: string, andReveal = true) => {
    if (!cat) return
    const f = cat.figures.find(x => x.abbr === a)
    if (!f) return
    clearTimers()
    setAbbr(a)
    setBuilding(false)
    setPending(null)
    setFocus(null)
    setT(0)
    setTTween(null)
    setUnfold(0)
    setUnfoldTarget(null)
    setGallery(false)
    setView({ ...lookAt(starsOf(cat, f.lines)), yaw: 0, pitch: 0, zoom: 1 })
    if (andReveal) reveal()
  }, [cat, reveal])

  // aim at the first constellation behind the splash, reveal once the splash lifts
  const aimed = useRef(false)
  useEffect(() => { if (cat && !aimed.current) { aimed.current = true; choose(abbr, false) } }, [cat, abbr, choose])
  const endSplash = useCallback(() => { setSplash(false); reveal() }, [reveal])
  useEffect(() => clearTimers, [])

  // tweens (time-based, so they stay smooth even when frames are throttled)
  useEffect(() => {
    if (unfoldTarget === null) return
    let raf = 0, last = performance.now()
    const step = (now: number) => {
      const dt = (now - last) / 1000
      last = now
      setUnfold(u => {
        const next = u < unfoldTarget ? Math.min(unfoldTarget, u + dt / 1.8) : Math.max(unfoldTarget, u - dt / 1.8)
        if (next === unfoldTarget) setUnfoldTarget(null)
        return next
      })
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [unfoldTarget])

  useEffect(() => {
    if (!tTween) return
    let raf = 0, last = performance.now()
    const step = (now: number) => {
      const dt = (now - last) / 1000
      last = now
      setT(t => {
        const next = t < tTween.to ? Math.min(tTween.to, t + dt * tTween.rate) : Math.max(tTween.to, t - dt * tTween.rate)
        if (next === tTween.to) setTTween(null)
        return next
      })
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [tTween])

  const goEarth = () => { clearTimers(); setUnfoldTarget(0); setStage('flat') }
  const go3d = () => { clearTimers(); setUnfoldTarget(1); setStage('depth'); later(2600, () => setStage('kin')) }
  const timeTo = (to: number) => setTTween({ to, rate: 0.9 })
  const playing = tTween !== null && tTween.rate < 0.5
  const play = () => {
    if (playing) { setTTween(null); return }
    if (tMyr >= 0.999) setT(-1)
    setTTween({ to: 1, rate: 0.22 })
  }

  const startBuild = () => {
    clearTimers()
    setBuilding(true)
    setCustom([])
    setPending(null)
    setFocus(null)
    setUnfold(0)
    setUnfoldTarget(null)
    setT(0)
    setTTween(null)
    setGallery(false)
    setView(v => ({ ...v, yaw: 0, pitch: 0, zoom: 1 }))
  }

  const onStarClick = useCallback((hip: number | null) => {
    if (!building) { setFocus(f => (f === hip ? null : hip)); return }
    if (hip === null || hip === pending) { setPending(null); return }
    if (pending !== null) setCustom(c => [...c, [pending, hip]])
    setPending(hip)
  }, [building, pending])

  const undo = useCallback(() => {
    setCustom(c => {
      const next = c.slice(0, -1)
      setPending(next.length ? next[next.length - 1][1] : null)
      return next
    })
  }, [])

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || splash) return
      if (e.key === 'Escape') { setPending(null); setFocus(null); setGallery(false); setInfo(false) }
      if (building && (e.key === 'Backspace' || (e.key === 'z' && (e.metaKey || e.ctrlKey)))) { e.preventDefault(); undo() }
      if (e.key === ' ') { e.preventDefault(); if (unfold > 0.5) goEarth(); else go3d() }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }) // re-bound each render so it sees current state

  const onHover = useCallback((hip: number | null, x: number, y: number) => setHover(hip == null ? null : { hip, x, y }), [])
  const onInteract = useCallback(() => {}, [])

  if (error) return <div className="cx cx-center"><p>couldn’t load the sky: {error}</p></div>

  const name = building ? 'your constellation' : (fig?.name ?? '').toLowerCase()
  const viewMoved = Math.abs(view.yaw) > 1e-3 || Math.abs(view.pitch) > 1e-3 || Math.abs(view.zoom - 1) > 1e-3
  const hoverStar = hover && cat ? cat.stars.get(hover.hip) : undefined
  const canUnfold = figStars.length >= 2
  const narration = narrate({ building, custom, figStars, kin, stage, tMyr, name, english: fig?.english ?? '', unfold })
  const shown = all?.rows.filter(r => !query || `${r.f.name} ${r.f.english}`.toLowerCase().includes(query.toLowerCase())) ?? []

  return (
    <div className="cx">
      <Backdrop dim={!splash} faint={building} />
      {cat && all && !splash && (
        <>
          <SkyCanvas
            all={cat.all} figure={figStars} lines={lines} kin={kin} unfold={unfold} tMyr={tMyr}
            view={view} onView={setView} onInteract={onInteract} building={building} pending={pending}
            focus={focus ?? hover?.hip ?? null} onStarClick={onStarClick} onHover={onHover}
          />

          <header className="cx-brand">
            <span className="cx-logo" aria-hidden>✦</span>
            <div><h1>solaria</h1><p>constellations, unfolded</p></div>
          </header>

          <div className="cx-corner">
            {viewMoved && <button className="cx-circle" onClick={() => setView(v => ({ ...v, yaw: 0, pitch: 0, zoom: 1 }))} title="reset view">⟲</button>}
            <button className={`cx-circle ${info ? 'on' : ''}`} onClick={() => setInfo(i => !i)} title="how do we know?">i</button>
          </div>

          <Narration n={narration} />

          <nav className="cx-rail" aria-label="constellations">
            {FEATURED.map(a => {
              const r = all.by.get(a)
              if (!r) return null
              return (
                <button key={a} className={`cx-orb ${!building && abbr === a ? 'on' : ''}`} onClick={() => choose(a)}
                  aria-label={r.f.name.toLowerCase()}
                  style={{ '--ring': r.kin ? VERDICT_COLORS[r.kin.verdict] : '#888' } as React.CSSProperties}>
                  <Thumb sk={r.sk} size={50} />
                  <span className="cx-orb-label">{r.f.name.toLowerCase()}</span>
                </button>
              )
            })}
            <span className="cx-rail-sep" />
            <button className={`cx-orb cx-orb-icon ${gallery ? 'on' : ''}`} onClick={() => setGallery(g => !g)} aria-label="all constellations">
              <GridIcon /><span className="cx-orb-label">all {all.rows.length}</span>
            </button>
            <button className={`cx-orb cx-orb-icon draw ${building ? 'on' : ''}`} onClick={startBuild} aria-label="draw your own">
              <PenIcon /><span className="cx-orb-label">draw your own</span>
            </button>
          </nav>

          {card && kin && figStars.length >= 2 && (
            <DataCard key={building ? 'build' : abbr} name={name} kin={kin} stars={figStars} focus={focus ?? hover?.hip ?? null}
              setFocus={setFocus} onClose={() => setCard(false)} />
          )}
          {!card && <button className="cx-circle cx-card-open" onClick={() => setCard(true)} title="show the data">◔</button>}

          <div className="cx-dock">
            <div className="cx-seg" role="group" aria-label="viewpoint">
              <span className="cx-seg-thumb" style={{ transform: `translateX(${unfold * 100}%)` }} />
              <button className={unfold < 0.5 ? 'on' : ''} onClick={goEarth} disabled={!canUnfold}><EarthIcon />earth view</button>
              <button className={unfold >= 0.5 ? 'on' : ''} onClick={go3d} disabled={!canUnfold}><CubeIcon />3d</button>
            </div>

            <div className="cx-time" role="group" aria-label="time">
              <button className="cx-play" onClick={play} aria-label={playing ? 'pause' : 'play through time'}>{playing ? '❚❚' : '▶'}</button>
              <div className="cx-stops">
                <span className="cx-stops-glow" style={{ left: `${((tMyr + 1) / 2) * 100}%` }} />
                {TIME_STOPS.map(v => (
                  <button key={v} className={Math.abs(tMyr - v) < 0.01 ? 'on' : ''} onClick={() => timeTo(v)}
                    title={timeWords(v)}>{v === 0 ? 'now' : `${v > 0 ? '+' : '−'}${Math.abs(v) === 1 ? '1m' : '500k'}`}</button>
                ))}
              </div>
            </div>

            {building && (
              <div className="cx-build-tools">
                <button className="cx-circle" onClick={undo} disabled={!custom.length} title="undo">↶</button>
                <button className="cx-circle" onClick={() => { setCustom([]); setPending(null) }} disabled={!custom.length} title="clear">✕</button>
                <button className="cx-pill-btn" onClick={() => choose(abbr)}>done</button>
              </div>
            )}
          </div>

          {hoverStar && hover && (
            <Tooltip star={hoverStar} x={hover.x} y={hover.y} kinIdx={kin?.groupOf.get(hoverStar.hip)} building={building}
              inFigure={figStars.some(s => s.hip === hoverStar.hip)} />
          )}

          {gallery && (
            <div className="cx-sheet-wrap" onClick={() => setGallery(false)}>
              <section className="cx-sheet" onClick={e => e.stopPropagation()} aria-label="all constellations">
                <div className="cx-sheet-head">
                  <ImpactRing counts={all.counts} />
                  <div className="cx-impact-legend">
                    <h2>{all.counts.illusion} of {all.rows.length} constellations are pure illusion</h2>
                    {(['family', 'mixed', 'illusion'] as const).map(k => (
                      <div key={k}><i style={{ background: VERDICT_COLORS[k] }} /><b>{all.counts[k]}</b>{VERDICT_WORD[k]}</div>
                    ))}
                    <input className="cx-search" placeholder="search the sky…" value={query} autoFocus onChange={e => setQuery(e.target.value)} />
                  </div>
                  <button className="cx-circle cx-sheet-x" onClick={() => setGallery(false)} aria-label="close">✕</button>
                </div>
                <div className="cx-grid">
                  {shown.map((r, i) => (
                    <button key={r.f.abbr} className={`cx-tile ${!building && r.f.abbr === abbr ? 'on' : ''}`} onClick={() => choose(r.f.abbr)}
                      style={{ '--ring': r.kin ? VERDICT_COLORS[r.kin.verdict] : '#888', animationDelay: `${Math.min(i, 40) * 12}ms` } as React.CSSProperties}>
                      <span className="cx-tile-orb"><Thumb sk={r.sk as Sketch} size={64} /></span>
                      <span>{r.f.name.toLowerCase()}</span>
                    </button>
                  ))}
                  {!shown.length && <p className="cx-dim">nothing matches “{query}”</p>}
                </div>
              </section>
            </div>
          )}

          {info && <InfoCard sources={cat.sources} onClose={() => setInfo(false)} />}
        </>
      )}

      {splash && <Splash cat={cat} onDone={endSplash} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// The interface narrates what the data shows, one short line at a time.
// ---------------------------------------------------------------------------
interface Line { big?: string; text: string; tone?: string }

function narrate(o: {
  building: boolean; custom: number[][]; figStars: Star[]; kin: Kinship | null; stage: Stage; tMyr: number
  name: string; english: string; unfold: number
}): Line {
  const { kin } = o
  if (o.building) {
    if (!o.custom.length) return { big: 'draw your own', text: 'tap any star, then another, to connect them' }
    if (!kin || o.figStars.length < 2) return { text: 'now tap a second star' }
  }
  if (Math.abs(o.tMyr) > 0.005 && kin) {
    return {
      big: timeWords(o.tMyr),
      text: kin.nKin ? 'the family drifts as one. the strangers wander off.' : 'every star goes its own way. the shape falls apart.',
    }
  }
  if (!kin) return { text: '' }
  const verdictLine = kin.verdict === 'illusion'
    ? 'none of them are related. it only looks this way from earth.'
    : `${kin.nKin} of ${kin.n} stars move together. they were born together.`
  if (o.building) return { big: VERDICT_WORD[kin.verdict], text: verdictLine, tone: VERDICT_COLORS[kin.verdict] }
  switch (o.stage) {
    case 'title': return { big: o.name, text: o.english.toLowerCase() }
    case 'flat': return { text: `from earth, ${o.name} looks flat` }
    case 'depth': return { text: `but its stars are ${ly(kin.nearest.dist)} to ${ly(kin.farthest.dist)} light-years away` }
    default: return { big: VERDICT_WORD[kin.verdict], text: verdictLine, tone: VERDICT_COLORS[kin.verdict] }
  }
}

function Narration({ n }: { n: Line }) {
  return (
    <div className="cx-narration" key={`${n.big}|${n.text}`} aria-live="polite">
      {n.big && <h2 style={n.tone ? { color: n.tone } : undefined}>{n.big}</h2>}
      {n.text && <p>{n.text}</p>}
    </div>
  )
}

function DataCard({ name, kin, stars, focus, setFocus, onClose }: {
  name: string; kin: Kinship; stars: Star[]; focus: number | null; setFocus: (h: number | null) => void; onClose: () => void
}) {
  const byHip = new Map(stars.map(s => [s.hip, s]))
  return (
    <aside className="cx-card">
      <div className="cx-card-head">
        <h2>{name}</h2>
        <span className="cx-verdict" style={{ color: VERDICT_COLORS[kin.verdict], borderColor: VERDICT_COLORS[kin.verdict] }}>
          {VERDICT_WORD[kin.verdict]}
        </span>
        <button className="cx-circle sm" onClick={onClose} aria-label="hide">–</button>
      </div>

      <div className="cx-card-hero">
        <KinDonut kin={kin} stars={stars} />
        <div className="cx-ratio">
          <b>{kin.depthRatio >= 10 ? Math.round(kin.depthRatio) : kin.depthRatio.toFixed(1)}×</b>
          <span>deeper than it looks</span>
          <div className="cx-ratio-bars">
            <i style={{ width: `${Math.max(4, 100 / kin.depthRatio)}%` }} />
            <i style={{ width: '100%' }} />
          </div>
        </div>
      </div>

      <div className="cx-card-sec">
        <h3><span>↔</span>how far away</h3>
        <DepthSwarm stars={stars} kin={kin} focus={focus} onFocus={setFocus} />
      </div>

      <div className="cx-card-sec">
        <h3><span>✧</span>when tonight’s light set off</h3>
        <LightTimeline stars={stars} kin={kin} focus={focus} onFocus={setFocus} />
      </div>

      {kin.groups.length > 0 && (
        <div className="cx-card-sec">
          <h3><span>⇉</span>travelling together</h3>
          {kin.groups.map((g, i) => (
            <div key={i} className="cx-family" style={{ '--c': KIN_COLORS[i % KIN_COLORS.length] } as React.CSSProperties}>
              {g.map(h => byHip.get(h)).filter((s): s is Star => !!s).map(s => (
                <span key={s.hip} className={focus === s.hip ? 'on' : ''} onMouseEnter={() => setFocus(s.hip)} onMouseLeave={() => setFocus(null)}>
                  {s.label.toLowerCase()}
                </span>
              ))}
            </div>
          ))}
        </div>
      )}
    </aside>
  )
}

function Tooltip({ star, x, y, kinIdx, inFigure, building }: {
  star: Star; x: number; y: number; kinIdx?: number; inFigure: boolean; building: boolean
}) {
  const year = new Date().getFullYear() - star.dist * 3.26156
  return (
    <div className="cx-tip" style={{ left: x + 18, top: y + 14 }}>
      <div className="cx-tip-name"><i style={{ background: bvColor(star.bv) }} />{star.label.toLowerCase()}</div>
      <div className="cx-tip-row"><b>{ly(star.dist)}</b> light-years</div>
      <div className="cx-tip-row"><b>{Math.hypot(...star.vel).toFixed(0)}</b> km/s</div>
      <div className="cx-tip-row cx-dim">light left in {year < 0 ? `${Math.round(-year)} bc` : Math.round(year)}</div>
      {kinIdx !== undefined && <div className="cx-tip-kin" style={{ color: KIN_COLORS[kinIdx % KIN_COLORS.length] }}>● part of a family</div>}
      {building && <div className="cx-tip-row cx-dim">{inFigure ? 'tap to draw from here' : 'tap to add'}</div>}
    </div>
  )
}

function InfoCard({ sources, onClose }: { sources: Record<string, string>; onClose: () => void }) {
  return (
    <aside className="cx-info">
      <button className="cx-circle sm cx-info-x" onClick={onClose} aria-label="close">✕</button>
      <h2>how do we know?</h2>
      <ul>
        <li><b>distance</b> each star’s parallax: its tiny yearly wobble as earth orbits the sun.</li>
        <li><b>motion</b> its drift across the sky plus its speed toward or away from us, combined into a 3d velocity.</li>
        <li><b>family</b> two stars count as related when they move within 3 km/s of each other (or twice the measurement error) and sit within 163 light-years.</li>
        <li><b>time</b> straight-line motion over ±1 million years, accurate to well under a light-year.</li>
      </ul>
      <p className="cx-dim">{Object.values(sources).join(' · ').toLowerCase()}. bright-star radial velocities are partly a literature compilation (xhip), so treat single verdicts as indicative.</p>
      <button className="cx-replay" onClick={() => { location.search = '?intro' }}>↺ replay the history</button>
    </aside>
  )
}

const EarthIcon = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M2 8h12M8 1.8c2 2.2 2 10.2 0 12.4M8 1.8c-2 2.2-2 10.2 0 12.4" fill="none" stroke="currentColor" strokeWidth="1.1" /></svg>
)
const CubeIcon = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden><path d="M8 1.5l5.8 3.2v6.6L8 14.5l-5.8-3.2V4.7z M8 8l5.8-3.3M8 8L2.2 4.7M8 8v6.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /></svg>
)
const GridIcon = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>{[4, 10, 16].flatMap(x => [4, 10, 16].map(y => <circle key={`${x}${y}`} cx={x} cy={y} r="1.6" fill="currentColor" />))}</svg>
)
const PenIcon = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden><circle cx="4" cy="15" r="2" fill="currentColor" /><circle cx="10" cy="6" r="2" fill="currentColor" /><circle cx="16" cy="12" r="2" fill="currentColor" /><path d="M4 15L10 6l6 6" fill="none" stroke="currentColor" strokeWidth="1.3" strokeDasharray="2 2" /></svg>
)
