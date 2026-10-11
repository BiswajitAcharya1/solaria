// Birth families: data (scripts/build_families.py) and the origin simulation's model.
import familiesUrl from './generated/families.json?url'
import { type Vec } from './physics'
import { integrateGal } from './journey'

export interface BrightMember { hip: number; name: string; mag: number; ra: number; dec: number; constellation: string | null; xyz: Vec }

export interface Family {
  id: string
  name: string
  color: string
  exploded: boolean
  blurb: string
  age: number // Myr
  n: number // Gaia members (with full 3D motion and chemistry)
  centre: Vec // pc, heliocentric Galactic
  uvw: Vec // km/s
  stars: number[][] // [x, y, z, u, v, w, G mag]
  bright: BrightMember[]
  constellations: [string, number][]
  evidence: { dv_members: number | null; dv_field: number | null; feh_members: number[]; feh_field: number[] }
}

let cache: Promise<Family[]> | null = null
export const loadFamilies = () => (cache ??= fetch(familiesUrl).then(r => {
  if (!r.ok) throw new Error(`could not load families (${r.status})`)
  return r.json()
}).then(d => d.families as Family[]).catch(e => { cache = null; throw e })) // a failed load can be retried

// ---------------------------------------------------------------------------------------------
// Published anchors for Scorpius-Centaurus's explosions (see HistoryNotes in the UI)
//   Breitschwerdt et al. 2016: ~16 supernovae over the last ~13 Myr; the two nearest 2.3 and 1.5 Myr ago
//   Wallner et al. 2016: iron-60 reached Earth's sea floor in two pulses, 8.7-6.5 and 3.2-1.7 Myr ago
//   Zucker et al. 2022: the Local Bubble began ~14 Myr ago; the Sun entered it ~5 Myr ago
// ---------------------------------------------------------------------------------------------
export const SN_TIMES = [13, 12.1, 11.3, 10.6, 9.9, 9.2, 8.6, 8.0, 7.3, 6.7, 5.8, 4.7, 3.8, 3.0, 2.3, 1.5]
export const SN_PUBLISHED = new Set([2.3, 1.5])
export const IRON_PULSES: [number, number][] = [[8.7, 6.5], [3.2, 1.7]]

export interface Phase { key: string; title: string; from: number; to: number }

/** The story in a few steps, each a stretch of time (Myr ago). Time only ever runs forward. */
export function phases(f: Family): Phase[] {
  if (f.exploded) {
    return [
      { key: 'birth', title: 'born together', from: f.age, to: 14 },
      { key: 'blast', title: 'the explosions begin', from: 14, to: 6.5 },
      { key: 'drift', title: 'drifting apart, reaching Earth', from: 6.5, to: 0.4 },
      { key: 'today', title: 'where they are today', from: 0.4, to: 0 },
      { key: 'why', title: 'why it matters', from: 0, to: 0 },
    ]
  }
  const gas = Math.max(f.age * 0.97, f.age - 5) // young clusters lose their gas within a few million years
  return [
    { key: 'birth', title: 'born together', from: f.age, to: gas },
    { key: 'blast', title: 'the gas is blown away', from: gas, to: f.age * 0.85 },
    { key: 'drift', title: 'drifting apart', from: f.age * 0.85, to: 0.4 },
    { key: 'today', title: 'where they are today', from: 0.4, to: 0 },
    { key: 'why', title: 'why it matters', from: 0, to: 0 },
  ]
}

const STEPS = 400

export interface Sim {
  /** family centre, relative to where the Sun is at that time (the Sun stays at the origin) (pc, x toward Galactic centre, y along rotation) */
  centreAt: (t: number) => [number, number]
  /** each star's offset from the centre today */
  rel: { dx: number; dy: number; mag: number; bright?: BrightMember }[]
  spreadAt: (t: number) => number // 0 at birth -> 1 today
  birthScale: number
  gasOutAt: number // Myr ago: when the birth gas was gone
}

export function buildSim(f: Family): Sim {
  const span = f.age
  const fam = integrateGal(f.centre, f.uvw, span, STEPS)
  const sun = integrateGal([0, 0, 0], [0, 0, 0], span, STEPS)
  const at = (track: [number, number][], t: number): [number, number] => {
    const k = Math.max(0, Math.min(STEPS, (t / span) * STEPS))
    const i = Math.floor(k), j = Math.min(STEPS, i + 1), w = k - i
    return [track[i][0] + (track[j][0] - track[i][0]) * w, track[i][1] + (track[j][1] - track[i][1]) * w]
  }
  const centreAt = (t: number): [number, number] => { const c = at(fam, t), s = at(sun, t); return [c[0] - s[0], c[1] - s[1]] }
  // positions in the same axes as the orbit model: Galactic x (toward centre), y (rotation)
  const rel = [
    ...f.stars.map(s => ({ dx: s[0] - f.centre[0], dy: s[1] - f.centre[1], mag: s[6] })),
    ...f.bright.map(b => ({ dx: b.xyz[0] - f.centre[0], dy: b.xyz[1] - f.centre[1], mag: b.mag, bright: b })),
  ]
  const far = Math.max(3, ...rel.map(r => Math.hypot(r.dx, r.dy)))
  const gasOutAt = phases(f)[1].from
  // after the gas is gone the cluster expands steadily (modelled); before, it stays ~3 pc across
  const spreadAt = (t: number) => (t >= gasOutAt ? 0 : Math.min(1, (gasOutAt - t) / gasOutAt))
  return { centreAt, rel, spreadAt, birthScale: Math.min(1, 3 / far), gasOutAt }
}

export const ironAt = (t: number) => IRON_PULSES.some(([a, b]) => t <= a && t >= b)
