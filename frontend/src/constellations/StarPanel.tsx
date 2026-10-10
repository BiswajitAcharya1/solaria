// Tap a star, learn about it: what it is, how far, how bright, where it is in your sky tonight.
import { useEffect, useState, type CSSProperties } from 'react'
import { type Star, KIN_COLORS, bvColor, ly } from './data'
import { type Observer, altAz, cardinal, describe, fmtBig, riseSet } from './sky'
import { BreathingOrb, CloseButton, FlipText, haptic } from './Motion'

interface Props {
  star: Star
  constellations: string[]
  kinIdx?: number
  observer: Observer
  onClose: () => void
  onLook?: () => void
  onLocate: () => void
}

export default function StarPanel({ star, constellations, kinIdx, observer, onClose, onLook, onLocate }: Props) {
  const [leaving, setLeaving] = useState(false)
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(id) }, [])

  const info = describe(star)
  const col = bvColor(star.bv)
  const sky = altAz(star.ra, star.dec, observer, now)
  const rs = riseSet(star.ra, star.dec, observer, now)
  const lightLeft = new Date(now).getFullYear() - info.lightYears
  const where = constellations.length ? `in ${constellations.join(' & ').toLowerCase()}` : 'a background star'
  const close = () => { setLeaving(true); window.setTimeout(onClose, 200) }

  return (
    <aside className={`cx-star ${leaving ? 'leaving' : ''}`} style={{ '--c': col } as CSSProperties} aria-label={`about ${star.label}`}>
      <i className="sx-atmos" aria-hidden />
      <div className="cx-star-head">
        <BreathingOrb color={col} size={74} />
        <div className="cx-star-title">
          <h2>{star.label.toLowerCase()}</h2>
          <p><FlipText words={[info.kind, where, `${ly(star.dist)} light-years away`]} /></p>
        </div>
        <CloseButton onClose={close} />
      </div>

      <div className="cx-star-sky">
        <SkyDial az={sky.az} alt={sky.alt} />
        <div>
          {sky.alt > 0
            ? <><b>up now</b> · look <b>{cardinal(sky.az)}</b>, {Math.round(sky.alt)}° above the horizon</>
            : <><b>below the horizon</b> right now ({cardinal(sky.az)})</>}
          <div className="cx-dim">
            {rs.kind === 'always' ? 'never sets from where you are'
              : rs.kind === 'never' ? 'never rises from where you are'
              : `rises ${rs.rise} · sets ${rs.set}`}
          </div>
          {observer.approx && <button className="cx-link" onClick={() => { haptic(); onLocate() }}>approx. location · use mine</button>}
        </div>
      </div>

      <dl className="cx-facts">
        <Fact k="distance" v={`${ly(star.dist)} ly`} sub={`± ${ly(star.distErr)} ly`} />
        <Fact k="light left in" v={lightLeft < 0 ? `${Math.round(-lightLeft)} bc` : `${Math.round(lightLeft)}`} sub="what you see tonight" />
        <Fact k="surface" v={`${(Math.round(info.teff / 100) * 100).toLocaleString()} k`} sub={info.sunLike ? 'much like our sun' : `sun is 5,800 k`} />
        <Fact k="brightness" v={`${fmtBig(info.lumSun)}× sun`} sub={`magnitude ${star.vmag.toFixed(2)}`} />
        <Fact k="speed" v={`${info.speed.toFixed(0)} km/s`} sub={`${info.radial < 0 ? 'approaching' : 'receding'} at ${Math.abs(info.radial).toFixed(0)}`} />
        <Fact k="type" v={info.spType ?? '—'} sub={info.kind} />
        {star.ageGyr != null && <Fact k="age" v={`${star.ageGyr.toFixed(1)} bn yr`} sub="sun is 4.6" />}
        {star.feh != null && <Fact k="metals" v={`${(10 ** star.feh).toFixed(1)}× sun`} sub={`[fe/h] ${star.feh.toFixed(2)}`} />}
      </dl>

      {kinIdx !== undefined && (
        <div className="cx-star-kin" style={{ color: KIN_COLORS[kinIdx % KIN_COLORS.length] }}>● travels with a family of stars in this figure</div>
      )}

      <div className="cx-star-foot">
        <span className="cx-dim">hip {star.hip} · ra {star.ra.toFixed(2)}° · dec {star.dec.toFixed(2)}°</span>
        {onLook && <button className="sx-glow-btn" onClick={() => { haptic(); onLook() }}>◎ centre in sky</button>}
      </div>
    </aside>
  )
}

function Fact({ k, v, sub }: { k: string; v: string; sub?: string }) {
  return <div className="cx-fact"><dt>{k}</dt><dd>{v}</dd>{sub && <small>{sub}</small>}</div>
}

/** Tiny horizon dial: where to look (azimuth) and how high (dot distance from the rim). */
function SkyDial({ az, alt }: { az: number; alt: number }) {
  const r = 26, up = alt > 0
  const rr = up ? r * (1 - alt / 90) : r + 4
  const a = (az * Math.PI) / 180
  return (
    <svg className="cx-skydial" width="64" height="64" viewBox="-32 -32 64 64" aria-hidden>
      <circle r={r} className="ring" />
      <circle r={r / 2} className="ring faint" />
      {['n', 'e', 's', 'w'].map((c, i) => (
        <text key={c} x={Math.sin((i * Math.PI) / 2) * (r - 6)} y={-Math.cos((i * Math.PI) / 2) * (r - 6) + 3}>{c}</text>
      ))}
      <circle cx={Math.sin(a) * rr} cy={-Math.cos(a) * rr} r={up ? 4 : 3} className={`star ${up ? '' : 'down'}`} />
    </svg>
  )
}
