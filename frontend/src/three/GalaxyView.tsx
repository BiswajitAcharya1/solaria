import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { useApp } from '../store'
import { colormap, COLOR_FIELDS } from './colormap'

// Galactic heliocentric (X toward GC, Y rotation, Z NGP) [pc] -> three.js (x, y-up, z)
const toV = (X: number, Y: number, Z: number) => new THREE.Vector3(X, Z, -Y)

const TRAJ_COLORS = [0x7f9b84, 0xc77c5c, 0x739192, 0xa87986, 0x91799b, 0xb08a5d, 0x8fa37a, 0xc19a78]

export default function GalaxyView({ onPick }: { onPick: (index: number) => void }) {
  const mount = useRef<HTMLDivElement>(null)
  const ctx = useRef<any>({})
  const { points, colorBy, group, orbits, time, activePotential, selected } = useApp()

  // --- scene setup -------------------------------------------------------
  useEffect(() => {
    const el = mount.current!
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(el.clientWidth, el.clientHeight)
    el.appendChild(renderer.domElement)
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(50, el.clientWidth / el.clientHeight, 1, 200000)
    camera.position.set(-1800, 1500, 2200)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.target.set(0, 0, 0)

    // reference geometry: distance rings in the Galactic plane, GC direction, Sun
    const ref = new THREE.Group()
    for (const r of [100, 500, 1000, 2000, 4000]) {
      const g = new THREE.BufferGeometry().setFromPoints(
        Array.from({ length: 181 }, (_, i) => { const a = (i / 180) * Math.PI * 2; return toV(r * Math.cos(a), r * Math.sin(a), 0) }))
      ref.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0x514c42, transparent: true, opacity: 0.66 })))
      const lab = makeLabel(`${r >= 1000 ? r / 1000 + ' kpc' : r + ' pc'}`, '#8f897d')
      lab.position.copy(toV(r * 0.707, -r * 0.707, 0))
      ref.add(lab)
    }
    const arrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 0), 1500, 0xc77c5c, 80, 40)
    ref.add(arrow)
    const gcl = makeLabel('→ Galactic centre', '#c77c5c'); gcl.position.copy(toV(1650, 0, 0)); ref.add(gcl)
    const rot = new THREE.ArrowHelper(new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 0, 0), 800, 0x7f9b84, 60, 30)
    ref.add(rot)
    const rl = makeLabel('→ Galactic rotation', '#7f9b84'); rl.position.copy(toV(0, 900, 0)); ref.add(rl)
    const ngp = makeLabel('↑ NGP', '#8f897d'); ngp.position.copy(toV(0, 0, 700)); ref.add(ngp)
    const sun = new THREE.Mesh(new THREE.SphereGeometry(12, 16, 16), new THREE.MeshBasicMaterial({ color: 0xd9bc83 }))
    ref.add(sun)
    const sunl = makeLabel('Sun (today)', '#d9bc83'); sunl.position.set(0, 40, 0); ref.add(sunl)
    scene.add(ref)

    const raycaster = new THREE.Raycaster()
    raycaster.params.Points = { threshold: 6 }
    const mouse = new THREE.Vector2()
    let down = { x: 0, y: 0 }
    const onDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY } }
    const onUp = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return
      const c = ctx.current
      if (!c.cloud) return
      const rect = renderer.domElement.getBoundingClientRect()
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(mouse, camera)
      // threshold scales with distance to the target so picking works when zoomed out
      raycaster.params.Points = { threshold: Math.max(2, camera.position.distanceTo(controls.target) / 300) }
      const hits = raycaster.intersectObject(c.cloud)
      if (hits.length) onPickRef.current(hits[0].index!)
    }
    renderer.domElement.addEventListener('pointerdown', onDown)
    renderer.domElement.addEventListener('pointerup', onUp)

    const onResize = () => {
      camera.aspect = el.clientWidth / el.clientHeight
      camera.updateProjectionMatrix()
      renderer.setSize(el.clientWidth, el.clientHeight)
    }
    const ro = new ResizeObserver(onResize)
    ro.observe(el)

    let raf = 0
    const loop = () => {
      controls.update()
      renderer.render(scene, camera)
      raf = requestAnimationFrame(loop)
    }
    loop()
    ctx.current = { renderer, scene, camera, controls }
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      renderer.dispose()
      el.removeChild(renderer.domElement)
    }
  }, [])

  const onPickRef = useRef(onPick)
  onPickRef.current = onPick

  // --- star cloud ----------------------------------------------------------
  useEffect(() => {
    const c = ctx.current
    if (!points || !c.scene) return
    const X = points.col('X'), Y = points.col('Y'), Z = points.col('Z')
    const pos = new Float32Array(points.n * 3)
    for (let i = 0; i < points.n; i++) { pos[3 * i] = X[i]; pos[3 * i + 1] = Z[i]; pos[3 * i + 2] = -Y[i] }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(points.n * 3), 3))
    const mat = new THREE.PointsMaterial({ size: 2.2, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.75, depthWrite: false })
    const cloud = new THREE.Points(geo, mat)
    c.scene.add(cloud)
    c.cloud = cloud
    return () => { c.scene.remove(cloud); geo.dispose(); mat.dispose(); c.cloud = null }
  }, [points])

  useEffect(() => {
    const c = ctx.current
    if (!points || !c.cloud) return
    const f = COLOR_FIELDS[colorBy]
    const v = f.transform ? Array.from(points.col(f.col), f.transform) : points.col(f.col)
    const col = c.cloud.geometry.getAttribute('color') as THREE.BufferAttribute
    const arr = col.array as Float32Array
    for (let i = 0; i < points.n; i++) {
      const [r, g, b] = colormap((v[i] - f.min) / (f.max - f.min), f.cmap)
      if (Number.isFinite(v[i])) { arr[3 * i] = r; arr[3 * i + 1] = g; arr[3 * i + 2] = b }
      else { arr[3 * i] = 0.25; arr[3 * i + 1] = 0.28; arr[3 * i + 2] = 0.35 }
    }
    col.needsUpdate = true
  }, [points, colorBy])

  // --- highlighted group --------------------------------------------------
  useEffect(() => {
    const c = ctx.current
    if (!c.scene) return
    if (c.groupObj) { c.scene.remove(c.groupObj); c.groupObj = null }
    if (!group || !points) return
    let cancelled = false
    fetch(`/api/indices?ids=${group.ids.join(',')}`).then(r => r.json()).then((idx: number[]) => {
      if (cancelled) return
      const X = points.col('X'), Y = points.col('Y'), Z = points.col('Z')
      const pos = new Float32Array(idx.length * 3)
      idx.forEach((i, k) => { pos[3 * k] = X[i]; pos[3 * k + 1] = Z[i]; pos[3 * k + 2] = -Y[i] })
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
      const obj = new THREE.Points(geo, new THREE.PointsMaterial({ size: 7, sizeAttenuation: false, color: 0xa87986, transparent: true, opacity: 0.95 }))
      c.scene.add(obj)
      c.groupObj = obj
      if (idx.length) {
        const ctr = new THREE.Vector3()
        idx.forEach(i => ctr.add(toV(X[i], Y[i], Z[i])))
        ctr.divideScalar(idx.length)
        flyTo(c, ctr, 450)
      }
    })
    return () => { cancelled = true }
  }, [group, points])

  // --- selected star marker ---------------------------------------------
  useEffect(() => {
    const c = ctx.current
    if (!c.scene) return
    if (c.selObj) { c.scene.remove(c.selObj); c.selObj = null }
    if (!selected || !points) return
    let cancelled = false
    fetch(`/api/indices?ids=${selected}`).then(r => r.json()).then((idx: number[]) => {
      if (cancelled || !idx.length) return
      const i = idx[0]
      const p = toV(points.col('X')[i], points.col('Y')[i], points.col('Z')[i])
      const ring = new THREE.Mesh(new THREE.RingGeometry(10, 13, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }))
      ring.position.copy(p)
      ring.onBeforeRender = (_r, _s, cam) => ring.quaternion.copy(cam.quaternion)
      c.scene.add(ring)
      c.selObj = ring
    })
    return () => { cancelled = true }
  }, [selected, points])

  // --- trajectories -----------------------------------------------------------
  useEffect(() => {
    const c = ctx.current
    if (!c.scene) return
    if (c.trajObj) { c.scene.remove(c.trajObj); c.trajObj = null }
    const run = orbits?.runs[activePotential]
    if (!run) return
    const grp = new THREE.Group()
    const t = run.times_myr
    const k = Math.max(0, t.findIndex(v => v <= time))  // index for current time
    run.stars.forEach((s, si) => {
      const color = TRAJ_COLORS[si % TRAJ_COLORS.length]
      // MC samples (faint)
      for (const smp of s.samples) {
        const g = new THREE.BufferGeometry().setFromPoints(smp.slice(0, k + 1).map(p => toV(p[0], p[1], p[2])))
        grp.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.18 })))
      }
      const g = new THREE.BufferGeometry().setFromPoints(s.nominal.slice(0, k + 1).map(p => toV(p[0], p[1], p[2])))
      grp.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color, linewidth: 2 })))
      // position at time t: nominal + sample cloud
      const cloudPos: number[] = []
      for (const smp of s.samples) { const p = smp[k]; cloudPos.push(p[0], p[2], -p[1]) }
      const cg = new THREE.BufferGeometry()
      cg.setAttribute('position', new THREE.Float32BufferAttribute(cloudPos, 3))
      grp.add(new THREE.Points(cg, new THREE.PointsMaterial({ color, size: 4, sizeAttenuation: false, transparent: true, opacity: 0.6 })))
      const head = new THREE.Mesh(new THREE.SphereGeometry(7, 12, 12), new THREE.MeshBasicMaterial({ color }))
      const p = s.nominal[k]
      head.position.copy(toV(p[0], p[1], p[2]))
      grp.add(head)
    })
    c.scene.add(grp)
    c.trajObj = grp
  }, [orbits, time, activePotential])

  // fly to trajectories when a new orbit result arrives
  useEffect(() => {
    const c = ctx.current
    const run = orbits?.runs[activePotential]
    if (!run || !c.camera) return
    const all = run.stars.flatMap(s => s.nominal)
    const box = new THREE.Box3()
    all.forEach(p => box.expandByPoint(toV(p[0], p[1], p[2])))
    const ctr = box.getCenter(new THREE.Vector3())
    flyTo(c, ctr, Math.max(300, box.getSize(new THREE.Vector3()).length() * 0.9))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orbits])

  return <div ref={mount} style={{ position: 'absolute', inset: 0 }} />
}

function flyTo(c: any, target: THREE.Vector3, dist: number) {
  const dir = c.camera.position.clone().sub(c.controls.target).normalize()
  const startT = c.controls.target.clone(), startP = c.camera.position.clone()
  const endP = target.clone().add(dir.multiplyScalar(dist))
  const t0 = performance.now()
  const step = () => {
    const u = Math.min(1, (performance.now() - t0) / 700)
    const e = u * u * (3 - 2 * u)
    c.controls.target.lerpVectors(startT, target, e)
    c.camera.position.lerpVectors(startP, endP, e)
    if (u < 1) requestAnimationFrame(step)
  }
  step()
}

function makeLabel(text: string, color: string) {
  const cv = document.createElement('canvas')
  const ctx = cv.getContext('2d')!
  ctx.font = '500 28px Inter, sans-serif'
  const w = Math.ceil(ctx.measureText(text).width) + 16
  cv.width = w; cv.height = 40
  ctx.font = '500 28px Inter, sans-serif'
  ctx.fillStyle = color
  ctx.fillText(text, 8, 30)
  const tex = new THREE.CanvasTexture(cv)
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, sizeAttenuation: false }))
  sp.scale.set(w / 1000 * 0.9, 0.036, 1)
  sp.center.set(0, 0.5)
  return sp
}
