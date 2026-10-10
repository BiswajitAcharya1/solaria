// SkyView-style compass: a heading tape + rose showing which way (and how high) the view
// points in your real sky. Tap a direction to turn there; on phones, aim the phone itself.
import { useEffect, useRef, useState } from 'react'
import { type Observer, cardinal } from './sky'
import { haptic } from './Motion'

interface Props {
  az: number
  alt: number
  observer: Observer
  onTurn: (az: number) => void
  onLocate: () => void
  aim: { supported: boolean; on: boolean; toggle: () => void }
}

const SPAN = 140 // degrees visible across the tape
const LABELS: Record<number, string> = { 0: 'n', 45: 'ne', 90: 'e', 135: 'se', 180: 's', 225: 'sw', 270: 'w', 315: 'nw' }

export default function Compass({ az, alt, observer, onTurn, onLocate, aim }: Props) {
  // eased heading, so the tape and needle glide rather than jump
  const [shown, setShown] = useState(az)
  const target = useRef(az)
  target.current = az
  useEffect(() => {
    let raf = 0, last = performance.now()
    const step = (now: number) => {
      const k = 1 - Math.exp(-((now - last) / 1000) * 7)
      last = now
      setShown(h => {
        const d = ((target.current - h + 540) % 360) - 180
        return Math.abs(d) < 0.05 ? target.current : (h + d * k + 360) % 360
      })
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [])

  const ticks: { a: number; x: number }[] = []
  const first = Math.ceil((shown - SPAN / 2) / 5) * 5
  for (let a = first; a <= shown + SPAN / 2; a += 5) ticks.push({ a: ((a % 360) + 360) % 360, x: (a - shown) / SPAN })

  return (
    <div className="cx-compass" role="group" aria-label="compass">
      <svg className="cx-rose" width="46" height="46" viewBox="-23 -23 46 46" aria-hidden>
        <circle r="20" className="rim" />
        <g style={{ transform: `rotate(${-shown}deg)` }}>
          {Array.from({ length: 16 }, (_, i) => (
            <line key={i} y1={-20} y2={i % 4 ? -17.5 : -15} className="tick" transform={`rotate(${i * 22.5})`} />
          ))}
          <path d="M0 -14 L3.4 0 L0 2 L-3.4 0Z" className="north" />
          <path d="M0 14 L3.4 0 L0 -2 L-3.4 0Z" className="south" />
          <text y="-6.5" className="n">n</text>
        </g>
        <circle r="2" className="hub" />
      </svg>

      <div className="cx-tape">
        <div className="cx-tape-track">
          {ticks.map(({ a, x }) => {
            const lab = LABELS[a]
            const style = { left: `${50 + x * 100}%`, opacity: 1 - Math.abs(x) * 1.6 }
            return lab
              ? <button key={a} className={`cx-tape-lab ${lab.length === 1 ? 'major' : ''}`} style={style}
                  onClick={() => { haptic(); onTurn(a) }} title={`look ${lab}`}>{lab}</button>
              : <i key={a} className={a % 15 === 0 ? 'mid' : ''} style={style} />
          })}
        </div>
        <span className="cx-tape-caret" aria-hidden />
      </div>

      <div className="cx-readout" aria-live="polite">
        <b>{cardinal(az)} {Math.round(az)}°</b>
        <span className={alt < 0 ? 'down' : ''}>{alt < 0 ? `${Math.round(-alt)}° below` : `${Math.round(alt)}° up`}</span>
      </div>

      <div className="cx-compass-tools">
        <button className={`cx-mini ${observer.approx ? '' : 'on'}`} onClick={() => { haptic(); onLocate() }}
          title={observer.approx ? 'using an approximate location: tap to use yours' : `${observer.lat.toFixed(1)}°, ${observer.lon.toFixed(1)}°`}>
          ⌖
        </button>
        {aim.supported && (
          <button className={`cx-mini ${aim.on ? 'on live' : ''}`} onClick={() => { haptic(); aim.toggle() }} title="point your phone at the sky">
            ◉
          </button>
        )}
      </div>
    </div>
  )
}

type OrientationCtor = { requestPermission?: () => Promise<'granted' | 'denied'> }

/** Point-your-phone mode: reports where the back camera is aimed (azimuth, altitude). */
export function useDeviceAim(on: boolean, onAim: (az: number, alt: number) => void) {
  const cb = useRef(onAim)
  cb.current = onAim
  useEffect(() => {
    if (!on) return
    let last = 0
    const handle = (e: DeviceOrientationEvent & { webkitCompassHeading?: number }) => {
      const heading = e.webkitCompassHeading ?? (e.absolute && e.alpha != null ? 360 - e.alpha : null)
      if (heading == null || e.beta == null) return
      const now = performance.now()
      if (now - last < 50) return
      last = now
      cb.current(heading, Math.max(-89, Math.min(89, e.beta - 90)))
    }
    const evt = 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation'
    window.addEventListener(evt, handle as EventListener)
    return () => window.removeEventListener(evt, handle as EventListener)
  }, [on])
}

export const aimSupported = () =>
  typeof window !== 'undefined' && 'DeviceOrientationEvent' in window && matchMedia('(pointer: coarse)').matches

/** iOS asks permission from a tap; elsewhere this resolves straight away. */
export async function requestAim(): Promise<boolean> {
  const C = (window as unknown as { DeviceOrientationEvent: OrientationCtor }).DeviceOrientationEvent
  if (typeof C?.requestPermission !== 'function') return true
  try { return (await C.requestPermission()) === 'granted' } catch { return false }
}
