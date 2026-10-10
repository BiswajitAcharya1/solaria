// Canvas renderer, redrawn every animation frame. One camera model covers both views:
//   unfold = 0 -> camera at the Sun looking at the figure (exactly what you see in the sky)
//   unfold = 1 -> camera swung 90 degrees around the figure, so depth runs left-to-right
// Camera direction and framing ease toward their targets, so every change is animated.
import { useEffect, useMemo, useRef } from 'react'
import {
  type Kinship, type Star, type Vec, KIN_COLORS, LY_PER_PC, bvColor, posAt, skyBasis, starRadius,
} from './data'

export interface View {
  ra: number // look direction (deg)
  dec: number
  yaw: number // user orbit offsets (rad)
  pitch: number
  zoom: number
}

interface Props {
  all: Star[]
  figure: Star[]
  lines: number[][]
  kin: Kinship | null
  unfold: number // 0..1
  tMyr: number
  view: View
  onView: (v: View) => void
  onInteract: () => void
  building: boolean
  pending: number | null
  focus: number | null
  onStarClick: (hip: number | null) => void
  onHover: (hip: number | null, x: number, y: number) => void
}

const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const mul = (a: Vec, k: number): Vec => [a[0] * k, a[1] * k, a[2] * k]
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const norm = (a: Vec): Vec => mul(a, 1 / (Math.hypot(...a) || 1))
const smooth = (x: number) => x * x * (3 - 2 * x)
const clamp01 = (x: number) => Math.max(0, Math.min(1, x))
const easeOut = (x: number) => 1 - (1 - clamp01(x)) ** 3
const rgba = (rgb: string, a: number) => rgb.replace('rgb(', 'rgba(').replace(')', `,${a})`)

type P3 = [number, number, number]

function makeCamera(figure: Star[], view: View, unfold: number, W: number, H: number, building: boolean) {
  const { d, up, right } = skyBasis(view.ra, view.dec)
  const s = smooth(unfold)
  const maxDist = figure.length ? Math.max(...figure.map(f => f.dist)) : 100
  const L = maxDist / 2
  const pivot = mul(d, L)
  const R = L * (1 - s) + maxDist * 1.15 * s
  const theta = s * (Math.PI / 2) + view.yaw
  const phi = view.pitch + s * 0.32 // tilt down a little so the 3D ground plane reads as a plane
  const c = add(mul(add(mul(d, -Math.cos(theta)), mul(right, Math.sin(theta))), Math.cos(phi)), mul(up, Math.sin(phi)))
  const C = add(pivot, mul(c, R))
  const f = mul(c, -1)
  const camUp = norm(sub(up, mul(f, dot(up, f))))
  const camRight = cross(f, camUp)

  // fit today's figure (plus the Sun once visible) into the free part of the screen
  const pts = figure.map(st => st.pos)
  if (s > 0.02) pts.push([0, 0, 0])
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
  for (const p of pts) {
    const q = sub(p, C)
    const z = dot(q, f)
    if (z < 1e-3) continue
    const x = dot(q, camRight) / z, y = dot(q, camUp) / z
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y)
  }
  if (!Number.isFinite(x0)) { x0 = -0.1; x1 = 0.1; y0 = -0.1; y1 = 0.1 }
  // keep clear of the rail (left), the data card (right), the narration (top) and the dock (bottom)
  const wide = W > 900
  const box = wide
    ? { left: 170, right: W - 470, top: 150, bottom: H - 170 }
    : { left: 40, right: W - 100, top: 170, bottom: H - 330 }
  const bw = Math.max(80, box.right - box.left), bh = Math.max(80, box.bottom - box.top)
  let F = Math.min(bw / Math.max(x1 - x0, 0.02), bh / Math.max(y1 - y0, 0.02))
  let cx = (box.left + box.right) / 2 - (F * (x0 + x1)) / 2
  let cy = (box.top + box.bottom) / 2 + (F * (y0 + y1)) / 2
  if (building && s < 0.02) {
    // drawing on the sky: fixed ~70 degree field so the sky doesn't jump as stars are added
    F = (0.5 * Math.min(W, H)) / Math.tan((35 * Math.PI) / 180)
    cx = wide ? (170 + W - 470) / 2 : W / 2
    cy = H / 2 - 20
  }
  return { C, f, camUp, camRight, F, cx, cy, d, up, right, s, R, maxDist }
}

function niceTicksLy(maxLy: number) {
  let unit = 1
  while (unit * 10 < maxLy) unit *= 10
  const step = [1, 2, 5].map(k => k * unit).find(v => maxLy / v <= 4) ?? unit * 10
  const out: number[] = []
  for (let v = step; v <= maxLy * 1.02; v += step) out.push(v)
  return out
}

const segKey = (a: number, b: number) => `${a}-${b}`

export default function SkyCanvas(p: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  const props = useRef(p)
  props.current = p
  const hits = useRef(new Map<number, P3>())
  const st = useRef({
    ra: p.view.ra, dec: p.view.dec, F: 0, cx: 0, cy: 0, W: 800, H: 600,
    autoYaw: 0, autoAmp: 0, phase: 0, lastInteract: 0, dragging: false,
    born: new Map<string, number>(), starBorn: new Map<number, number>(), linesRef: null as unknown,
  })
  // decorative far-away dust, fixed per session
  const dust = useMemo(() => Array.from({ length: 420 }, () => ({
    x: Math.random(), y: Math.random(), r: Math.random() ** 3 * 1.3 + 0.25, ph: Math.random() * 6.28, sp: 0.5 + Math.random() * 2,
  })), [])

  useEffect(() => {
    const cv = ref.current!
    const ctx = cv.getContext('2d')!
    let raf = 0
    let last = performance.now()
    const S = st.current

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      const P = props.current
      const dt = Math.min(0.25, (now - last) / 1000)
      last = now
      const { W, H } = S
      const dpr = window.devicePixelRatio || 1
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, W, H)

      // --- animation state -------------------------------------------------
      const kDir = 1 - Math.exp(-dt * (P.building ? 18 : 2.4))
      const dra = ((P.view.ra - S.ra + 540) % 360) - 180
      S.ra = (S.ra + dra * kDir + 360) % 360
      S.dec += (P.view.dec - S.dec) * kDir

      if (P.lines !== S.linesRef) {
        // new segments get a birth time; a whole new figure draws itself line by line
        const fresh = !P.building
        const keep = new Map<string, number>()
        let i = 0
        for (const seg of P.lines) for (let k = 1; k < seg.length; k++) {
          const key = segKey(seg[k - 1], seg[k])
          keep.set(key, (fresh ? undefined : S.born.get(key)) ?? now + (fresh ? 450 + i++ * 70 : 0))
        }
        S.born = keep
        const sb = new Map<number, number>()
        P.figure.forEach((f, j) => sb.set(f.hip, (fresh ? undefined : S.starBorn.get(f.hip)) ?? now + (fresh ? 150 + j * 35 : 0)))
        S.starBorn = sb
        S.linesRef = P.lines
        if (fresh) S.lastInteract = now
      }

      const idle = now - S.lastInteract > 2600 && P.unfold > 0.97 && !S.dragging
      S.autoAmp += ((idle ? 1 : 0) - S.autoAmp) * (1 - Math.exp(-dt * 0.7))
      S.phase += dt * 0.2 * S.autoAmp
      S.autoYaw = S.autoAmp * 0.45 * Math.sin(S.phase)

      const view = { ...P.view, ra: S.ra, dec: S.dec, yaw: P.view.yaw + S.autoYaw }
      const cam = makeCamera(P.figure, view, P.unfold, W, H, P.building)
      // framing comes from where we are heading, so while slewing the figure slides into place
      const fit = makeCamera(P.figure, { ...view, ra: P.view.ra, dec: P.view.dec }, P.unfold, W, H, P.building)
      const kF = 1 - Math.exp(-dt * 6)
      const tF = fit.F * P.view.zoom
      if (!S.F) { S.F = tF; S.cx = fit.cx; S.cy = fit.cy }
      S.F = Math.exp(Math.log(S.F) + (Math.log(tF) - Math.log(S.F)) * kF)
      S.cx += (fit.cx - S.cx) * kF
      S.cy += (fit.cy - S.cy) * kF
      const { C, f, camUp, camRight, s } = cam
      const project = (q0: Vec): P3 | null => {
        const q = sub(q0, C)
        const z = dot(q, f)
        if (z < 1e-3) return null
        return [S.cx + (S.F * dot(q, camRight)) / z, S.cy - (S.F * dot(q, camUp)) / z, z]
      }
      const t = P.tMyr
      const inFig = new Set(P.figure.map(x => x.hip))
      const pos = new Map<number, P3>()
      const sun = project([0, 0, 0])
      const tw = (seed: number, sp = 1) => 0.78 + 0.22 * Math.sin(now * 0.0016 * sp + seed)

      // --- 1. far dust (pure decoration, drifts with the camera) -----------
      const shiftX = (S.ra / 360) * W * 2 + view.yaw * 260, shiftY = (S.dec / 90) * H * 0.5 + view.pitch * 200
      for (const d of dust) {
        const x = (((d.x * W - shiftX * 0.25) % W) + W) % W
        const y = (((d.y * H + shiftY * 0.25) % H) + H) % H
        ctx.globalAlpha = 0.35 * tw(d.ph, d.sp)
        ctx.fillStyle = '#c9d4ff'
        ctx.fillRect(x, y, d.r, d.r)
      }
      ctx.globalAlpha = 1

      // --- 2. the 3D frame: ground plane rings + sight-lines ---------------
      if (sun && s > 0.02) {
        const ticks = niceTicksLy(cam.maxDist * LY_PER_PC)
        ctx.lineWidth = 1
        ctx.font = '11px Inter, system-ui, sans-serif'
        for (const tick of ticks) {
          const r = tick / LY_PER_PC
          ctx.strokeStyle = `rgba(120,150,255,${0.16 * s})`
          ctx.beginPath()
          let started = false
          for (let k = 0; k <= 96; k++) {
            const a = (k / 96) * Math.PI * 2
            const q = project(add(mul(cam.d, r * Math.cos(a)), mul(cam.right, r * Math.sin(a))))
            if (!q) { started = false; continue }
            if (started) ctx.lineTo(q[0], q[1]); else { ctx.moveTo(q[0], q[1]); started = true }
          }
          ctx.stroke()
          const lq = project(mul(cam.d, r))
          if (lq) {
            ctx.fillStyle = `rgba(150,170,230,${0.7 * s})`
            ctx.fillText(`${tick.toLocaleString()} ly`, lq[0] + 4, lq[1] + 14)
          }
        }
        // the axis we look along from Earth
        const end = project(mul(cam.d, cam.maxDist * 1.08))
        if (end) {
          const g = ctx.createLinearGradient(sun[0], sun[1], end[0], end[1])
          g.addColorStop(0, `rgba(140,200,255,${0.5 * s})`); g.addColorStop(1, 'rgba(140,200,255,0)')
          ctx.strokeStyle = g
          ctx.beginPath(); ctx.moveTo(sun[0], sun[1]); ctx.lineTo(end[0], end[1]); ctx.stroke()
        }
      }

      // --- 2b. faint ra/dec grid, only while drawing: it keeps you oriented as you drag the sky
      if (P.building && s < 0.98) {
        ctx.lineWidth = 1
        ctx.strokeStyle = `rgba(130,160,255,${0.09 * (1 - s)})`
        const line = (pts: Vec[]) => {
          ctx.beginPath()
          let on = false
          for (const v of pts) {
            const q = project(v)
            if (!q || q[0] < -400 || q[0] > W + 400 || q[1] < -400 || q[1] > H + 400) { on = false; continue }
            if (on) ctx.lineTo(q[0], q[1]); else { ctx.moveTo(q[0], q[1]); on = true }
          }
          ctx.stroke()
        }
        const unit = (ra: number, dec: number): Vec => {
          const a = (ra * Math.PI) / 180, d = (dec * Math.PI) / 180
          return [Math.cos(d) * Math.cos(a) * 1e4, Math.cos(d) * Math.sin(a) * 1e4, Math.sin(d) * 1e4]
        }
        for (let dec = -60; dec <= 60; dec += 30) line(Array.from({ length: 145 }, (_, i) => unit(i * 2.5, dec)))
        for (let ra = 0; ra < 360; ra += 30) line(Array.from({ length: 73 }, (_, i) => unit(ra, -90 + i * 2.5)))
      }

      // --- 3. other stars in the sky (fade out as the figure unfolds) ------
      const bgAlpha = P.building ? Math.max(0.3, 1 - s) : Math.max(0, 1 - s * 1.6)
      if (bgAlpha > 0.01) {
        for (const x of P.all) {
          if (inFig.has(x.hip)) continue
          const q = project(posAt(x, t))
          if (!q) continue
          if (P.building) pos.set(x.hip, q)
          const r = starRadius(x.vmag) * (P.building ? 1.15 : 0.85)
          if (P.building) {
            // tappable stars get a soft halo so they stand out from the decorative backdrop
            const hg = ctx.createRadialGradient(q[0], q[1], 0, q[0], q[1], r * 4)
            hg.addColorStop(0, rgba(bvColor(x.bv), 0.35 * bgAlpha)); hg.addColorStop(1, rgba(bvColor(x.bv), 0))
            ctx.fillStyle = hg
            ctx.beginPath(); ctx.arc(q[0], q[1], r * 4, 0, Math.PI * 2); ctx.fill()
          }
          ctx.globalAlpha = bgAlpha * (P.building ? 1 : 0.85) * (0.6 + 0.4 * Math.sin(now * 0.0021 * (1 + (x.hip % 7) / 7) + x.hip))
          ctx.fillStyle = bvColor(x.bv)
          ctx.beginPath(); ctx.arc(q[0], q[1], Math.max(1.3, r), 0, Math.PI * 2); ctx.fill()
        }
        ctx.globalAlpha = 1
      }

      // the earth beneath your feet, while you look from earth
      const limbA = Math.max(0, 1 - s * 2.2)
      if (limbA > 0.01 && !P.building) drawHorizon(ctx, W, H, limbA, now)

      for (const x of P.figure) {
        const q = project(posAt(x, t))
        if (q) pos.set(x.hip, q)
      }

      // --- 4. drop-lines: tie each star to the ground plane so its distance reads against the rings
      if (sun && s > 0.02) {
        ctx.strokeStyle = `rgba(160,180,255,${0.18 * s})`
        ctx.setLineDash([2, 4])
        ctx.beginPath()
        for (const x of P.figure) {
          const q = pos.get(x.hip)
          const p3 = posAt(x, t)
          const foot = q && project(sub(p3, mul(cam.up, dot(p3, cam.up))))
          if (!q || !foot) continue
          ctx.moveTo(q[0], q[1]); ctx.lineTo(foot[0], foot[1])
        }
        ctx.stroke()
        ctx.setLineDash([])
      }

      // --- 5. through time: today's ghost, trails ---------------------------
      if (Math.abs(t) > 0.005) {
        ctx.strokeStyle = 'rgba(200,210,255,0.16)'
        ctx.setLineDash([3, 5])
        for (const seg of P.lines) {
          ctx.beginPath()
          let started = false
          for (const h of seg) {
            const x = P.figure.find(ff => ff.hip === h)
            const q = x && project(x.pos)
            if (!q) { started = false; continue }
            if (started) ctx.lineTo(q[0], q[1]); else { ctx.moveTo(q[0], q[1]); started = true }
          }
          ctx.stroke()
        }
        ctx.setLineDash([])
        for (const x of P.figure) {
          const gi = P.kin?.groupOf.get(x.hip)
          ctx.strokeStyle = gi !== undefined ? rgba(hexToRgb(KIN_COLORS[gi % KIN_COLORS.length]), 0.5) : 'rgba(200,210,255,0.3)'
          ctx.beginPath()
          for (let i = 0; i <= 16; i++) {
            const q = project(posAt(x, (t * i) / 16))
            if (!q) continue
            if (i === 0) ctx.moveTo(q[0], q[1]); else ctx.lineTo(q[0], q[1])
          }
          ctx.stroke()
        }
      }

      // --- 6. motion arrows (3D view): kin stars' arrows run parallel ------
      if (s > 0.3 && P.figure.length) {
        const vmax = Math.max(...P.figure.map(x => Math.hypot(...x.vel)), 1)
        const k = (0.12 * cam.maxDist) / vmax
        for (const x of P.figure) {
          const a = pos.get(x.hip)
          const b = a && project(add(posAt(x, t), mul(x.vel, k)))
          if (!a || !b) continue
          const gi = P.kin?.groupOf.get(x.hip)
          const col = gi !== undefined ? KIN_COLORS[gi % KIN_COLORS.length] : 'rgba(210,220,255,0.5)'
          drawArrow(ctx, a[0], a[1], b[0], b[1], col, s * (gi !== undefined ? 0.9 : 0.25))
        }
      }

      // --- 7. figure lines: draw themselves in; kin lines flow -------------
      ctx.lineCap = 'round'
      for (const seg of P.lines) {
        for (let i = 1; i < seg.length; i++) {
          const a = pos.get(seg[i - 1]), b = pos.get(seg[i])
          if (!a || !b) continue
          const prog = easeOut((now - (S.born.get(segKey(seg[i - 1], seg[i])) ?? 0)) / 380)
          if (prog <= 0) continue
          const bx = a[0] + (b[0] - a[0]) * prog, by = a[1] + (b[1] - a[1]) * prog
          const ga = P.kin?.groupOf.get(seg[i - 1]), gb = P.kin?.groupOf.get(seg[i])
          if (ga !== undefined && ga === gb) {
            const col = KIN_COLORS[ga % KIN_COLORS.length]
            ctx.strokeStyle = col
            ctx.globalAlpha = 0.22
            ctx.lineWidth = 8
            ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(bx, by); ctx.stroke()
            ctx.globalAlpha = 1
            ctx.lineWidth = 2
            ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(bx, by); ctx.stroke()
          } else {
            ctx.strokeStyle = 'rgba(190,205,255,0.35)'
            ctx.lineWidth = 1
            ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(bx, by); ctx.stroke()
          }
        }
      }

      // --- 8. figure stars: pop in, twinkle, kin halos, labels -------------
      ctx.font = '500 12px Inter, system-ui, sans-serif'
      const placed: [number, number, number, number][] = sun && s > 0.02 ? [[sun[0] + 8, sun[1] - 26, 84, 18]] : []
      const free = (r: [number, number, number, number]) =>
        placed.every(o => r[0] > o[0] + o[2] || r[0] + r[2] < o[0] || r[1] > o[1] + o[3] || r[1] + r[3] < o[1])
      const depthRef = cam.R
      for (const x of [...P.figure].sort((a, b) => a.vmag - b.vmag)) {
        const q = pos.get(x.hip)
        if (!q) continue
        const pop = easeOut((now - (S.starBorn.get(x.hip) ?? 0)) / 500)
        if (pop <= 0) continue
        const persp = s > 0.02 ? Math.max(0.65, Math.min(1.7, Math.sqrt(depthRef / q[2]))) ** s : 1
        const r = (starRadius(x.vmag) + 0.8) * persp * (0.4 + 0.6 * pop) * (pop < 1 ? 1 + 0.6 * Math.sin(pop * Math.PI) : 1)
        const col = bvColor(x.bv)
        const glowR = r * 4
        const glow = ctx.createRadialGradient(q[0], q[1], 0, q[0], q[1], glowR)
        glow.addColorStop(0, rgba(col, 0.5 * pop)); glow.addColorStop(1, rgba(col, 0))
        ctx.fillStyle = glow
        ctx.beginPath(); ctx.arc(q[0], q[1], glowR, 0, Math.PI * 2); ctx.fill()
        ctx.fillStyle = '#fff'
        ctx.globalAlpha = pop
        ctx.beginPath(); ctx.arc(q[0], q[1], r * 0.55, 0, Math.PI * 2); ctx.fill()
        ctx.fillStyle = col
        ctx.beginPath(); ctx.arc(q[0], q[1], r, 0, Math.PI * 2); ctx.globalAlpha = 0.65 * pop; ctx.fill()
        ctx.globalAlpha = 1
        const gi = P.kin?.groupOf.get(x.hip)
        if (gi !== undefined) {
          ctx.strokeStyle = KIN_COLORS[gi % KIN_COLORS.length]
          ctx.lineWidth = 1.4
          ctx.beginPath(); ctx.arc(q[0], q[1], r + 5, 0, Math.PI * 2); ctx.stroke()
        }
        if (x.name || s > 0.5 || x.hip === P.focus) {
          const label = x.label.toLowerCase()
          const w = ctx.measureText(label).width
          const rect: [number, number, number, number] = [q[0] + r + 6, q[1] - r - 15, w + 2, 15]
          if (free(rect) || x.hip === P.focus) {
            placed.push(rect)
            ctx.fillStyle = `rgba(225,232,250,${0.85 * pop})`
            ctx.fillText(label, q[0] + r + 7, q[1] - r - 3)
          }
        }
      }

      // --- 9. you are here: a little earth ----------------------------------
      if (sun && s > 0.02) {
        ctx.globalAlpha = s
        const cyc = (now / 1000) % 2.4
        ctx.strokeStyle = `rgba(120,200,255,${0.55 * (1 - cyc / 2.4)})`
        ctx.lineWidth = 1.2
        ctx.beginPath(); ctx.arc(sun[0], sun[1], 12 + cyc * 12, 0, Math.PI * 2); ctx.stroke()
        drawGlobe(ctx, sun[0], sun[1], 7 + 4 * s, now)
        ctx.font = '600 12px Inter, system-ui, sans-serif'
        ctx.fillStyle = '#e6f5ff'
        ctx.fillText('you are here', sun[0] + 16, sun[1] - 14)
        ctx.globalAlpha = 1
      }

      // --- 10. focus + pen markers -----------------------------------------
      for (const [hip, colour] of [[P.focus, '#ffffff'], [P.pending, '#7cf0ff']] as const) {
        if (hip == null) continue
        const q = pos.get(hip)
        if (!q) continue
        const pulse = 13 + 3 * Math.sin(now * 0.006)
        ctx.strokeStyle = colour
        ctx.lineWidth = 1.5
        ctx.beginPath(); ctx.arc(q[0], q[1], pulse, 0, Math.PI * 2); ctx.stroke()
      }
      hits.current = pos
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [dust])

  // resize
  useEffect(() => {
    const cv = ref.current!
    const ro = new ResizeObserver(() => {
      const r = cv.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      cv.width = Math.round(r.width * dpr)
      cv.height = Math.round(r.height * dpr)
      st.current.W = r.width
      st.current.H = r.height
    })
    ro.observe(cv)
    return () => ro.disconnect()
  }, [])

  // interaction
  useEffect(() => {
    const cv = ref.current!
    const S = st.current
    let drag: { x: number; y: number; moved: boolean; view: View } | null = null
    const hit = (x: number, y: number) => {
      let best: number | null = null, bd = 14
      for (const [hip, q] of hits.current) {
        const dd = Math.hypot(q[0] - x, q[1] - y)
        if (dd < bd) { bd = dd; best = hip }
      }
      return best
    }
    const local = (e: PointerEvent | WheelEvent) => {
      const r = cv.getBoundingClientRect()
      return [e.clientX - r.left, e.clientY - r.top]
    }
    const touch = () => {
      S.lastInteract = performance.now()
      props.current.onInteract()
    }
    const down = (e: PointerEvent) => {
      cv.setPointerCapture(e.pointerId)
      touch()
      // bake the idle sway into the real view so grabbing doesn't jump
      const v = { ...props.current.view, yaw: props.current.view.yaw + S.autoYaw }
      S.autoAmp = 0
      S.autoYaw = 0
      if (v.yaw !== props.current.view.yaw) props.current.onView(v)
      drag = { x: e.clientX, y: e.clientY, moved: false, view: v }
      S.dragging = true
    }
    const move = (e: PointerEvent) => {
      const [x, y] = local(e)
      if (!drag) {
        const h = hit(x, y)
        cv.style.cursor = h != null ? 'pointer' : 'grab'
        props.current.onHover(h, x, y)
        return
      }
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y
      if (Math.hypot(dx, dy) > 4) drag.moved = true
      if (!drag.moved) return
      touch()
      cv.style.cursor = 'grabbing'
      props.current.onHover(null, 0, 0)
      const v = drag.view
      const P = props.current
      if (P.building && P.unfold < 0.02 && Math.abs(v.yaw) < 1e-3 && Math.abs(v.pitch) < 1e-3) {
        const k = 180 / Math.PI / (S.F || 800)
        P.onView({ ...v, ra: (v.ra + (dx * k) / Math.max(0.15, Math.cos((v.dec * Math.PI) / 180)) + 360) % 360,
          dec: Math.max(-89, Math.min(89, v.dec + dy * k)) })
      } else {
        P.onView({ ...v, yaw: v.yaw - dx * 0.006, pitch: Math.max(-1.3, Math.min(1.0, v.pitch + dy * 0.006)) })
      }
    }
    const up = (e: PointerEvent) => {
      if (drag && !drag.moved) {
        const [x, y] = local(e)
        props.current.onStarClick(hit(x, y))
      }
      drag = null
      S.dragging = false
      cv.style.cursor = 'grab'
    }
    const leave = () => props.current.onHover(null, 0, 0)
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      touch()
      const v = props.current.view
      props.current.onView({ ...v, zoom: Math.max(0.25, Math.min(8, v.zoom * Math.exp(-e.deltaY * 0.0015))) })
    }
    cv.addEventListener('pointerdown', down)
    cv.addEventListener('pointermove', move)
    cv.addEventListener('pointerup', up)
    cv.addEventListener('pointerleave', leave)
    cv.addEventListener('wheel', wheel, { passive: false })
    return () => {
      cv.removeEventListener('pointerdown', down)
      cv.removeEventListener('pointermove', move)
      cv.removeEventListener('pointerup', up)
      cv.removeEventListener('pointerleave', leave)
      cv.removeEventListener('wheel', wheel)
    }
  }, [])

  return <canvas ref={ref} className="cx-canvas" aria-label="interactive 3d view of the constellation" />
}

function hexToRgb(hex: string) {
  const n = parseInt(hex.slice(1), 16)
  return `rgb(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255})`
}

function drawArrow(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, col: string, alpha: number) {
  const len = Math.hypot(x1 - x0, y1 - y0)
  if (len < 4) return
  const ux = (x1 - x0) / len, uy = (y1 - y0) / len
  ctx.globalAlpha = alpha
  ctx.strokeStyle = col
  ctx.fillStyle = col
  ctx.lineWidth = 1.3
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1 - ux * 5, y1 - uy * 5); ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(x1 - ux * 7 - uy * 3.5, y1 - uy * 7 + ux * 3.5)
  ctx.lineTo(x1 - ux * 7 + uy * 3.5, y1 - uy * 7 - ux * 3.5)
  ctx.closePath(); ctx.fill()
  ctx.globalAlpha = 1
}

// continents as (longitude, latitude, size) blobs, enough to read as "earth" at a few pixels
const LAND: [number, number, number][] = [
  [0.3, 0.75, 0.42], [-0.2, 0.15, 0.34], [0.1, -0.35, 0.3], [1.6, 0.85, 0.5], [2.2, 0.5, 0.42], [2.4, -0.45, 0.28],
  [-1.6, 0.8, 0.45], [-1.4, 0.3, 0.25], [-1.0, -0.4, 0.33], [3.0, 0.3, 0.2], [0.8, -1.3, 0.5], [-2.6, 1.2, 0.3],
]

function drawGlobe(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, now: number) {
  const atm = ctx.createRadialGradient(x, y, r * 0.8, x, y, r * 2.6)
  atm.addColorStop(0, 'rgba(110,190,255,0.55)'); atm.addColorStop(1, 'rgba(110,190,255,0)')
  ctx.fillStyle = atm
  ctx.beginPath(); ctx.arc(x, y, r * 2.6, 0, Math.PI * 2); ctx.fill()
  ctx.save()
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.clip()
  const sea = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, 0, x, y, r)
  sea.addColorStop(0, '#3d8cf0'); sea.addColorStop(1, '#0b2a6b')
  ctx.fillStyle = sea
  ctx.fillRect(x - r, y - r, r * 2, r * 2)
  const rot = now * 0.0004
  for (const [lon, lat, size] of LAND) {
    const a = lon + rot
    const cz = Math.cos(a) * Math.cos(lat)
    if (cz <= 0) continue
    const px = x + r * Math.sin(a) * Math.cos(lat), py = y - r * Math.sin(lat)
    ctx.fillStyle = `rgba(110,170,95,${0.55 + 0.35 * cz})`
    ctx.beginPath(); ctx.ellipse(px, py, r * size * cz, r * size * 0.75, 0, 0, Math.PI * 2); ctx.fill()
  }
  const night = ctx.createLinearGradient(x - r, y - r, x + r, y + r)
  night.addColorStop(0, 'rgba(0,0,0,0)'); night.addColorStop(0.55, 'rgba(0,0,0,0.05)'); night.addColorStop(1, 'rgba(0,4,20,0.75)')
  ctx.fillStyle = night
  ctx.fillRect(x - r, y - r, r * 2, r * 2)
  ctx.restore()
  ctx.strokeStyle = 'rgba(170,220,255,0.8)'
  ctx.lineWidth = 0.8
  ctx.beginPath(); ctx.arc(x, y, r, Math.PI * 0.9, Math.PI * 1.75); ctx.stroke()
}

/** The curve of the planet along the bottom of the screen, with its thin blue atmosphere and city lights. */
function drawHorizon(ctx: CanvasRenderingContext2D, W: number, H: number, alpha: number, now: number) {
  const R = Math.max(W, H) * 1.25
  const cx = W / 2, cy = H - H * 0.1 + R
  ctx.save()
  ctx.globalAlpha = alpha
  const glow = ctx.createRadialGradient(cx, cy, R - 4, cx, cy, R + 90)
  glow.addColorStop(0, 'rgba(120,190,255,0.55)'); glow.addColorStop(0.08, 'rgba(80,140,255,0.22)'); glow.addColorStop(1, 'rgba(60,100,255,0)')
  ctx.fillStyle = glow
  ctx.beginPath(); ctx.arc(cx, cy, R + 90, 0, Math.PI * 2); ctx.fill()
  const ground = ctx.createLinearGradient(0, cy - R, 0, H)
  ground.addColorStop(0, '#0a1834'); ground.addColorStop(0.5, '#040a18')
  ctx.fillStyle = ground
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill()
  ctx.strokeStyle = 'rgba(170,220,255,0.75)'
  ctx.lineWidth = 1.2
  ctx.beginPath(); ctx.arc(cx, cy, R, Math.PI * 1.2, Math.PI * 1.8); ctx.stroke()
  // city lights flickering on the night side
  for (let i = 0; i < 70; i++) {
    const a = Math.PI * 1.5 + (((i * 0.6180339) % 1) - 0.5) * 0.9
    const depth = 6 + ((i * 37) % 60)
    const px = cx + Math.cos(a) * (R - depth), py = cy + Math.sin(a) * (R - depth)
    if (py > H) continue
    ctx.fillStyle = `rgba(255,200,120,${0.25 + 0.25 * Math.sin(now * 0.003 + i * 2.1)})`
    ctx.fillRect(px, py, 1.4, 1.4)
  }
  ctx.restore()
}
