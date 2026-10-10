// Pure astronomy for solaria: no browser or bundler imports, so it runs under
// `node --test` (frontend/tests) and is cross-checked against the Python backend
// (backend/palimpsest/constellations.py) star by star.
//
// Frame: Sun/Earth-centred ICRS cartesian, parsecs. Earth's 1 AU offset from the
// Sun is 5e-6 pc - irrelevant at these distances - so "from the Sun" = "from Earth".

export type Vec = [number, number, number]

export interface Star {
  hip: number
  name: string | null
  label: string // name, or "HIP 1234"
  dist: number // pc
  distErr: number // pc, from the parallax error
  distReliable: boolean // parallax / error >= 5
  ra: number // deg (ICRS)
  dec: number
  plx: number // mas
  plxErr: number
  pos: Vec // pc
  vel: Vec // km/s, relative to the Sun (ICRS axes); RV taken as 0 when unknown
  uvw: Vec // Galactic U (to centre), V (rotation), W (north pole), km/s
  hasRv: boolean
  vErr: number // km/s
  vmag: number
  bv: number
  spType: string | null
  rvSource: string
  astroSource: string
  feh: number | null // XHIP literature compilation
  ageGyr: number | null // XHIP literature compilation
  group: string | null // XHIP literature moving-group / cluster name
}

export const K = 4.740470446 // km/s per (arcsec/yr * pc)
export const PC_PER_MYR_PER_KMS = 1.0227121650537077 // 1 km/s for 1 Myr, in pc
export const LY_PER_PC = 3.261563777
export const MAX_SEP_PC = 50 // co-moving test: present separation
export const MAX_DV_ERR = 3 // co-moving test: decided only if |dv| known to <= 3 km/s
export const MIN_PLX_SNR = 5 // and both parallaxes are at least 5 sigma

const rad = (d: number) => (d * Math.PI) / 180

// ICRS -> Galactic rotation matrix (Hipparcos convention, as in astropy)
export const ICRS_TO_GAL = [
  [-0.0548755604162154, -0.8734370902348850, -0.4838350155487132],
  [0.4941094278755837, -0.4448296299600112, 0.7469822444972189],
  [-0.8676661490190047, -0.1980763734312015, 0.4559837761750669],
]

export function unitFromRaDec(raDeg: number, decDeg: number): Vec {
  const a = rad(raDeg), d = rad(decDeg)
  return [Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)]
}

export function raDecFromVec(v: Vec): { ra: number; dec: number } {
  const r = Math.hypot(v[0], v[1], v[2]) || 1
  return { ra: ((Math.atan2(v[1], v[0]) * 180) / Math.PI + 360) % 360, dec: (Math.asin(v[2] / r) * 180) / Math.PI }
}

/** Heliocentric velocity (km/s, ICRS axes) from proper motion (mas/yr), parallax distance and RV. */
export function velocity(raDeg: number, decDeg: number, distPc: number, pmra: number, pmdec: number, rv: number): Vec {
  const a = rad(raDeg), d = rad(decDeg)
  const u = unitFromRaDec(raDeg, decDeg)
  const eA: Vec = [-Math.sin(a), Math.cos(a), 0]
  const eD: Vec = [-Math.sin(d) * Math.cos(a), -Math.sin(d) * Math.sin(a), Math.cos(d)]
  const kd = (K * distPc) / 1000
  return [0, 1, 2].map(i => rv * u[i] + kd * (pmra * eA[i] + pmdec * eD[i])) as Vec
}

export const toGalactic = (v: Vec): Vec =>
  [0, 1, 2].map(i => ICRS_TO_GAL[i][0] * v[0] + ICRS_TO_GAL[i][1] * v[1] + ICRS_TO_GAL[i][2] * v[2]) as Vec

/* eslint-disable @typescript-eslint/no-explicit-any */
/** One record of data/cache/constellations.json -> Star (same formulas as constellations.py). */
export function toStar(r: any): Star | null {
  if (!(r.parallax > 0)) return null
  const dist = 1000 / r.parallax
  const u = unitFromRaDec(r.ra, r.dec)
  const hasRv = r.rv !== null && r.rv !== undefined && Number.isFinite(r.rv)
  const vel = velocity(r.ra, r.dec, dist, r.pmra, r.pmdec, hasRv ? r.rv : 0)
  const kd = (K * dist) / 1000
  const vtErr = (kd * Math.hypot(r.pmra_error, r.pmdec_error)) / Math.SQRT2
  const vt = kd * Math.hypot(r.pmra, r.pmdec)
  const vErr = Math.sqrt(vtErr ** 2 + (vt * r.parallax_error / r.parallax) ** 2 + (r.rv_error ?? 5) ** 2)
  const group = typeof r.GrpName === 'string' && r.GrpName.trim() && !/^[\d.]+$/.test(r.GrpName.trim()) ? r.GrpName.trim() : null
  return {
    hip: r.HIP, name: r.name ?? null, label: r.name ?? `HIP ${r.HIP}`, dist,
    distErr: (dist * r.parallax_error) / r.parallax, distReliable: r.parallax / r.parallax_error >= MIN_PLX_SNR,
    ra: r.ra, dec: r.dec, plx: r.parallax, plxErr: r.parallax_error,
    pos: [u[0] * dist, u[1] * dist, u[2] * dist], vel, uvw: toGalactic(vel), hasRv, vErr,
    vmag: r.Vmag ?? r.Hpmag ?? 5, bv: r['B-V'] ?? 0.6, spType: r.SpType ?? null,
    rvSource: r.rv_source ?? '—', astroSource: r.astrometry_source ?? '—',
    feh: r.feh_xhip ?? null, ageGyr: r.age_xhip ?? null, group,
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Straight-line position after tMyr million years (pc). Accurate to < 0.1 pc over +-1 Myr. */
export const posAt = (s: { pos: Vec; vel: Vec }, tMyr: number): Vec => {
  const k = PC_PER_MYR_PER_KMS * tMyr
  return [s.pos[0] + s.vel[0] * k, s.pos[1] + s.vel[1] * k, s.pos[2] + s.vel[2] * k]
}

/** Apparent magnitude after tMyr: the inverse-square law applied to today's magnitude. */
export const magAt = (s: { pos: Vec; vel: Vec; vmag: number; dist: number }, tMyr: number) => {
  const p = posAt(s, tMyr)
  return s.vmag + 5 * Math.log10(Math.max(1e-3, Math.hypot(p[0], p[1], p[2])) / s.dist)
}

// ---------------------------------------------------------------------------
// Kinship: which figure stars actually travel together? Same rule as the backend.
// ---------------------------------------------------------------------------
export type PairStatus = 'comoving' | 'not comoving' | 'undetermined'

export function pairInfo(a: Star, b: Star) {
  const sep = Math.hypot(a.pos[0] - b.pos[0], a.pos[1] - b.pos[1], a.pos[2] - b.pos[2])
  const dvKnown = a.hasRv && b.hasRv // without both RVs the 3D velocity difference is unknown
  const dv = Math.hypot(a.vel[0] - b.vel[0], a.vel[1] - b.vel[1], a.vel[2] - b.vel[2])
  const dvErr = Math.hypot(a.vErr, b.vErr)
  const decidable = dvKnown && a.distReliable && b.distReliable && dvErr <= MAX_DV_ERR
  let status: PairStatus
  if (sep >= MAX_SEP_PC) status = 'not comoving'
  else if (!decidable) status = 'undetermined'
  else status = dv < Math.max(3, 2 * dvErr) ? 'comoving' : 'not comoving'
  return { sep, dv, dvErr, dvKnown, status, comoving: status === 'comoving' }
}

export interface Kinship {
  groups: number[][] // HIP ids, each group size >= 2, largest first
  groupOf: Map<number, number> // HIP -> group index
  nKin: number
  n: number
  nUndetermined: number // pairs that the data cannot decide
  nearest: Star
  farthest: Star
  depthRatio: number
  verdict: 'family' | 'mixed' | 'illusion'
}

export function analyse(stars: Star[]): Kinship | null {
  if (stars.length === 0) return null
  const parent = new Map(stars.map(s => [s.hip, s.hip]))
  const find = (h: number): number => {
    while (parent.get(h) !== h) {
      parent.set(h, parent.get(parent.get(h)!)!)
      h = parent.get(h)!
    }
    return h
  }
  let nUndetermined = 0
  for (let i = 0; i < stars.length; i++)
    for (let j = i + 1; j < stars.length; j++) {
      const p = pairInfo(stars[i], stars[j])
      if (p.comoving) parent.set(find(stars[i].hip), find(stars[j].hip))
      else if (p.status === 'undetermined') nUndetermined++
    }
  const byRoot = new Map<number, number[]>()
  for (const s of stars) {
    const r = find(s.hip)
    byRoot.set(r, [...(byRoot.get(r) ?? []), s.hip])
  }
  const groups = [...byRoot.values()].filter(g => g.length > 1).map(g => g.sort((a, b) => a - b))
    .sort((a, b) => b.length - a.length || a[0] - b[0])
  const groupOf = new Map<number, number>()
  groups.forEach((g, i) => g.forEach(h => groupOf.set(h, i)))
  const sorted = [...stars].sort((a, b) => a.dist - b.dist)
  const nKin = groupOf.size
  const frac = nKin / stars.length
  return {
    groups, groupOf, nKin, n: stars.length, nUndetermined,
    nearest: sorted[0], farthest: sorted[sorted.length - 1],
    depthRatio: sorted[sorted.length - 1].dist / sorted[0].dist,
    verdict: frac >= 0.5 ? 'family' : nKin > 0 ? 'mixed' : 'illusion',
  }
}

// ---------------------------------------------------------------------------
// Looking out from Earth
// ---------------------------------------------------------------------------
/** Camera basis for looking toward (ra, dec) with celestial north up. As on any sky
 *  chart seen from the inside of the sphere, east (increasing RA) appears on the LEFT. */
export function lookBasis(ra: number, dec: number) {
  const f = unitFromRaDec(ra, dec)
  let up: Vec = [-f[0] * f[2], -f[1] * f[2], 1 - f[2] * f[2]]
  const n = Math.hypot(...up)
  up = n < 1e-6 ? [-Math.cos(rad(ra)), -Math.sin(rad(ra)), 0] : [up[0] / n, up[1] / n, up[2] / n]
  // right = forward x up  (camera looks along +f, right-handed)
  const right: Vec = [f[1] * up[2] - f[2] * up[1], f[2] * up[0] - f[0] * up[2], f[0] * up[1] - f[1] * up[0]]
  return { f, up, right }
}

/** Gnomonic projection of a direction into the camera's tangent plane (radians-ish units);
 *  null when the point is behind the observer. */
export function gnomonic(v: Vec, basis: { f: Vec; up: Vec; right: Vec }): [number, number] | null {
  const z = v[0] * basis.f[0] + v[1] * basis.f[1] + v[2] * basis.f[2]
  if (z <= 1e-9) return null
  return [(v[0] * basis.right[0] + v[1] * basis.right[1] + v[2] * basis.right[2]) / z,
    (v[0] * basis.up[0] + v[1] * basis.up[1] + v[2] * basis.up[2]) / z]
}

/** Mean direction to a set of stars. */
export function lookAt(stars: { pos: Vec; dist: number }[]): { ra: number; dec: number } {
  if (!stars.length) return { ra: 85, dec: 0 }
  const m: Vec = [0, 0, 0]
  for (const s of stars) for (let i = 0; i < 3; i++) m[i] += s.pos[i] / s.dist
  return raDecFromVec(m)
}

/** Angular radius (deg) of the smallest cone around (ra,dec) that holds the stars. */
export function angularExtent(stars: { ra: number; dec: number }[], ra: number, dec: number): number {
  const c = unitFromRaDec(ra, dec)
  let worst = 0
  for (const s of stars) {
    const u = unitFromRaDec(s.ra, s.dec)
    worst = Math.max(worst, Math.acos(Math.min(1, c[0] * u[0] + c[1] * u[1] + c[2] * u[2])))
  }
  return (worst * 180) / Math.PI
}

// ---------------------------------------------------------------------------
// Colour: B-V colour index -> the colour a star actually has (blackbody approximation)
// Ballesteros (2012) B-V -> temperature, then a blackbody -> sRGB fit.
// ---------------------------------------------------------------------------
export function bvToKelvin(bv: number): number {
  const x = Math.max(-0.4, Math.min(2.0, bv))
  return 4600 * (1 / (0.92 * x + 1.7) + 1 / (0.92 * x + 0.62))
}

export function kelvinToRgb(T: number): [number, number, number] {
  // Tanner Helland's fit to the CIE blackbody locus (valid 1000-40000 K)
  const t = Math.max(1000, Math.min(40000, T)) / 100
  const r = t <= 66 ? 255 : 329.698727446 * (t - 60) ** -0.1332047592
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * (t - 60) ** -0.0755148492
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307
  const c = (v: number) => Math.max(0, Math.min(255, v)) / 255
  return [c(r), c(g), c(b)]
}

export function bvRgb(bv: number): [number, number, number] {
  return kelvinToRgb(bvToKelvin(bv))
}

export function bvColor(bv: number): string {
  const [r, g, b] = bvRgb(bv)
  return `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`
}

export const ly = (pc: number) => {
  const v = pc * LY_PER_PC
  return v < 20 ? v.toFixed(1) : Math.round(v).toLocaleString('en-US')
}
