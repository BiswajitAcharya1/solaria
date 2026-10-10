// Data loading for solaria. All astronomy lives in physics.ts (pure, unit-tested in
// frontend/tests and cross-checked against backend/palimpsest/constellations.py).
//
// generated/constellations.json  <- data/cache/constellations.json (figure stars: Hipparcos/Gaia DR3 + XHIP)
// generated/sky_backdrop.json    <- scripts/build_sky_backdrop.py (every Hipparcos star with Hp < 7.5)
import dataUrl from './generated/constellations.json?url'
import skyUrl from './generated/sky_backdrop.json?url'
import { type Star, type Vec, K, bvColor, lookAt, lookBasis, toStar } from './physics'

export * from './physics'

export interface Figure {
  abbr: string
  name: string
  english: string
  lines: number[][] // polylines of HIP ids
}

/** A background star: real Hipparcos measurements, drawn white-ish by default. */
export interface SkyStar {
  hip: number
  ra: number
  dec: number
  mag: number
  bv: number
  pos: Vec // pc (distance 1000 pc when the parallax is not significant: direction is what matters)
  vel: Vec // km/s, tangential only (no radial velocities for most of these)
}

export interface Catalog {
  stars: Map<number, Star>
  all: Star[]
  figures: Figure[]
  sources: Record<string, string>
  sky: SkyStar[]
  skySource: string
}

/* eslint-disable @typescript-eslint/no-explicit-any */
async function loadSky(): Promise<{ sky: SkyStar[]; source: string }> {
  const res = await fetch(skyUrl)
  if (!res.ok) return { sky: [], source: '' }
  const r = await res.json()
  const sky: SkyStar[] = []
  for (let i = 0; i < r.hip.length; i++) {
    const plx = r.plx[i]
    const dist = plx > 0 ? 1000 / plx : 1000
    const a = (r.ra[i] * Math.PI) / 180, d = (r.dec[i] * Math.PI) / 180
    const u: Vec = [Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)]
    const eA: Vec = [-Math.sin(a), Math.cos(a), 0]
    const eD: Vec = [-Math.sin(d) * Math.cos(a), -Math.sin(d) * Math.sin(a), Math.cos(d)]
    const kd = (K * dist) / 1000
    sky.push({
      hip: r.hip[i], ra: r.ra[i], dec: r.dec[i], mag: r.mag[i], bv: r.bv[i],
      pos: [u[0] * dist, u[1] * dist, u[2] * dist],
      vel: [0, 1, 2].map(k => kd * (r.pmra[i] * eA[k] + r.pmdec[i] * eD[k])) as Vec,
    })
  }
  return { sky, source: r.meta?.source ?? 'Hipparcos' }
}

export async function loadCatalog(): Promise<Catalog> {
  const [res, skyRes] = await Promise.all([fetch(dataUrl), loadSky()])
  if (!res.ok) throw new Error(`Could not load constellation data (${res.status})`)
  const raw = await res.json()
  const stars = new Map<number, Star>()
  for (const r of raw.stars) {
    const s = toStar(r)
    if (s) stars.set(s.hip, s)
  }
  const figures: Figure[] = raw.figures
    .map((f: any) => ({ abbr: f.abbr, name: f.name, english: f.english ?? '', lines: f.lines }))
    .filter((f: Figure) => f.lines.some(seg => seg.some(h => stars.has(h))))
    .sort((a: Figure, b: Figure) => a.name.localeCompare(b.name))
  return { stars, all: [...stars.values()], figures, sources: raw.sources ?? {}, sky: skyRes.sky, skySource: skyRes.source }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function figureHips(lines: number[][]): number[] {
  return [...new Set(lines.flat())]
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------
export const KIN_COLORS = ['#ffc95c', '#5fe0c8', '#ff8fc4', '#a8b8ff', '#b8f07a', '#ff9f6b']
export const VERDICT_COLORS = { family: '#6fe3a9', mixed: '#ffc95c', illusion: '#ff8f9c' } as const

export const starRadius = (vmag: number) => Math.max(0.9, Math.min(5.2, 4.4 - 0.72 * vmag))

/** Kept for older callers: camera basis toward (ra, dec), east on the left. */
export function skyBasis(ra: number, dec: number) {
  const { f, up, right } = lookBasis(ra, dec)
  return { d: f, up, right }
}

export interface Sketch {
  pts: { hip: number; x: number; y: number; r: number; col: string; dist: number }[]
  segs: [number, number][] // indices into pts
}

/** The figure as seen from Earth, scaled to fit [-1, 1] (aspect kept). */
export function sketch(stars: Map<number, Star>, lines: number[][]): Sketch {
  const list = figureHips(lines).map(h => stars.get(h)).filter((s): s is Star => !!s)
  const look = lookAt(list)
  const { d, up, right } = skyBasis(look.ra, look.dec)
  const raw = list.map(s => {
    const z = s.pos[0] * d[0] + s.pos[1] * d[1] + s.pos[2] * d[2]
    return [(s.pos[0] * right[0] + s.pos[1] * right[1] + s.pos[2] * right[2]) / z,
      -(s.pos[0] * up[0] + s.pos[1] * up[1] + s.pos[2] * up[2]) / z]
  })
  const xs = raw.map(p => p[0]), ys = raw.map(p => p[1])
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2
  const half = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1e-3) / 2
  const idx = new Map(list.map((s, i) => [s.hip, i]))
  const segs: [number, number][] = []
  for (const seg of lines) for (let k = 1; k < seg.length; k++) {
    const a = idx.get(seg[k - 1]), b = idx.get(seg[k])
    if (a !== undefined && b !== undefined) segs.push([a, b])
  }
  return {
    pts: list.map((s, i) => ({ hip: s.hip, x: (raw[i][0] - cx) / half, y: (raw[i][1] - cy) / half,
      r: Math.max(0.6, 2.6 - 0.4 * s.vmag), col: bvColor(s.bv), dist: s.dist })),
    segs,
  }
}
