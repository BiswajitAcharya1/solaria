// Where things are in *your* sky right now: observer location, alt/az <-> ra/dec,
// rise/set times, and plain-language descriptions of a star. Low-precision formulas
// (good to a fraction of a degree), which is plenty for pointing and a compass.
import { type Star, type Vec, LY_PER_PC } from './data'

export interface Observer { lat: number; lon: number; approx: boolean }

const KEY = 'solaria.observer'
const rad = (d: number) => (d * Math.PI) / 180
const deg = (r: number) => (r * 180) / Math.PI
const wrap360 = (x: number) => ((x % 360) + 360) % 360

/** Remembered location, or a rough guess from the time zone (no permission prompt). */
export function initialObserver(): Observer {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const o = JSON.parse(raw)
      if (Number.isFinite(o.lat) && Number.isFinite(o.lon)) return { lat: o.lat, lon: o.lon, approx: false }
    }
  } catch { /* storage blocked: fall through to the guess */ }
  const lon = Math.max(-180, Math.min(180, -new Date().getTimezoneOffset() / 4))
  return { lat: 35, lon, approx: true }
}

export function locate(): Promise<Observer> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('location not available')); return }
    navigator.geolocation.getCurrentPosition(p => {
      const o = { lat: p.coords.latitude, lon: p.coords.longitude, approx: false }
      try { localStorage.setItem(KEY, JSON.stringify(o)) } catch { /* not persisted, still used */ }
      resolve(o)
    }, e => reject(new Error(e.message || 'location denied')), { timeout: 10000, maximumAge: 3600_000 })
  })
}

/** Local sidereal time in degrees. */
export function lst(lon: number, ms = Date.now()) {
  const jd = ms / 86400000 + 2440587.5
  return wrap360(280.46061837 + 360.98564736629 * (jd - 2451545) + lon)
}

/** Azimuth (deg from north through east) and altitude (deg) of an ra/dec. */
export function altAz(ra: number, dec: number, o: Observer, ms = Date.now()) {
  const H = rad(lst(o.lon, ms) - ra), d = rad(dec), L = rad(o.lat)
  const alt = Math.asin(Math.sin(d) * Math.sin(L) + Math.cos(d) * Math.cos(L) * Math.cos(H))
  const az = Math.atan2(-Math.cos(d) * Math.sin(H), Math.sin(d) * Math.cos(L) - Math.cos(d) * Math.sin(L) * Math.cos(H))
  return { az: wrap360(deg(az)), alt: deg(alt) }
}

export function raDec(az: number, alt: number, o: Observer, ms = Date.now()) {
  const A = rad(az), h = rad(alt), L = rad(o.lat)
  const dec = Math.asin(Math.sin(h) * Math.sin(L) + Math.cos(h) * Math.cos(L) * Math.cos(A))
  const H = Math.atan2(-Math.sin(A) * Math.cos(h), Math.cos(L) * Math.sin(h) - Math.sin(L) * Math.cos(h) * Math.cos(A))
  return { ra: wrap360(lst(o.lon, ms) - deg(H)), dec: deg(dec) }
}

/** Unit vector (equatorial cartesian) for a point on the observer's sky. */
export function altAzVec(az: number, alt: number, o: Observer, ms = Date.now()): Vec {
  const { ra, dec } = raDec(az, alt, o, ms)
  const a = rad(ra), d = rad(dec)
  return [Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)]
}

const POINTS = ['n', 'nne', 'ne', 'ene', 'e', 'ese', 'se', 'sse', 's', 'ssw', 'sw', 'wsw', 'w', 'wnw', 'nw', 'nnw']
export const cardinal = (az: number) => POINTS[Math.round(wrap360(az) / 22.5) % 16]

const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

/** Next rise and set (local clock), or circumpolar / never rises. */
export function riseSet(ra: number, dec: number, o: Observer, ms = Date.now()) {
  const L = rad(o.lat), d = rad(dec)
  const cosH0 = (Math.sin(rad(-0.57)) - Math.sin(L) * Math.sin(d)) / (Math.cos(L) * Math.cos(d))
  if (cosH0 < -1) return { kind: 'always' as const }
  if (cosH0 > 1) return { kind: 'never' as const }
  const H0 = deg(Math.acos(cosH0))
  const ha = wrap360(lst(o.lon, ms) - ra) // current hour angle
  const SID = 0.99726958 // solar hours per sidereal hour
  const until = (target: number) => ms + (wrap360(target - ha) / 15) * SID * 3600_000
  return { kind: 'rises' as const, rise: clock(until(360 - H0)), set: clock(until(H0)) }
}

// ---------------------------------------------------------------------------
// What kind of star is it?
// ---------------------------------------------------------------------------
const COLOUR: Record<string, string> = { O: 'blue', B: 'blue-white', A: 'white', F: 'yellow-white', G: 'yellow', K: 'orange', M: 'red' }

export function describe(s: Star) {
  const sp = (s.spType ?? '').trim()
  const cls = sp.match(/[OBAFGKM]/)?.[0]
  const lum = sp.match(/(Ia|Iab|Ib|III|II|IV|V|I)(?![a-z])/)?.[1]
  const size = !lum ? 'star'
    : ['Ia', 'Iab', 'Ib', 'I'].includes(lum) ? 'supergiant'
    : lum === 'II' ? 'bright giant' : lum === 'III' ? 'giant' : lum === 'IV' ? 'subgiant'
    : cls && 'GKM'.includes(cls) ? 'dwarf' : 'main-sequence star'
  const colour = cls ? COLOUR[cls] : s.bv < 0 ? 'blue' : s.bv < 0.6 ? 'white' : s.bv < 1.1 ? 'yellow-orange' : 'red'
  const kind = `${colour} ${size}`
  const sunLike = cls === 'G' && lum === 'V'

  // Ballesteros (2012): effective temperature from B-V colour
  const teff = 4600 * (1 / (0.92 * s.bv + 1.7) + 1 / (0.92 * s.bv + 0.62))
  const absMag = s.vmag - 5 * Math.log10(s.dist / 10)
  const lumSun = 10 ** ((4.83 - absMag) / 2.5) // visible light only
  const radial = (s.vel[0] * s.pos[0] + s.vel[1] * s.pos[1] + s.vel[2] * s.pos[2]) / s.dist
  const lightYears = s.dist * LY_PER_PC
  return { kind, sunLike, spType: sp || null, teff, absMag, lumSun, radial, speed: Math.hypot(...s.vel), lightYears }
}

export const fmtBig = (x: number) =>
  x >= 1e6 ? `${(x / 1e6).toFixed(1)} million` : x >= 1000 ? Math.round(x).toLocaleString() : x >= 10 ? x.toFixed(0) : x >= 1 ? x.toFixed(1) : x.toFixed(2)
