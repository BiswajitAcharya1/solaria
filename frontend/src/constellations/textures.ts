// Procedural textures (no image downloads): 3D value noise sampled on the sphere, so maps have no seam.
//   starSurface()  granulation for star spheres (greyscale; the shader tints it with the star's real colour)
//   earthMaps()    day colour, clouds and night-lights for the earth globe. continents are invented
//                  (an illustration of "a planet like ours"), not a geographic map.
import * as THREE from 'three'

function makeNoise(seed: number) {
  const perm = new Uint8Array(512)
  const p = Array.from({ length: 256 }, (_, i) => i)
  let s = seed
  for (let i = 255; i > 0; i--) { s = (s * 16807) % 2147483647; const j = s % (i + 1); [p[i], p[j]] = [p[j], p[i]] }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255]
  const h = (x: number, y: number, z: number) => perm[(perm[(perm[x & 255] + y) & 255] + z) & 255] / 255
  const sm = (t: number) => t * t * (3 - 2 * t)
  const noise = (x: number, y: number, z: number) => {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z)
    const xf = sm(x - xi), yf = sm(y - yi), zf = sm(z - zi)
    const l = (a: number, b: number, t: number) => a + (b - a) * t
    return l(
      l(l(h(xi, yi, zi), h(xi + 1, yi, zi), xf), l(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), xf), yf),
      l(l(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), xf), l(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), xf), yf), zf)
  }
  return (x: number, y: number, z: number, oct = 5) => {
    let a = 0.5, f = 1, sum = 0, norm = 0
    for (let o = 0; o < oct; o++) { sum += a * noise(x * f, y * f, z * f); norm += a; a *= 0.5; f *= 2.03 }
    return sum / norm
  }
}

function sphereMap(w: number, h: number, fn: (x: number, y: number, z: number, lat: number) => [number, number, number, number]) {
  const cv = document.createElement('canvas')
  cv.width = w; cv.height = h
  const ctx = cv.getContext('2d')!
  const img = ctx.createImageData(w, h)
  for (let j = 0; j < h; j++) {
    const lat = Math.PI * (0.5 - (j + 0.5) / h)
    for (let i = 0; i < w; i++) {
      const lon = 2 * Math.PI * ((i + 0.5) / w)
      const x = Math.cos(lat) * Math.cos(lon), y = Math.sin(lat), z = Math.cos(lat) * Math.sin(lon)
      const [r, g, b, a] = fn(x, y, z, lat)
      const k = (j * w + i) * 4
      img.data[k] = r; img.data[k + 1] = g; img.data[k + 2] = b; img.data[k + 3] = a
    }
  }
  ctx.putImageData(img, 0, 0)
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = THREE.RepeatWrapping
  tex.anisotropy = 4
  return tex
}

let starTex: THREE.Texture | null = null
/** Convection cells and bright plage: the boiling surface of a star. Shared by every star sphere. */
export function starSurface() {
  if (starTex) return starTex
  const n = makeNoise(11), m = makeNoise(29)
  starTex = sphereMap(512, 256, (x, y, z) => {
    const cells = 1 - Math.abs(2 * n(x * 9, y * 9, z * 9, 3) - 1) // ridged: bright granule walls
    const big = m(x * 2.2, y * 2.2, z * 2.2, 4)
    const v = Math.max(0, Math.min(1, 0.25 + 0.55 * cells ** 2.2 + 0.45 * (big - 0.5)))
    const c = Math.round(v * 255)
    return [c, c, c, 255]
  })
  return starTex
}

/** Day colour, clouds and city lights for the earth globe (illustrative continents). */
export function earthMaps() {
  const land = makeNoise(5), detail = makeNoise(17), cloud = makeNoise(41)
  const height = (x: number, y: number, z: number) => land(x * 1.6, y * 1.6, z * 1.6, 6) + 0.18 * (detail(x * 6, y * 6, z * 6, 4) - 0.5)
  const SEA = 0.53
  const day = sphereMap(1024, 512, (x, y, z, lat) => {
    const e = height(x, y, z)
    const polar = Math.abs(lat) > 1.2 + 0.08 * (detail(x * 4, y * 4, z * 4) - 0.5)
    if (polar) return [236, 242, 250, 255]
    if (e < SEA) {
      const d = Math.min(1, (SEA - e) / 0.12) // shallow shelves are lighter
      return [Math.round(18 + 30 * (1 - d)), Math.round(58 + 70 * (1 - d)), Math.round(120 + 70 * (1 - d)), 255]
    }
    const k = Math.min(1, (e - SEA) / 0.2)
    const dry = Math.abs(lat) < 0.45 ? 0.6 : 0.2 // deserts toward the tropics
    const g: [number, number, number] = [60 + 120 * dry * k, 110 + 40 * (1 - k) - 20 * dry, 55 + 30 * dry]
    return [Math.round(g[0]), Math.round(g[1]), Math.round(g[2]), 255]
  })
  const clouds = sphereMap(1024, 512, (x, y, z) => {
    const c = cloud(x * 3, y * 5, z * 3, 6)
    const a = Math.max(0, Math.min(1, (c - 0.5) * 3.2))
    return [255, 255, 255, Math.round(a * 220)]
  })
  const lights = sphereMap(1024, 512, (x, y, z, lat) => {
    const e = height(x, y, z)
    if (e < SEA + 0.01 || Math.abs(lat) > 1.1) return [0, 0, 0, 255]
    const city = detail(x * 40, y * 40, z * 40, 2)
    const v = city > 0.62 ? Math.min(1, (city - 0.62) * 6) : 0
    return [Math.round(255 * v), Math.round(190 * v), Math.round(110 * v), 255]
  })
  return { day, clouds, lights }
}
