// WebGL sky, always seen from Earth. three.js renders:
//   - every Hipparcos star brighter than Hp 7.5 (real positions, colours, proper motions)
//   - the constellation-figure stars (Hipparcos/Gaia DR3 astrometry + radial velocities)
//   - a diffuse Milky Way glow laid along the real Galactic plane (artistic, not data)
//   - figure lines that follow the stars through time
// Star motion over time is evaluated on the GPU: p(t) = p0 + v t. Only the *direction*
// is projected (the camera never moves off Earth), so stars passing close to the Sun
// sweep across the sky and brighten (inverse-square law) instead of exploding.
// The engine owns its own animation loop; React only sends discrete changes.
import * as THREE from 'three'
import {
  type Star, type Vec, ICRS_TO_GAL, PC_PER_MYR_PER_KMS, bvRgb, lookBasis, magAt, posAt, raDecFromVec, unitFromRaDec,
} from './physics'
import { starSurface } from './textures'
import type { SkyStar } from './data'

export interface CameraState { ra: number; dec: number; fov: number }
export interface Projected { hip: number; x: number; y: number; visible: boolean }

const VERT = /* glsl */ `
attribute vec3 aPos;
attribute vec3 aVel;
attribute float aMag;
attribute vec3 aCol;
attribute float aSel;
uniform float uT;
uniform float uMagLimit;
uniform float uDpr;
uniform float uWhite;
uniform float uSelBoost;
uniform float uDimOthers;
uniform float uTwinkle;
uniform float uTime;
varying vec3 vCol;
varying float vAlpha;
varying float vCore;
void main() {
  vec3 p = aPos + aVel * (${PC_PER_MYR_PER_KMS.toFixed(10)} * uT);
  float d = max(length(p), 1e-3);
  vec3 dir = p / d;
  float m = aMag + 5.0 * log(d / max(length(aPos), 1e-3)) / log(10.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(dir, 1.0);
  float b = clamp((uMagLimit - m) / (uMagLimit + 1.6), 0.0, 1.0);
  float sel = aSel * uSelBoost;
  float tw = 1.0 + uTwinkle * 0.12 * sin(uTime * (1.3 + fract(aMag * 13.7) * 2.0) + aPos.x * 0.37);
  float size = (1.9 + 13.5 * pow(b, 1.45)) * (1.0 + 0.9 * sel) * tw;
  gl_PointSize = size * uDpr;
  float fade = smoothstep(uMagLimit + 0.6, uMagLimit - 0.4, m);
  vAlpha = (0.5 + 0.9 * b) * fade * mix(1.0 - uDimOthers, 1.0, max(aSel, 0.0));
  vCol = mix(aCol, vec3(1.0), uWhite * (1.0 - aSel));
  vCore = 0.55 + 0.45 * b;
}`

const FRAG = /* glsl */ `
varying vec3 vCol;
varying float vAlpha;
varying float vCore;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(q, q);
  if (r2 > 1.0) discard;
  float core = exp(-r2 * 16.0);
  float halo = exp(-r2 * 3.2) * 0.42;
  float a = (core + halo) * vAlpha;
  gl_FragColor = vec4(vCol * (core * (1.0 + vCore) + halo), a);
}`

const MW_VERT = /* glsl */ `
attribute float aA;
attribute vec3 aCol;
uniform float uDpr;
uniform float uScale;
uniform float uGlow;
varying float vA;
varying vec3 vCol;
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = uScale * uDpr;
  vA = aA * uGlow;
  vCol = aCol;
}`
const MW_FRAG = /* glsl */ `
varying float vA;
varying vec3 vCol;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(q, q);
  if (r2 > 1.0) discard;
  gl_FragColor = vec4(vCol, vA * exp(-r2 * 2.5));
}`

// constellation stars as real spheres: granulation texture tinted by the star's measured colour,
// limb darkening (edges dimmer, as on the sun) and a glowing rim. Each sphere turns slowly.
const BODY_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vN;
void main() {
  vUv = uv;
  vN = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`
const BODY_FRAG = /* glsl */ `
uniform sampler2D uTex;
uniform vec3 uCol;
uniform float uTime;
uniform float uA;
uniform float uSeed;
varying vec2 vUv;
varying vec3 vN;
void main() {
  float g = texture2D(uTex, vec2(vUv.x + uTime * 0.006 + uSeed, vUv.y)).r;
  float g2 = texture2D(uTex, vec2(vUv.x * 2.0 - uTime * 0.004, vUv.y * 2.0 + uSeed)).r;
  float mu = clamp(vN.z, 0.0, 1.0);
  float limb = 0.3 + 0.7 * pow(mu, 0.55);
  vec3 hot = mix(uCol, vec3(1.0), 0.35);
  vec3 c = mix(uCol * 0.55, hot * 1.35, g * 0.75 + g2 * 0.25) * limb;
  c += vec3(1.0) * pow(mu, 8.0) * 0.25;
  c += uCol * pow(1.0 - mu, 2.2) * 0.9;
  gl_FragColor = vec4(c, uA);
}`

const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2)
const wrap180 = (x: number) => ((x + 540) % 360) - 180
const hexRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

interface Flight { from: CameraState; to: CameraState; t0: number; dur: number }
interface TimeTween { from: number; to: number; t0: number; dur: number; onDone?: () => void }

export class SkyEngine {
  readonly canvas: HTMLCanvasElement
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera: THREE.PerspectiveCamera
  private bgMat: THREE.ShaderMaterial
  private figMat: THREE.ShaderMaterial
  private figSel: THREE.BufferAttribute
  private figIndex = new Map<number, number>()
  private figStars: Star[] = []
  private mwMat: THREE.ShaderMaterial
  private lines: THREE.LineSegments
  private lineGlow: THREE.LineSegments
  private allLines: THREE.LineSegments
  private segs: { a: Star; b: Star; col: [number, number, number]; born: number }[] = []
  private allSegs: { a: Star; b: Star }[] = []
  private bodies = new THREE.Group()
  private bodyGeo = new THREE.SphereGeometry(1, 40, 28)
  private bodyList: { mesh: THREE.Mesh; mat: THREE.ShaderMaterial; star: Star; spin: number; born: number }[] = []
  private bodyFocus: number | null = null
  private raf = 0
  private W = 1
  private H = 1
  private dpr = 1

  // state
  cam: CameraState = { ra: 83.8, dec: -1, fov: 60 }
  home: CameraState = { ra: 83.8, dec: -1, fov: 60 }
  t = 0
  private flight: Flight | null = null
  private timeTween: TimeTween | null = null
  private lastInteract = -1e9
  /** after any touch, the camera stays where the user left it for this long, then drifts again */
  idleResumeMs = 30000
  autoDrift = true
  private driftAmp = 0
  private driftPhase = 0
  private allLinesAlpha = 0
  private allLinesTarget = 0
  private lineAlpha = 1
  /** screen position of the look direction, as a fraction of width/height from centre */
  offset = { x: 0, y: 0 }
  private offsetTarget = { x: 0, y: 0 }
  /** extra field of view around a framed constellation */
  frameScale = 1.12
  onFrame: ((p: Projected[], cam: CameraState, t: number) => void) | null = null
  onTime: ((t: number) => void) | null = null

  constructor(canvas: HTMLCanvasElement, sky: SkyStar[], figureStars: Star[]) {
    this.canvas = canvas
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' })
    this.renderer.setClearColor(0x000000, 1)
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.01, 10)
    const uniforms = () => ({
      uT: { value: 0 }, uMagLimit: { value: 6.5 }, uDpr: { value: 1 }, uWhite: { value: 0.7 },
      uSelBoost: { value: 1 }, uDimOthers: { value: 0 }, uTwinkle: { value: 1 }, uTime: { value: 0 },
    })
    const mat = (white: number) => {
      const m = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: uniforms(),
        transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending })
      m.uniforms.uWhite.value = white
      return m
    }

    // --- Milky Way glow (drawn first, behind everything) -------------------------
    this.mwMat = new THREE.ShaderMaterial({ vertexShader: MW_VERT, fragmentShader: MW_FRAG,
      uniforms: { uDpr: { value: 1 }, uScale: { value: 9 }, uGlow: { value: 1 } },
      transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending })
    this.scene.add(new THREE.Points(milkyWay(), this.mwMat))

    // --- background stars (exclude the figure stars, drawn by their own layer) -----
    const figHips = new Set(figureStars.map(s => s.hip))
    const bg = sky.filter(s => !figHips.has(s.hip))
    this.bgMat = mat(0.82)
    this.scene.add(new THREE.Points(starGeometry(bg.map(s => ({ pos: s.pos, vel: s.vel, mag: s.mag, bv: s.bv })), 0), this.bgMat))

    // --- constellation stars ------------------------------------------------------
    this.figMat = mat(0.45)
    const figGeo = starGeometry(figureStars.map(s => ({ pos: s.pos, vel: s.vel, mag: s.vmag, bv: s.bv })), 0)
    this.figSel = figGeo.getAttribute('aSel') as THREE.BufferAttribute
    figureStars.forEach((s, i) => this.figIndex.set(s.hip, i))
    this.scene.add(new THREE.Points(figGeo, this.figMat))

    // --- lines --------------------------------------------------------------------
    const lineMat = (opacity: number) => new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity,
      depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending })
    this.allLines = new THREE.LineSegments(new THREE.BufferGeometry(), lineMat(0))
    this.lineGlow = new THREE.LineSegments(new THREE.BufferGeometry(), lineMat(0.22))
    this.lines = new THREE.LineSegments(new THREE.BufferGeometry(), lineMat(0.85))
    this.lineGlow.scale.setScalar(1.0)
    this.scene.add(this.allLines, this.lineGlow, this.lines)
    this.bodies.renderOrder = 10
    this.scene.add(this.bodies)

    this.resize()
    this.loop = this.loop.bind(this)
    this.raf = requestAnimationFrame(this.loop)
  }

  dispose() {
    cancelAnimationFrame(this.raf)
    this.renderer.dispose()
  }

  resize() {
    const r = this.canvas.getBoundingClientRect()
    this.W = Math.max(1, r.width)
    this.H = Math.max(1, r.height)
    this.dpr = Math.min(window.devicePixelRatio || 1, 2)
    this.renderer.setPixelRatio(this.dpr)
    this.renderer.setSize(this.W, this.H, false)
    this.camera.aspect = this.W / this.H
  }

  // ---------------------------------------------------------------- content
  /** The highlighted constellation: its stars glow in true colour; lines draw themselves in. */
  setFigure(stars: Star[], lines: number[][], groupOf: Map<number, number> | null, kinColors: string[]) {
    this.figStars = stars
    const sel = this.figSel.array as Float32Array
    sel.fill(0)
    for (const s of stars) { const i = this.figIndex.get(s.hip); if (i !== undefined) sel[i] = 1 }
    this.figSel.needsUpdate = true
    const byHip = new Map(stars.map(s => [s.hip, s]))
    const now = performance.now()
    this.buildBodies(stars, now)
    this.segs = []
    let k = 0
    for (const seg of lines) for (let i = 1; i < seg.length; i++) {
      const a = byHip.get(seg[i - 1]), b = byHip.get(seg[i])
      if (!a || !b) continue
      const ga = groupOf?.get(a.hip), gb = groupOf?.get(b.hip)
      const col: [number, number, number] = ga !== undefined && ga === gb ? hexRgb(kinColors[ga % kinColors.length]) : [0.72, 0.78, 0.95]
      this.segs.push({ a, b, col, born: now + 250 + k++ * 90 })
    }
  }

  setAllFigures(stars: Map<number, Star>, figures: { lines: number[][] }[]) {
    this.allSegs = []
    for (const f of figures) for (const seg of f.lines) for (let i = 1; i < seg.length; i++) {
      const a = stars.get(seg[i - 1]), b = stars.get(seg[i])
      if (a && b) this.allSegs.push({ a, b })
    }
  }

  /** the star the user is looking at grows so its surface can be seen */
  setBodyFocus(hip: number | null) { this.bodyFocus = hip }

  private buildBodies(stars: Star[], now: number) {
    for (const b of this.bodyList) { this.bodies.remove(b.mesh); b.mat.dispose() }
    const tex = starSurface()
    this.bodyList = stars.map((star, i) => {
      const mat = new THREE.ShaderMaterial({
        vertexShader: BODY_VERT, fragmentShader: BODY_FRAG, transparent: true, depthTest: false, depthWrite: false,
        uniforms: { uTex: { value: tex }, uCol: { value: new THREE.Color(...bvRgb(star.bv)) }, uTime: { value: 0 }, uA: { value: 0 }, uSeed: { value: (star.hip % 97) / 97 } },
      })
      const mesh = new THREE.Mesh(this.bodyGeo, mat)
      mesh.renderOrder = 10
      mesh.rotation.set((star.hip % 17) / 17 - 0.5, 0, (star.hip % 11) / 11 - 0.5)
      this.bodies.add(mesh)
      return { mesh, mat, star, spin: 0.08 + ((star.hip % 13) / 13) * 0.25, born: now + 150 + i * 60 }
    })
  }

  private updateBodies(now: number, dt: number, magLimit: number) {
    const F = this.pxPerRad()
    const zoomGain = Math.max(1, (60 / this.cam.fov) ** 0.75)
    for (const b of this.bodyList) {
      const p = posAt(b.star, this.t)
      const d = Math.hypot(...p)
      b.mesh.position.set(p[0] / d, p[1] / d, p[2] / d)
      const m = magAt(b.star, this.t)
      const bright = Math.max(0, Math.min(1, (magLimit - m) / (magLimit + 1.6)))
      const focus = this.bodyFocus === b.star.hip ? 2.4 : 1
      const px = Math.min(120, (2.4 + 7.5 * bright ** 1.2) * zoomGain * focus) // on-screen radius in pixels
      const grow = Math.max(0, Math.min(1, (now - b.born) / 600))
      b.mesh.scale.setScalar(((px / F) * (0.6 + 0.4 * grow)))
      b.mesh.rotation.y += dt * b.spin
      b.mat.uniforms.uTime.value = now / 1000
      b.mat.uniforms.uA.value = grow * this.lineAlpha * Math.min(1, 0.4 + bright)
    }
  }

  showAllFigures(on: boolean) { this.allLinesTarget = on ? 1 : 0 }
  setLineAlpha(a: number) { this.lineAlpha = a }
  setDimOthers(x: number) { this.figMat.uniforms.uDimOthers.value = x }

  // ---------------------------------------------------------------- camera & time
  /** user touched the sky: stop any automatic motion for idleResumeMs */
  touch() {
    this.lastInteract = performance.now()
    this.flight = null
    this.driftAmp = 0
  }

  get idleFor() { return performance.now() - this.lastInteract }

  flyTo(to: Partial<CameraState>, durMs = 2600) {
    const target = { ...this.cam, ...to }
    this.flight = { from: { ...this.cam }, to: { ...target, ra: this.cam.ra + wrap180(target.ra - this.cam.ra) }, t0: performance.now(), dur: durMs }
  }

  setHome(h: CameraState, fly = true, durMs = 2600) {
    this.home = h
    if (fly) this.flyTo(h, durMs)
  }

  pan(dxPx: number, dyPx: number) {
    const f = this.pxPerRad()
    const k = 180 / Math.PI / f
    this.cam.ra = (this.cam.ra + (dxPx * k) / Math.max(0.2, Math.cos((this.cam.dec * Math.PI) / 180)) + 360) % 360
    this.cam.dec = Math.max(-89.5, Math.min(89.5, this.cam.dec + dyPx * k))
  }

  zoomBy(factor: number) { this.cam.fov = Math.max(6, Math.min(115, this.cam.fov * factor)) }

  setTime(t: number) { this.timeTween = null; this.t = t; this.onTime?.(t) }

  animateTime(to: number, durMs: number, onDone?: () => void) {
    this.timeTween = { from: this.t, to, t0: performance.now(), dur: durMs, onDone }
  }

  get timeAnimating() { return this.timeTween !== null }
  setOffset(x: number, y: number, immediate = false) {
    this.offsetTarget = { x, y }
    if (immediate) this.offset = { x, y }
  }
  stopTime() { this.timeTween = null }
  get offsetTargetX() { return this.offsetTarget.x }

  pxPerRad() { return this.H / 2 / Math.tan((this.cam.fov * Math.PI) / 360) }

  /** screen position of a sky direction (or null if behind / off-screen far) */
  project(v: Vec): [number, number] | null {
    const { f, up, right } = lookBasis(this.cam.ra, this.cam.dec)
    const z = v[0] * f[0] + v[1] * f[1] + v[2] * f[2]
    if (z <= 1e-6) return null
    const F = this.pxPerRad()
    return [this.W * (0.5 + this.offset.x) + (F * (v[0] * right[0] + v[1] * right[1] + v[2] * right[2])) / z,
      this.H * (0.5 + this.offset.y) - (F * (v[0] * up[0] + v[1] * up[1] + v[2] * up[2])) / z]
  }

  /** sky direction under a screen point */
  unproject(x: number, y: number): { ra: number; dec: number } {
    const { f, up, right } = lookBasis(this.cam.ra, this.cam.dec)
    const F = this.pxPerRad()
    const a = (x - this.W * (0.5 + this.offset.x)) / F, b = -(y - this.H * (0.5 + this.offset.y)) / F
    return raDecFromVec([f[0] + a * right[0] + b * up[0], f[1] + a * right[1] + b * up[1], f[2] + a * right[2] + b * up[2]])
  }

  // ---------------------------------------------------------------- frame
  private loop(now: number) {
    this.raf = requestAnimationFrame(this.loop)
    const dt = Math.min(0.1, (now - (this.prevNow || now)) / 1000)
    this.prevNow = now

    // time-lapse
    if (this.timeTween) {
      const u = Math.min(1, (now - this.timeTween.t0) / this.timeTween.dur)
      this.t = this.timeTween.from + (this.timeTween.to - this.timeTween.from) * easeInOut(u)
      this.onTime?.(this.t)
      if (u >= 1) { const done = this.timeTween.onDone; this.timeTween = null; done?.() }
    }

    // camera: scripted flight > idle drift > wherever the user left it
    if (this.flight) {
      const u = Math.min(1, (now - this.flight.t0) / this.flight.dur)
      const e = easeInOut(u)
      const { from, to } = this.flight
      this.cam.ra = (from.ra + (to.ra - from.ra) * e + 360) % 360
      this.cam.dec = from.dec + (to.dec - from.dec) * e
      this.cam.fov = Math.exp(Math.log(from.fov) + (Math.log(to.fov) - Math.log(from.fov)) * e)
      if (u >= 1) this.flight = null
    } else if (this.autoDrift && this.idleFor > this.idleResumeMs) {
      // while the time-lapse moves the stars, "home" follows the constellation as it scatters
      if (Math.abs(this.t) > 1e-3 && this.figStars.length > 1) {
        const now3 = this.figStars.map(s => {
          const p = posAt(s, this.t)
          const rd = raDecFromVec(p)
          return { pos: p, dist: Math.hypot(...p), ra: rd.ra, dec: rd.dec }
        })
        const fr = frameStars(now3, this.W / this.H)
        this.home = { ...fr, fov: Math.min(110, fr.fov * this.frameScale) }
        this.driftAmp = Math.max(this.driftAmp, 0.999)
      }
      // drift slowly around "home" like a hand-held camera, easing in after the pause
      this.driftAmp = Math.min(1, this.driftAmp + dt / 6)
      this.driftPhase += dt * 0.11
      const a = this.driftAmp
      const tgt = {
        ra: this.home.ra + (2.2 * Math.sin(this.driftPhase)) / Math.max(0.3, Math.cos((this.home.dec * Math.PI) / 180)),
        dec: this.home.dec + 1.4 * Math.sin(this.driftPhase * 0.73 + 1.1),
        fov: this.home.fov * (1 + 0.06 * Math.sin(this.driftPhase * 0.51)),
      }
      const k = 1 - Math.exp(-dt * (Math.abs(this.t) > 1e-3 ? 1.6 : 0.45) * a)
      this.cam.ra = (this.cam.ra + wrap180(tgt.ra - this.cam.ra) * k + 360) % 360
      this.cam.dec += (tgt.dec - this.cam.dec) * k
      this.cam.fov = Math.exp(Math.log(this.cam.fov) + (Math.log(tgt.fov) - Math.log(this.cam.fov)) * k)
    }

    // orient the camera (always at Earth)
    const { f, up, right } = lookBasis(this.cam.ra, this.cam.dec)
    const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(...right), new THREE.Vector3(...up), new THREE.Vector3(-f[0], -f[1], -f[2]))
    this.camera.quaternion.setFromRotationMatrix(m)
    this.camera.fov = this.cam.fov
    const ko = 1 - Math.exp(-dt * 2.5)
    this.offset.x += (this.offsetTarget.x - this.offset.x) * ko
    this.offset.y += (this.offsetTarget.y - this.offset.y) * ko
    // shift the projection centre (three's view offset moves the window the other way)
    this.camera.setViewOffset(this.W, this.H, -this.offset.x * this.W, -this.offset.y * this.H, this.W, this.H)
    this.camera.updateProjectionMatrix()

    // stars: fainter stars appear as you zoom in, like a telescope
    const magLimit = Math.min(7.6, 5.6 + 1.6 * Math.log2(Math.max(1, 70 / this.cam.fov)))
    for (const mat of [this.bgMat, this.figMat]) {
      mat.uniforms.uT.value = this.t
      mat.uniforms.uMagLimit.value = magLimit
      mat.uniforms.uDpr.value = this.dpr
      mat.uniforms.uTime.value = now / 1000
    }
    this.mwMat.uniforms.uDpr.value = this.dpr
    this.mwMat.uniforms.uScale.value = Math.max(3, Math.min(16, 5 * (70 / this.cam.fov) ** 0.55))
    this.mwMat.uniforms.uGlow.value = Math.min(1, (this.cam.fov / 60) ** 0.8)

    this.updateLines(now, dt)
    this.updateBodies(now, dt, magLimit)
    this.renderer.render(this.scene, this.camera)

    if (this.onFrame) {
      const out: Projected[] = []
      for (const s of this.figStars) {
        const p = posAt(s, this.t)
        const q = this.project(p)
        out.push({ hip: s.hip, x: q?.[0] ?? -1e4, y: q?.[1] ?? -1e4, visible: !!q && q[0] > -50 && q[0] < this.W + 50 && q[1] > -50 && q[1] < this.H + 50 })
      }
      this.onFrame(out, this.cam, this.t)
    }
  }
  private prevNow = 0

  private updateLines(now: number, dt: number) {
    const dir = (s: Star): Vec => { const p = posAt(s, this.t); const d = Math.hypot(...p); return [p[0] / d, p[1] / d, p[2] / d] }
    // current figure, each segment growing from its first star
    const pos = new Float32Array(this.segs.length * 6), col = new Float32Array(this.segs.length * 6)
    this.segs.forEach((s, i) => {
      const a = dir(s.a), b = dir(s.b)
      const u = Math.max(0, Math.min(1, (now - s.born) / 520))
      const e = 1 - (1 - u) ** 3
      const bb = [a[0] + (b[0] - a[0]) * e, a[1] + (b[1] - a[1]) * e, a[2] + (b[2] - a[2]) * e]
      pos.set([...a, ...bb], i * 6)
      const c = s.col.map(x => x * (u > 0 ? 1 : 0))
      col.set([...c, ...c], i * 6)
    })
    for (const obj of [this.lines, this.lineGlow]) {
      obj.geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3))
      obj.geometry.setAttribute('color', new THREE.BufferAttribute(col, 3))
    }
    ;(this.lines.material as THREE.LineBasicMaterial).opacity = 0.85 * this.lineAlpha
    ;(this.lineGlow.material as THREE.LineBasicMaterial).opacity = 0.25 * this.lineAlpha
    // all 88 figures, faint
    this.allLinesAlpha += (this.allLinesTarget - this.allLinesAlpha) * (1 - Math.exp(-dt * 1.5))
    const am = this.allLines.material as THREE.LineBasicMaterial
    am.opacity = 0.32 * this.allLinesAlpha
    this.allLines.visible = this.allLinesAlpha > 0.01
    if (this.allLines.visible) {
      const ap = new Float32Array(this.allSegs.length * 6), ac = new Float32Array(this.allSegs.length * 6)
      this.allSegs.forEach((s, i) => { ap.set([...dir(s.a), ...dir(s.b)], i * 6); ac.set([0.6, 0.7, 1, 0.6, 0.7, 1], i * 6) })
      this.allLines.geometry.setAttribute('position', new THREE.BufferAttribute(ap, 3))
      this.allLines.geometry.setAttribute('color', new THREE.BufferAttribute(ac, 3))
    }
  }
}

function starGeometry(stars: { pos: Vec; vel: Vec; mag: number; bv: number }[], sel: number) {
  const n = stars.length
  const pos = new Float32Array(n * 3), aPos = new Float32Array(n * 3), aVel = new Float32Array(n * 3)
  const aMag = new Float32Array(n), aCol = new Float32Array(n * 3), aSel = new Float32Array(n).fill(sel)
  stars.forEach((s, i) => {
    const d = Math.hypot(...s.pos)
    pos.set([s.pos[0] / d, s.pos[1] / d, s.pos[2] / d], i * 3)
    aPos.set(s.pos, i * 3)
    aVel.set(s.vel, i * 3)
    aMag[i] = s.mag
    aCol.set(bvRgb(s.bv), i * 3)
  })
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)) // needed by three for bounds; shader uses aPos
  g.setAttribute('aPos', new THREE.BufferAttribute(aPos, 3))
  g.setAttribute('aVel', new THREE.BufferAttribute(aVel, 3))
  g.setAttribute('aMag', new THREE.BufferAttribute(aMag, 1))
  g.setAttribute('aCol', new THREE.BufferAttribute(aCol, 3))
  g.setAttribute('aSel', new THREE.BufferAttribute(aSel, 1))
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9) // never frustum-cull the sky
  return g
}

/** Diffuse light of the Milky Way: points concentrated toward the real Galactic plane and
 *  centre, with a dark dust lane. A rendering of where the band lies, not a measurement. */
function milkyWay(): THREE.BufferGeometry {
  const N = 150000
  const pos = new Float32Array(N * 3), a = new Float32Array(N), col = new Float32Array(N * 3)
  let seed = 7
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd())
  // inverse of ICRS_TO_GAL (a rotation): transpose
  const toIcrs = (g: Vec): Vec => [0, 1, 2].map(i => ICRS_TO_GAL[0][i] * g[0] + ICRS_TO_GAL[1][i] * g[1] + ICRS_TO_GAL[2][i] * g[2]) as Vec
  for (let i = 0; i < N; i++) {
    // longitude: concentrated toward the centre (l = 0)
    const lc = rnd() < 0.55
    const l = lc ? gauss() * 38 : (rnd() * 360 - 180)
    const width = 2.6 + 6 * Math.exp(-((l / 30) ** 2)) + 1.5 * rnd()
    const b = gauss() * width
    const lr = (l * Math.PI) / 180, br = (b * Math.PI) / 180
    const g: Vec = [Math.cos(br) * Math.cos(lr), Math.cos(br) * Math.sin(lr), Math.sin(br)]
    pos.set(toIcrs(g), i * 3)
    const centre = Math.exp(-((l / 40) ** 2))
    const dust = Math.abs(l) < 70 && Math.abs(b) < 1.6 ? 0.35 : 1
    a[i] = (0.011 + 0.02 * centre) * dust * (0.5 + rnd())
    const warm = centre * 0.6
    col.set([0.78 + 0.22 * warm, 0.8 + 0.08 * warm, 1 - 0.3 * warm], i * 3)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setAttribute('aA', new THREE.BufferAttribute(a, 1))
  geo.setAttribute('aCol', new THREE.BufferAttribute(col, 3))
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9)
  return geo
}

/** Camera that frames a set of stars from Earth, zoomed in (fills ~75% of the short side). */
export function frameStars(stars: { pos: Vec; dist: number; ra: number; dec: number }[], aspect: number): CameraState {
  if (!stars.length) return { ra: 83.8, dec: 0, fov: 60 }
  const m: Vec = [0, 0, 0]
  for (const s of stars) for (let i = 0; i < 3; i++) m[i] += s.pos[i] / s.dist
  const c = raDecFromVec(m)
  const { f, up, right } = lookBasis(c.ra, c.dec)
  let maxX = 0, maxY = 0
  for (const s of stars) {
    const u = unitFromRaDec(s.ra, s.dec)
    const z = u[0] * f[0] + u[1] * f[1] + u[2] * f[2]
    if (z <= 0.05) continue
    maxX = Math.max(maxX, Math.abs((u[0] * right[0] + u[1] * right[1] + u[2] * right[2]) / z))
    maxY = Math.max(maxY, Math.abs((u[0] * up[0] + u[1] * up[1] + u[2] * up[2]) / z))
  }
  // vertical half-angle needed so the figure fills ~75% of the screen in both directions
  const half = Math.max(maxY, maxX / aspect) / 0.75
  const fov = Math.max(10, Math.min(100, (2 * Math.atan(half) * 180) / Math.PI))
  return { ra: c.ra, dec: c.dec, fov }
}
