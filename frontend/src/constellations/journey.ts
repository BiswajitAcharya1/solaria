// A star's life story, built only from what the data supports. Pure functions, no browser APIs.
//
//   relate()   who the star is related to, and how strongly (measured motion + chemistry + published groups)
//   traceback() its orbit run backwards through a simple Milky Way model, beside its relatives and the Sun
//   fate()     what the star is, whether it will explode, and what that means for Earth
//
// Every claim carries a `basis` so the interface can say whether it is measured, published or modelled.
import { type Star, type Vec, LY_PER_PC, pairInfo, toGalactic } from './physics'

export type Basis = 'measured' | 'published' | 'modelled'

// ---------------------------------------------------------------------------
// 1. Relationships
// ---------------------------------------------------------------------------
/** Four kinds of relationship, from strongest evidence to none. One colour each, used everywhere. */
export type Relation = 'born' | 'moving' | 'aligned' | 'unknown'

export const RELATION: Record<Relation, { color: string; word: string; means: string }> = {
  born: {
    color: '#7fe6c4', word: 'born together',
    means: 'same motion, and either a published birth group or matching chemistry. siblings from one birth cloud.',
  },
  moving: {
    color: '#ffcf7a', word: 'moving together now',
    means: 'same speed and direction today, but no chemistry or published group to prove a shared birth.',
  },
  aligned: {
    color: '#8b93b8', word: 'only lined up',
    means: 'close on the sky, but far apart in space and moving differently. a trick of perspective.',
  },
  unknown: {
    color: '#5b6284', word: 'can’t tell yet',
    means: 'the measurements are too uncertain to decide either way.',
  },
}

export interface Relative {
  star: Star
  relation: Relation
  sepPc: number // distance between the two stars today
  dv: number // km/s, difference in 3D velocity
  dFeh: number | null // difference in iron abundance, dex
  sameGroup: boolean // both in the same published moving group / cluster
}

const FEH_MATCH = 0.1 // dex: typical of open-cluster siblings (De Silva et al. 2007, Bovy 2016)

/** `travelsWith`: the star's co-moving group in this constellation (linked through other members, not
 *  only directly), so the story agrees with the rings drawn on the sky. */
export function relate(star: Star, constellation: Star[], catalog: Star[], travelsWith: Set<number> = new Set()): Relative[] {
  const seen = new Set<number>([star.hip])
  const out: Relative[] = []
  const add = (o: Star) => {
    if (seen.has(o.hip)) return
    seen.add(o.hip)
    const p = pairInfo(star, o)
    const sameGroup = !!star.group && !!o.group && sharesGroup(star.group, o.group)
    const dFeh = star.feh != null && o.feh != null ? Math.abs(star.feh - o.feh) : null
    const comoving = p.comoving || travelsWith.has(o.hip)
    let relation: Relation
    if (comoving && (sameGroup || (dFeh != null && dFeh <= FEH_MATCH))) relation = 'born'
    else if (sameGroup && p.status !== 'not comoving') relation = 'born'
    else if (comoving) relation = 'moving'
    else if (p.status === 'undetermined') relation = 'unknown'
    else relation = 'aligned'
    out.push({ star: o, relation, sepPc: p.sep, dv: p.dv, dFeh, sameGroup })
  }
  constellation.forEach(add)
  // published siblings elsewhere in the sky count too: a family is not limited to one constellation
  if (star.group) catalog.filter(o => o.group && sharesGroup(star.group!, o.group)).forEach(add)
  const rank: Record<Relation, number> = { born: 0, moving: 1, unknown: 2, aligned: 3 }
  return out.sort((a, b) => rank[a.relation] - rank[b.relation] || a.sepPc - b.sepPc)
}

const groupParts = (g: string) => g.split(',').map(x => x.trim().toLowerCase()).filter(Boolean)
const sharesGroup = (a: string, b: string) => groupParts(a).some(x => groupParts(b).includes(x))

/** Published ages of the moving groups that appear in our data (Myr). */
const GROUP_AGE: [RegExp, number][] = [
  [/ursa major/i, 414], [/hyades/i, 650], [/^pleiades/i, 125], [/southern pleiades/i, 50], [/alpha persei/i, 80],
  [/upper scorpius/i, 11], [/upper centaurus/i, 16], [/lower centaurus/i, 15], [/beta pictoris/i, 24],
  [/tucana|horologium/i, 45], [/ab doradus/i, 150], [/orion/i, 5], [/ic 348/i, 5], [/vel ob2|velorum/i, 30],
]

export function groupAge(group: string | null): number | null {
  if (!group) return null
  for (const [re, age] of GROUP_AGE) if (re.test(group)) return age
  return null
}

// ---------------------------------------------------------------------------
// 2. Traceback through the Galaxy
// ---------------------------------------------------------------------------
// Model: flat rotation curve (232 km/s) in the plane, a harmonic disc vertically
// (local density 0.1 Msun/pc^3). Good to a few per cent over ~100 Myr near the Sun, which is
// far better than the velocity errors it is fed with. Units: pc, km/s, time in Myr.
const R0 = 8178 // pc, Sun to Galactic centre (GRAVITY 2019)
const Z0 = 20.8 // pc, Sun above the plane (Bennett & Bovy 2019)
const VC = 232 // km/s circular speed at the Sun (Eilers et al. 2019 ~ 229-233)
const SUN_PEC: Vec = [11.1, 12.24, 7.25] // km/s, Sun relative to local standard of rest (Schonrich 2010)
const NU2 = 4 * Math.PI * 4.30091e-3 * 0.1 // (km/s/pc)^2, vertical frequency squared
const KMS_PC_MYR = 1.0227121650537077
const OMEGA = VC / R0 // km/s/pc

export interface Track {
  hip: number // 0 for the Sun
  pts: [number, number][] // x toward the Galactic centre, y along rotation, pc, in a frame riding with the local standard of rest
  err: number[] // pc, how far measurement errors could have moved it by then (1 sigma)
}

export interface Traceback {
  tMyr: number // how far back we ran
  times: number[] // Myr ago, matching pts indices
  tracks: Track[]
  /** for each relative: closest approach to the chosen star in the past */
  closest: Map<number, { tMyr: number; sepPc: number; nowPc: number }>
}

function integrate(posHelio: Vec, velHelio: Vec, tMyr: number, steps: number) {
  return integrateGal(toGalactic(posHelio), toGalactic(velHelio), tMyr, steps)
}

/** Orbit back in time from heliocentric Galactic position (pc) and velocity (U,V,W km/s).
 *  Returns [x, y] per step in pc, x toward the Galactic centre, y along rotation, in a frame that
 *  rides with the local standard of rest (so the Sun starts at the origin). */
export function integrateGal(pg: Vec, vg: Vec, tMyr: number, steps: number) {
  // heliocentric Galactic -> Galactocentric (Sun on the -x axis, rotating toward +y)
  let x = pg[0] - R0, y = pg[1], z = pg[2] + Z0
  let vx = vg[0] + SUN_PEC[0], vy = vg[1] + SUN_PEC[1] + VC, vz = vg[2] + SUN_PEC[2]
  const dt = -(tMyr / steps) / KMS_PC_MYR // negative: backwards, in pc/(km/s)
  const acc = (x: number, y: number, z: number): Vec => {
    const R2 = x * x + y * y
    return [(-VC * VC * x) / R2, (-VC * VC * y) / R2, -NU2 * z]
  }
  const out: [number, number][] = []
  const rec = (k: number) => {
    // rotate into the frame that follows the local standard of rest, then centre on it
    // rotation is clockwise seen from the north pole, so after time dt*k the LSR sits at angle pi - OMEGA*dt*k;
    // turning everything by +OMEGA*dt*k puts it back on the -x axis
    const th = OMEGA * dt * k
    const c = Math.cos(th), s = Math.sin(th)
    const xr = c * x - s * y, yr = s * x + c * y
    out.push([xr + R0, yr]) // x toward Galactic centre = +x here, Sun starts at ~(0,0)
  }
  // leapfrog (kick-drift-kick); symplectic, so orbits don't spiral numerically
  let a = acc(x, y, z)
  rec(0)
  for (let k = 1; k <= steps; k++) {
    vx += 0.5 * dt * a[0]; vy += 0.5 * dt * a[1]; vz += 0.5 * dt * a[2]
    x += dt * vx; y += dt * vy; z += dt * vz
    a = acc(x, y, z)
    vx += 0.5 * dt * a[0]; vy += 0.5 * dt * a[1]; vz += 0.5 * dt * a[2]
    rec(k)
  }
  return out
}

/** Run the star, its relatives and the Sun back by tMyr. */
export function traceback(star: Star, relatives: Star[], tMyr: number, steps = 120): Traceback {
  const times = Array.from({ length: steps + 1 }, (_, k) => (tMyr * k) / steps)
  const run = (s: Star): Track => ({
    hip: s.hip, pts: integrate(s.pos, s.vel, tMyr, steps), err: times.map(t => s.vErr * KMS_PC_MYR * t),
  })
  const me = run(star)
  const tracks = [me, ...relatives.map(run), { hip: 0, pts: integrate([0, 0, 0], [0, 0, 0], tMyr, steps), err: times.map(() => 0) }]
  const closest = new Map<number, { tMyr: number; sepPc: number; nowPc: number }>()
  for (const tr of tracks.slice(1, -1)) {
    let best = Infinity, bt = 0
    tr.pts.forEach((p, k) => {
      const d = Math.hypot(p[0] - me.pts[k][0], p[1] - me.pts[k][1])
      if (d < best) { best = d; bt = times[k] }
    })
    closest.set(tr.hip, { tMyr: bt, sepPc: best, nowPc: Math.hypot(tr.pts[0][0] - me.pts[0][0], tr.pts[0][1] - me.pts[0][1]) })
  }
  return { tMyr, times, tracks, closest }
}

/** How far back it is worth rewinding: the family's age, but no further than errors allow. */
export function rewindSpan(star: Star): { tMyr: number; age: number | null; capped: boolean } {
  const age = groupAge(star.group) ?? (star.ageGyr != null ? star.ageGyr * 1000 : null)
  // beyond ~50 Myr a 1 km/s error grows to ~50 pc: the picture would be mostly uncertainty
  const tMyr = Math.max(5, Math.min(age ?? 30, 50))
  return { tMyr, age, capped: age != null && age > 50 }
}

/** Speed of the star relative to the average of its family: what slowly carries it away. */
export function driftFromFamily(star: Star, family: Star[]) {
  if (!family.length) return null
  const all = [star, ...family]
  const mean = [0, 1, 2].map(i => all.reduce((s, x) => s + x.vel[i], 0) / all.length)
  const dv = Math.hypot(star.vel[0] - mean[0], star.vel[1] - mean[1], star.vel[2] - mean[2])
  return { kms: dv, lyPerMyr: dv * KMS_PC_MYR * LY_PER_PC }
}

// ---------------------------------------------------------------------------
// 3. What the star is, and what it means for Earth
// ---------------------------------------------------------------------------
export interface Fate {
  kind: string // plain words: "a hot blue giant"
  massSun: number | null // rough, from spectral type
  massText: string // the same, in words, no more precise than we know it
  lifeMyr: number | null
  explodes: boolean
  ending: string
  earth: string // the effect on Earth, in a sentence
  scoCen: boolean // member of the association whose supernovae left iron-60 on Earth
}

// Main-sequence mass by spectral class (Pecaut & Mamajek 2013, rounded)
const MS_MASS: Record<string, number[]> = {
  O: [60, 60, 60, 60, 50, 40, 30, 25, 22, 19], B: [17, 12, 9, 7, 6, 5, 4.5, 4, 3.5, 3],
  A: [2.5, 2.3, 2.2, 2.1, 2, 1.9, 1.8, 1.7, 1.7, 1.6], F: [1.6, 1.5, 1.5, 1.4, 1.35, 1.3, 1.25, 1.2, 1.15, 1.1],
  G: [1.08, 1.05, 1.02, 1, 0.98, 0.96, 0.94, 0.92, 0.9, 0.88], K: [0.85, 0.8, 0.78, 0.75, 0.72, 0.7, 0.68, 0.65, 0.6, 0.58],
  M: [0.55, 0.5, 0.45, 0.4, 0.33, 0.25, 0.2, 0.15, 0.12, 0.1],
}
export const HARM_PC = 8 // a supernova closer than this damages the ozone layer (Gehrels et al. 2003)
export const TRACE_PC = 100 // closer than this its debris reaches Earth (iron-60 in sea-floor crust: Wallner et al. 2016)

export function fate(star: Star): Fate {
  const sp = (star.spType ?? '').trim()
  const cls = sp[0]?.toUpperCase() ?? ''
  const sub = Number.parseFloat(sp.slice(1)) || 5
  const lum = /(Ia0|Iab|Ia|Ib|III|II|IV|V)/.exec(sp.replace(/^[A-Z][\d.]*/i, ''))?.[1] ?? 'V'
  const supergiant = lum.startsWith('I') && !lum.startsWith('II') && lum !== 'IV'
  const giant = lum === 'III' || lum === 'II'
  let mass: number | null = MS_MASS[cls]?.[Math.min(9, Math.floor(sub))] ?? null
  const evolvedGiant = giant && 'GKM'.includes(cls) // its type no longer tells its mass: a few Suns, below the supernova limit
  if (supergiant) mass = Math.max(mass ?? 0, 12)
  else if (evolvedGiant) mass = null
  const explodes = (mass ?? 0) >= 8
  const lifeMyr = mass ? 1e4 * mass ** -2.5 : null
  const colour = { O: 'blue', B: 'blue-white', A: 'white', F: 'yellow-white', G: 'yellow', K: 'orange', M: 'red' }[cls] ?? ''
  const size = supergiant ? 'supergiant' : giant ? 'giant' : lum === 'IV' ? 'ageing star' : 'star'
  const words = `${colour} ${size}`.trim()
  const kind = `${/^[aeiou]/.test(words) ? 'an' : 'a'} ${words}`
  const dist = star.dist
  const scoCen = /upper scorpius|upper centaurus|lower centaurus/i.test(star.group ?? '')
  let ending: string, earth: string
  if (explodes) {
    ending = 'heavy enough to end as a supernova, scattering iron, oxygen and other elements into space.'
    earth = dist < HARM_PC
      ? 'close enough that its supernova could strip part of the ozone layer.'
      : dist < TRACE_PC
        ? 'too far to harm life, but close enough that its supernova dust (radioactive iron-60) would reach Earth.'
        : 'too far to harm us. its explosion would be a bright new star in our sky for months.'
  } else if (evolvedGiant) {
    ending = 'already a giant near the end of its life. it will shed its outer layers gently and leave a white dwarf.'
    earth = 'no danger to Earth. the carbon and nitrogen it sheds become part of future stars and planets.'
  } else if ((mass ?? 1) > 0.9) {
    ending = 'will swell into a red giant, then shed its outer layers gently and leave a white dwarf.'
    earth = 'no danger to Earth. the carbon and nitrogen it sheds become part of future stars and planets.'
  } else {
    ending = 'burns slowly for tens of billions of years, longer than the universe has existed so far.'
    earth = 'no danger to Earth.'
  }
  const massText = supergiant ? 'more than 10 times the Sun’s mass'
    : evolvedGiant ? 'a few times the Sun’s mass'
      : mass ? `about ${mass < 3 ? mass.toFixed(1) : Math.round(mass)} times the Sun’s mass` : ''
  return { kind, massSun: mass, massText, lifeMyr, explodes, ending, earth, scoCen }
}
