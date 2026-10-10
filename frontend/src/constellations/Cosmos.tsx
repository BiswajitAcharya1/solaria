// Particle prologue for the start-up screen. One canvas plays four cosmic chapters:
//   0 big bang: a hot flash, matter flies outward and cools
//   1 first stars: gravity pulls matter into clumps that ignite
//   2 galaxies: matter settles into a turning two-armed spiral (the milky way)
//   3 the sun: we zoom into an arm; a cloud collapses into the sun and its sibling stars drift apart
import { useEffect, useRef } from 'react'

const N = 1800
const SEEDS = 34

export default function Cosmos({ chapter }: { chapter: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const chap = useRef(chapter)
  chap.current = chapter

  useEffect(() => {
    const cv = ref.current!
    const ctx = cv.getContext('2d')!
    const x = new Float32Array(N), y = new Float32Array(N), vx = new Float32Array(N), vy = new Float32Array(N)
    const seed = new Uint8Array(N), heat = new Float32Array(N), tw = new Float32Array(N)
    const tx = new Float32Array(N), ty = new Float32Array(N)
    const sx: number[] = [], sy: number[] = []
    for (let k = 0; k < SEEDS; k++) {
      const a = Math.random() * Math.PI * 2, r = 0.25 + Math.random() * 0.75
      sx.push(Math.cos(a) * r * 1.5); sy.push(Math.sin(a) * r)
    }
    for (let i = 0; i < N; i++) {
      const a = Math.random() * Math.PI * 2, sp = 0.25 + Math.sqrt(Math.random()) * 1.6
      vx[i] = Math.cos(a) * sp; vy[i] = Math.sin(a) * sp
      seed[i] = Math.floor(Math.random() * SEEDS)
      tw[i] = Math.random() * 6.28
      // spiral target: two log-spiral arms plus a bulge, flattened as if seen at an angle
      const bulge = i % 5 === 0
      const r = bulge ? Math.random() ** 2 * 0.18 : 0.08 + Math.random() ** 0.7 * 0.92
      const th = bulge ? Math.random() * 6.28 : (i % 2) * Math.PI + Math.log(r * 12 + 1) * 2.1 + (Math.random() - 0.5) * 0.5
      tx[i] = Math.cos(th) * r; ty[i] = Math.sin(th) * r * 0.5
    }
    // the sun's birth cluster
    const sib = Array.from({ length: 9 }, () => ({ a: Math.random() * 6.28, sp: 0.03 + Math.random() * 0.05 }))

    let raf = 0, last = performance.now(), chStart = last, cur = -1
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      if (chap.current !== cur) { cur = chap.current; chStart = now }
      const tc = (now - chStart) / 1000
      const W = cv.clientWidth, H = cv.clientHeight, dpr = window.devicePixelRatio || 1
      if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr) }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.globalCompositeOperation = 'source-over'
      ctx.fillStyle = 'rgba(2,3,10,0.32)' // motion trails
      ctx.fillRect(0, 0, W, H)
      const S = Math.min(W, H) * 0.42, cx = W / 2, cy = H / 2 - 40
      ctx.globalCompositeOperation = 'lighter'

      if (cur === 0) {
        // the flash
        const f = Math.max(0, 1 - tc / 1.4)
        if (f > 0) {
          const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, S * (0.2 + tc * 1.4))
          g.addColorStop(0, `rgba(255,250,235,${f})`); g.addColorStop(0.4, `rgba(255,190,120,${0.6 * f})`); g.addColorStop(1, 'rgba(255,120,60,0)')
          ctx.fillStyle = g
          ctx.fillRect(0, 0, W, H)
        }
      }
      for (let i = 0; i < N; i++) {
        if (cur === 0) {
          x[i] += vx[i] * dt; y[i] += vy[i] * dt
          const damp = Math.exp(-dt * 1.1)
          vx[i] *= damp; vy[i] *= damp
          heat[i] = Math.max(0, 1 - tc / 3.2)
        } else if (cur === 1) {
          const k = 1 - Math.exp(-dt * 0.9)
          x[i] += (sx[seed[i]] + (vx[i] * 0.04) - x[i]) * k
          y[i] += (sy[seed[i]] + (vy[i] * 0.04) - y[i]) * k
          heat[i] = 0
        } else {
          const rot = (now / 1000) * 0.22
          const c = Math.cos(rot), s = Math.sin(rot)
          const gx = tx[i] * c - ty[i] * 2 * s * 0.5, gy = (tx[i] * s + ty[i] * 2 * c) * 0.5
          const k = 1 - Math.exp(-dt * (cur === 2 ? 1.3 : 3))
          x[i] += (gx - x[i]) * k; y[i] += (gy - y[i]) * k
        }
      }

      // chapter 3: zoom toward a point on an arm, as the galaxy fades
      const zoom = cur === 3 ? 1 + Math.min(1, tc / 1.6) ** 2 * 5 : 1
      const fade = cur === 3 ? Math.max(0, 1 - tc / 1.8) : 1
      const fx = cur === 3 ? 0.42 : 0, fy = cur === 3 ? 0.06 : 0
      for (let i = 0; i < N; i++) {
        const px = cx + (x[i] - fx) * S * zoom, py = cy + (y[i] - fy) * S * zoom
        if (px < -5 || px > W + 5 || py < -5 || py > H + 5) continue
        let r = 255, g = 255, b = 255, a = 0.55
        if (cur === 0) {
          const h = heat[i]
          r = 255; g = Math.round(150 + 105 * h); b = Math.round(90 + 165 * h * h); a = 0.25 + 0.6 * h
        } else if (cur === 1) {
          const ignite = Math.min(1, Math.max(0, tc - 0.8 - (i % 40) * 0.04))
          r = Math.round(200 - 40 * ignite); g = Math.round(150 + 60 * ignite); b = 255
          a = 0.12 + 0.6 * ignite * (0.7 + 0.3 * Math.sin(now * 0.004 + tw[i]))
        } else {
          const core = Math.hypot(tx[i], ty[i] * 2) < 0.2
          r = core ? 255 : 190; g = core ? 225 : 210; b = core ? 170 : 255
          a = (0.35 + 0.3 * Math.sin(now * 0.003 + tw[i])) * fade
        }
        ctx.fillStyle = `rgba(${r},${g},${b},${a})`
        const sz = cur === 1 ? 1.6 : 1.3
        ctx.fillRect(px, py, sz, sz)
      }
      if (cur >= 2 && fade > 0) {
        const g = ctx.createRadialGradient(cx - fx * S * zoom, cy - fy * S * zoom, 0, cx - fx * S * zoom, cy - fy * S * zoom, S * 0.35 * zoom)
        g.addColorStop(0, `rgba(255,220,160,${0.35 * fade})`); g.addColorStop(1, 'rgba(255,200,140,0)')
        ctx.fillStyle = g
        ctx.fillRect(0, 0, W, H)
      }

      if (cur === 3) {
        // a cloud collapses, the sun ignites, its siblings drift away
        const collapse = Math.min(1, Math.max(0, (tc - 0.6) / 1.4))
        const cloudR = S * (0.5 - 0.44 * collapse)
        const neb = ctx.createRadialGradient(cx, cy, 0, cx, cy, cloudR)
        neb.addColorStop(0, `rgba(255,170,120,${0.25 + 0.3 * collapse})`); neb.addColorStop(1, 'rgba(140,80,200,0)')
        ctx.fillStyle = neb
        ctx.beginPath(); ctx.arc(cx, cy, cloudR, 0, Math.PI * 2); ctx.fill()
        const lit = Math.min(1, Math.max(0, (tc - 1.8) / 0.6))
        if (lit > 0) {
          const sg = ctx.createRadialGradient(cx, cy, 0, cx, cy, 60 + 20 * Math.sin(now * 0.003))
          sg.addColorStop(0, `rgba(255,250,225,${lit})`); sg.addColorStop(0.25, `rgba(255,210,110,${0.8 * lit})`); sg.addColorStop(1, 'rgba(255,170,60,0)')
          ctx.fillStyle = sg
          ctx.beginPath(); ctx.arc(cx, cy, 80, 0, Math.PI * 2); ctx.fill()
          const drift = Math.max(0, tc - 2.1)
          ctx.globalCompositeOperation = 'source-over'
          for (const s of sib) {
            const d = S * (0.06 + s.sp * drift * 2.2)
            const px = cx + Math.cos(s.a) * d, py = cy + Math.sin(s.a) * d * 0.8
            ctx.strokeStyle = `rgba(255,201,92,${0.35 * lit * Math.max(0, 1 - drift / 3)})`
            ctx.setLineDash([2, 4])
            ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(px, py); ctx.stroke()
            ctx.setLineDash([])
            ctx.fillStyle = `rgba(255,236,200,${lit})`
            ctx.beginPath(); ctx.arc(px, py, 2.4, 0, Math.PI * 2); ctx.fill()
          }
        }
      }
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [])

  return <canvas ref={ref} className="cx-cosmos" aria-hidden />
}
