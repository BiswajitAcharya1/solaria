// Tests of the astronomy that runs in the browser (src/constellations/physics.ts).
//   npm test            (node --experimental-strip-types --test tests/*.test.ts)
// The cross-check section compares every constellation star with the Python backend
// (fixture written by scripts/export_constellation_reference.py).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  ICRS_TO_GAL, LY_PER_PC, PC_PER_MYR_PER_KMS, analyse, bvRgb, bvToKelvin, gnomonic, lookBasis, magAt,
  pairInfo, posAt, raDecFromVec, toGalactic, toStar, unitFromRaDec, velocity, type Star,
} from '../src/constellations/physics.ts'

const json = (p: string) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'))
const raw = json('../src/constellations/generated/constellations.json')
const ref = json('./fixtures/backend_constellations.json')
const sky = json('../src/constellations/generated/sky_backdrop.json')
const stars = new Map<number, Star>()
for (const r of raw.stars) { const s = toStar(r); if (s) stars.set(s.hip, s) }
const close = (a: number, b: number, tol: number, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} vs ${b} (tol ${tol})`)

// ------------------------------------------------------------------ coordinates
test('ra/dec <-> unit vector round trip', () => {
  for (const [ra, dec] of [[0, 0], [83.82, -5.39], [279.23, 38.78], [359.9, -89.5], [180, 89.9]]) {
    const back = raDecFromVec(unitFromRaDec(ra, dec))
    close(((back.ra - ra + 540) % 360) - 180, 0, 1e-9, 'ra')
    close(back.dec, dec, 1e-9, 'dec')
  }
})

test('ICRS -> Galactic matrix is a rotation and points the right way', () => {
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    const d = ICRS_TO_GAL[i][0] * ICRS_TO_GAL[j][0] + ICRS_TO_GAL[i][1] * ICRS_TO_GAL[j][1] + ICRS_TO_GAL[i][2] * ICRS_TO_GAL[j][2]
    close(d, i === j ? 1 : 0, 1e-9, 'orthonormal')
  }
  // Galactic centre (Sgr A*) and North Galactic Pole
  const gc = toGalactic(unitFromRaDec(266.40499, -28.93617))
  close(gc[0], 1, 1e-4, 'GC x'); close(gc[1], 0, 2e-3, 'GC y'); close(gc[2], 0, 2e-3, 'GC z')
  const ngp = toGalactic(unitFromRaDec(192.85948, 27.12825))
  close(ngp[2], 1, 1e-6, 'NGP z')
})

test('looking from Earth: target at centre, north up, east on the left', () => {
  for (const [ra, dec] of [[83.8, -5.4], [165.9, 61.8], [10, -70]]) {
    const b = lookBasis(ra, dec)
    const c = gnomonic(unitFromRaDec(ra, dec), b)!
    close(c[0], 0, 1e-12); close(c[1], 0, 1e-12)
    const north = gnomonic(unitFromRaDec(ra, dec + 1), b)!
    assert.ok(north[1] > 0 && Math.abs(north[0]) < 1e-3, 'north is up')
    const east = gnomonic(unitFromRaDec(ra + 1, dec), b)!
    assert.ok(east[0] < 0, 'east (larger RA) is on the left, as seen from inside the celestial sphere')
    assert.equal(gnomonic(unitFromRaDec(ra + 180, -dec), b), null, 'opposite sky is behind the observer')
  }
})

// ------------------------------------------------------------------ kinematics
test('units: 1 km/s for 1 Myr is 1.0227 pc; light-years per parsec', () => {
  const p = posAt({ pos: [10, 0, 0], vel: [1, 0, 0] }, 1)
  close(p[0] - 10, 1.0227, 1e-4)
  close(LY_PER_PC, 3.26156, 1e-5)
  close(PC_PER_MYR_PER_KMS * 1e-6 * 3.15576e7 * 1e6 / 3.15576e7, 1.0227e-6 * 1e6, 1e-3) // sanity
})

test('velocity: proper motion converts with 4.74 km/s per (arcsec/yr * pc)', () => {
  // 1000 mas/yr at 1000 pc (1 arcsec/yr at 1 kpc) = 4740 km/s tangential
  const v = velocity(0, 0, 1000, 1000, 0, 0)
  close(Math.hypot(...v), 4740.47, 0.01)
  // pure radial velocity points along the line of sight
  const r = velocity(90, 0, 50, 0, 0, 20)
  close(r[1], 20, 1e-9)
})

test('apparent magnitude follows the inverse-square law', () => {
  const s = { pos: [10, 0, 0] as [number, number, number], vel: [10 / PC_PER_MYR_PER_KMS, 0, 0] as [number, number, number], vmag: 1, dist: 10 }
  close(magAt(s, 1), 1 + 5 * Math.log10(2), 1e-9, 'twice as far is 1.505 mag fainter')
})

// ------------------------------------------------------------------ colour
test('star colours come from B-V via temperature: Sun ~5800 K, Rigel blue, Betelgeuse red', () => {
  close(bvToKelvin(0.65), 5800, 250, 'Sun')
  const rigel = bvRgb(-0.03), betel = bvRgb(1.85)
  assert.ok(rigel[2] >= rigel[0], 'Rigel is bluer than red')
  assert.ok(betel[0] > betel[2] + 0.3, 'Betelgeuse is red')
  let prev = Infinity
  for (let bv = -0.3; bv <= 2.0; bv += 0.1) { const T = bvToKelvin(bv); assert.ok(T < prev, 'redder = cooler'); prev = T }
})

// ------------------------------------------------------------------ the data
test('catalogue sanity: famous stars at their known distances', () => {
  const byName = new Map([...stars.values()].filter(s => s.name).map(s => [s.name!, s]))
  const expect: [string, number, number][] = [ // name, distance in light-years, tolerance
    ['Sirius', 8.6, 0.2], ['Vega', 25, 1], ['Polaris', 433, 40], ['Betelgeuse', 548, 150], ['Deneb', 2600, 1200],
  ]
  for (const [n, lyExp, tol] of expect) {
    const s = byName.get(n)
    if (!s) continue // not every bright star is in a figure
    close(s.dist * LY_PER_PC, lyExp, tol, n)
  }
  assert.ok(stars.size > 650)
})

test('sky backdrop: real Hipparcos naked-eye stars', () => {
  assert.equal(sky.hip.length, sky.ra.length)
  assert.ok(sky.hip.length > 15000, `${sky.hip.length} stars`)
  assert.ok(Math.max(...sky.mag) <= 7.5 && Math.min(...sky.mag) < -1, 'Hp <= 7.5 (rounded), includes Sirius')
  const sirius = sky.hip.indexOf(32349)
  assert.ok(sirius >= 0)
  close(sky.ra[sirius], 101.287, 0.01, 'Sirius RA'); close(sky.dec[sirius], -16.716, 0.01, 'Sirius Dec')
  assert.ok(sky.ra.every((r: number) => r >= 0 && r < 360) && sky.dec.every((d: number) => d >= -90 && d <= 90))
})

// ------------------------------------------------------------------ cross-check with the backend
test('every constellation star matches the Python backend (distance, Galactic position, velocity)', () => {
  let n = 0
  for (const [abbr, fig] of Object.entries<any>(ref)) {
    for (const [hipS, b] of Object.entries<any>(fig.stars)) {
      const s = stars.get(Number(hipS))
      assert.ok(s, `${abbr} HIP ${hipS} missing in browser catalogue`)
      close(s!.dist, b.dist_pc, 1e-6 * b.dist_pc, `${abbr} ${hipS} dist`)
      const g = toGalactic(s!.pos)
      close(g[0], b.X, 1e-4 * b.dist_pc + 1e-3, `${abbr} ${hipS} X`)
      close(g[1], b.Y, 1e-4 * b.dist_pc + 1e-3, `${abbr} ${hipS} Y`)
      close(g[2], b.Z, 1e-4 * b.dist_pc + 1e-3, `${abbr} ${hipS} Z`)
      if (b.U !== null) {
        close(s!.uvw[0], b.U, 0.02, `${abbr} ${hipS} U`)
        close(s!.uvw[1], b.V, 0.02, `${abbr} ${hipS} V`)
        close(s!.uvw[2], b.W, 0.02, `${abbr} ${hipS} W`)
      }
      close(s!.vErr, b.v_err, 1e-6 * Math.max(1, b.v_err), `${abbr} ${hipS} v_err`)
      assert.equal(s!.distReliable, b.distance_reliable, `${abbr} ${hipS} reliability`)
      n++
    }
  }
  assert.ok(n > 650, `${n} star records compared`)
})

test('every pair verdict and every family matches the backend', () => {
  for (const [abbr, fig] of Object.entries<any>(ref)) {
    const list = (fig.hips as number[]).map(h => stars.get(h)!).filter(Boolean)
    for (const [key, status] of Object.entries<string>(fig.pairs)) {
      const [a, b] = key.split('-').map(Number)
      assert.equal(pairInfo(stars.get(a)!, stars.get(b)!).status, status, `${abbr} ${key}`)
    }
    const kin = analyse(list)!
    const norm = (gs: number[][]) => gs.map(g => [...g].sort((x, y) => x - y).join(',')).sort()
    assert.deepEqual(norm(kin.groups), norm(fig.comoving_groups), `${abbr} families`)
  }
})

test('the Big Dipper decomposes into the Ursa Major moving group', () => {
  const uma = ref.UMa
  const list = (uma.hips as number[]).map(h => stars.get(h)!)
  const kin = analyse(list)!
  const names = kin.groups.map(g => new Set(g.map(h => stars.get(h)!.name)))
  assert.ok(names.some(g => ['Merak', 'Phecda', 'Megrez', 'Alioth', 'Mizar'].every(n => g.has(n))))
  assert.ok(!names.some(g => g.has('Dubhe') || g.has('Alkaid')))
})

test('sky positions after +-1 Myr match the backend propagation (to 0.01 deg)', () => {
  for (const [abbr, fig] of Object.entries<any>(ref)) {
    const hips = fig.hips as number[]
    for (const tk of ['-1000', '1000']) {
      const e = fig.sky_epochs[tk]
      hips.forEach((h, i) => {
        const s = stars.get(h)!
        const v = s.hasRv ? s.vel : s.vel // tangential-only when no RV, as in the backend
        const p = raDecFromVec(posAt({ pos: s.pos, vel: v }, Number(tk) / 1000))
        close(((p.ra - e.ra[i] + 540) % 360) - 180, 0, 0.01 / Math.max(0.05, Math.cos((p.dec * Math.PI) / 180)), `${abbr} ${h} ra ${tk}`)
        close(p.dec, e.dec[i], 0.01, `${abbr} ${h} dec ${tk}`)
      })
    }
  }
})
