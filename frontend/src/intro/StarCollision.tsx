// Real-time 3D intro: two stars alone in a black void spiral together, collide, and fling
// their matter into orbit around the merged remnant. Everything here is geometry in a
// three.js scene: shader-surfaced star spheres with coronae, a gravity-integrated gas
// cloud (tens of thousands of particles), lit and tumbling rock debris with orbit trails,
// a shock ring/shell, and a 3D starfield that only appears once the crash lights the sky.
import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import './collision.css'

// ---------------------------------------------------------------------------
// timeline (seconds) and physics constants (scene units)
// ---------------------------------------------------------------------------
const T_IN = 1.5 // stars fade in out of the black
const T_SPIRAL = 7.5 // inspiral duration
const A0 = 8 // starting separation
const R1 = 1.45, R2 = 1.1 // star radii (the bigger one is hotter)
const M1 = 1.3, M2 = 1.0
const GM = 60 // remnant gravity
const EPS2 = 0.3 // softening

const SIMPLEX = /* glsl */ `
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+10.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857; vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z);
  vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
  vec4 m=max(0.5-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;
  return 105.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}`

const SURFACE_VS = /* glsl */ `
varying vec3 vObj; varying vec3 vN; varying vec3 vView;
void main(){
  vObj = position;
  vN = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}`

// photosphere: convection granules, supergranule cells, starspots, limb darkening, hot rim
const STAR_FS = /* glsl */ `
uniform float uTime; uniform float uIntensity; uniform float uSeed; uniform vec3 uHot; uniform vec3 uCool;
varying vec3 vObj; varying vec3 vN; varying vec3 vView;
${SIMPLEX}
void main(){
  float a = uTime * 0.07 + uSeed; mat2 R = mat2(cos(a), -sin(a), sin(a), cos(a));
  vec3 p = normalize(vObj); p.xz = R * p.xz;
  float gran = snoise(p * 16.0 + vec3(0.0, uTime * 0.3, uSeed)) * 0.5 + 0.5;
  float fine = snoise(p * 40.0 - vec3(uTime * 0.5, 0.0, uSeed)) * 0.5 + 0.5;
  float cells = snoise(p * 5.0 + vec3(uSeed, uTime * 0.05, 0.0)) * 0.5 + 0.5;
  float spots = smoothstep(0.74, 0.9, snoise(p * 1.7 + uSeed * 3.1) * 0.5 + 0.5) * smoothstep(0.3, 0.7, snoise(p * 6.0 + uSeed) * 0.5 + 0.5);
  float mu = clamp(dot(normalize(vN), normalize(vView)), 0.0, 1.0);
  float limb = 0.28 + 0.72 * pow(mu, 0.6);
  vec3 col = mix(uCool, uHot, gran * 0.5 + fine * 0.15 + cells * 0.35);
  col *= 1.0 - spots * 0.45;
  col += uHot * pow(1.0 - mu, 4.0) * 0.5;
  gl_FragColor = vec4(col * limb * uIntensity, 1.0);
}`

// corona: back-facing shell, brightest at the limb, flickering streamers
const CORONA_FS = /* glsl */ `
uniform float uTime; uniform float uIntensity; uniform vec3 uColor;
varying vec3 vObj; varying vec3 vN; varying vec3 vView;
${SIMPLEX}
void main(){
  float f = max(-dot(normalize(vN), normalize(vView)), 0.0);
  float glow = pow(f, 2.6);
  float streak = snoise(normalize(vObj) * 4.0 + vec3(0.0, uTime * 0.4, 0.0)) * 0.5 + 0.5;
  glow *= 0.65 + 0.7 * streak;
  gl_FragColor = vec4(uColor * glow * uIntensity, 1.0);
}`

// gas / dust particles: colour from temperature, cooling over time
const PARTICLE_VS = /* glsl */ `
attribute float aSize; attribute float aCool; attribute float aAlive;
uniform float uAge; uniform float uScale; uniform float uBase;
varying vec3 vColor; varying float vAlpha;
void main(){
  float h = exp(-uAge * aCool);
  vec3 c = mix(vec3(0.45, 0.06, 0.02), vec3(1.0, 0.42, 0.1), smoothstep(0.0, 0.35, h));
  c = mix(c, vec3(1.0, 0.88, 0.68), smoothstep(0.3, 0.7, h));
  c = mix(c, vec3(0.72, 0.84, 1.0), smoothstep(0.72, 1.0, h));
  vColor = c * (0.75 + 1.5 * h * h);
  vAlpha = aAlive * uBase * (0.7 + 0.3 * h);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = max(1.0, aSize * uScale / -mv.z);
  gl_Position = projectionMatrix * mv;
}`
const PARTICLE_FS = /* glsl */ `
varying vec3 vColor; varying float vAlpha;
void main(){
  vec2 d = gl_PointCoord - 0.5;
  float a = exp(-dot(d, d) * 24.0);
  gl_FragColor = vec4(vColor * a * vAlpha, 1.0);
}`

// the night sky that only appears after the crash
const SKY_VS = /* glsl */ `
attribute float aSize; attribute vec3 aColor; attribute float aPhase;
uniform float uScale; uniform float uTime; uniform float uOpacity;
varying vec3 vColor;
void main(){
  float tw = 0.75 + 0.25 * sin(uTime * (0.6 + aPhase * 0.3) + aPhase * 6.28);
  vColor = aColor * tw * uOpacity;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = max(0.7, aSize * uScale / -mv.z);
  gl_Position = projectionMatrix * mv;
}`
const SKY_FS = /* glsl */ `
varying vec3 vColor;
void main(){
  vec2 d = gl_PointCoord - 0.5;
  float a = exp(-dot(d, d) * 26.0);
  gl_FragColor = vec4(vColor * a, 1.0);
}`

const RING_VS = /* glsl */ `
varying vec2 vP;
void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`
const RING_FS = /* glsl */ `
uniform float uOpacity; uniform float uTime; varying vec2 vP;
${SIMPLEX}
void main(){
  float r = length(vP);
  float edge = smoothstep(0.55, 0.96, r) * (1.0 - smoothstep(0.96, 1.0, r));
  float n = snoise(vec3(normalize(vP) * 6.0, uTime * 0.5)) * 0.5 + 0.5;
  vec3 col = mix(vec3(1.0, 0.55, 0.25), vec3(0.75, 0.85, 1.0), smoothstep(0.85, 1.0, r));
  gl_FragColor = vec4(col * edge * (0.5 + 0.8 * n) * uOpacity, 1.0);
}`
const SHELL_FS = /* glsl */ `
uniform float uOpacity; varying vec3 vObj; varying vec3 vN; varying vec3 vView;
void main(){
  float f = 1.0 - abs(dot(normalize(vN), normalize(vView)));
  gl_FragColor = vec4(vec3(0.8, 0.88, 1.0) * pow(f, 3.0) * uOpacity, 1.0);
}`

const additive = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending } as const

function makeStar(radius: number, hot: THREE.Color, cool: THREE.Color, seed: number) {
  const group = new THREE.Group()
  const surface = new THREE.ShaderMaterial({
    vertexShader: SURFACE_VS, fragmentShader: STAR_FS,
    uniforms: { uTime: { value: 0 }, uIntensity: { value: 0 }, uSeed: { value: seed }, uHot: { value: hot }, uCool: { value: cool } },
  })
  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), surface)
  const coronaMat = new THREE.ShaderMaterial({
    vertexShader: SURFACE_VS, fragmentShader: CORONA_FS, side: THREE.BackSide, ...additive,
    uniforms: { uTime: { value: 0 }, uIntensity: { value: 0 }, uColor: { value: hot.clone().multiplyScalar(1.4) } },
  })
  const corona = new THREE.Mesh(new THREE.SphereGeometry(1.75, 64, 48), coronaMat)
  group.add(body, corona)
  group.scale.setScalar(radius)
  return { group, surface, coronaMat }
}

function radialTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 256
  const g = c.getContext('2d')!
  const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128)
  grd.addColorStop(0, 'rgba(255,255,255,1)')
  grd.addColorStop(0.15, 'rgba(255,245,230,0.8)')
  grd.addColorStop(0.45, 'rgba(160,190,255,0.18)')
  grd.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = grd
  g.fillRect(0, 0, 256, 256)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

function rockGeometry() {
  const geo = new THREE.IcosahedronGeometry(1, 2)
  const p = geo.attributes.position as THREE.BufferAttribute
  const v = new THREE.Vector3()
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i)
    const h = Math.sin(v.x * 12.9898 + v.y * 78.233 + v.z * 37.719) * 43758.5453
    const k = 0.72 + 0.4 * (h - Math.floor(h)) + 0.12 * Math.sin(v.x * 3 + v.z * 2)
    p.setXYZ(i, v.x * k, v.y * k * 0.85, v.z * k)
  }
  geo.computeVertexNormals()
  return geo
}

const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t) }
const rand = (a: number, b: number) => a + Math.random() * (b - a)

export default function StarCollision({ onDone }: { onDone?: () => void }) {
  const mount = useRef<HTMLDivElement>(null)
  const flash = useRef<HTMLDivElement>(null)
  const [caption, setCaption] = useState('')
  const [ended, setEnded] = useState(false)
  const [run, setRun] = useState(0)

  useEffect(() => {
    const host = mount.current!
    const mobile = matchMedia('(pointer: coarse)').matches || innerWidth < 700
    const GAS = mobile ? 26000 : 70000
    const ROCKS = mobile ? 160 : 280
    const TRAILS = 8, TRAIL_LEN = 140

    // --- renderer, camera, post ------------------------------------------------
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    renderer.setClearColor(0x000000, 1)
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.0
    host.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x000000)
    const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 2000)
    camera.position.set(0, 2.5, 15)

    const composer = new EffectComposer(renderer)
    composer.addPass(new RenderPass(scene, camera))
    const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.35, 0.82)
    composer.addPass(bloom)
    composer.addPass(new OutputPass())

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enabled = false
    controls.enableDamping = true
    controls.dampingFactor = 0.06
    controls.minDistance = 5
    controls.maxDistance = 220
    controls.autoRotateSpeed = 0.35
    controls.enablePan = false

    const pointScale = { value: 1 }
    const resize = () => {
      const w = host.clientWidth, h = host.clientHeight
      renderer.setSize(w, h)
      composer.setSize(w, h)
      bloom.setSize(w, h)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      pointScale.value = (h * renderer.getPixelRatio() * 0.5) / Math.tan((camera.fov * Math.PI) / 360)
    }
    const ro = new ResizeObserver(resize)
    ro.observe(host)
    resize()

    // --- the two stars ---------------------------------------------------------
    const s1 = makeStar(R1, new THREE.Color(0.78, 0.88, 1.6), new THREE.Color(0.32, 0.48, 1.1), 1.7)
    const s2 = makeStar(R2, new THREE.Color(1.6, 0.92, 0.5), new THREE.Color(1.0, 0.32, 0.06), 5.3)
    scene.add(s1.group, s2.group)

    // gas pulled off the smaller star onto the bigger one in the last orbits
    const STREAM = 1800
    const sPos = new Float32Array(STREAM * 3), sVel = new Float32Array(STREAM * 3), sAlive = new Float32Array(STREAM)
    const streamGeo = new THREE.BufferGeometry()
    streamGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3))
    streamGeo.setAttribute('aSize', new THREE.BufferAttribute(Float32Array.from({ length: STREAM }, () => rand(0.04, 0.12)), 1))
    streamGeo.setAttribute('aCool', new THREE.BufferAttribute(Float32Array.from({ length: STREAM }, () => rand(0.4, 1.0)), 1))
    streamGeo.setAttribute('aAlive', new THREE.BufferAttribute(sAlive, 1))
    const streamMat = new THREE.ShaderMaterial({
      vertexShader: PARTICLE_VS, fragmentShader: PARTICLE_FS, ...additive,
      uniforms: { uAge: { value: 0.6 }, uScale: pointScale, uBase: { value: 0.8 } },
    })
    const stream = new THREE.Points(streamGeo, streamMat)
    stream.frustumCulled = false
    scene.add(stream)
    let streamNext = 0

    // --- after the merger ------------------------------------------------------
    const remnant = makeStar(1, new THREE.Color(0.95, 0.97, 1.7), new THREE.Color(0.6, 0.7, 1.3), 9.1)
    remnant.group.visible = false
    scene.add(remnant.group)
    const light = new THREE.PointLight(0xdfe8ff, 0, 0, 1.4)
    scene.add(light)
    scene.add(new THREE.AmbientLight(0x10131c, 0.25))

    const flare = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTexture(), ...additive, color: new THREE.Color(3, 3, 3) }))
    flare.visible = false
    scene.add(flare)

    const ringMat = new THREE.ShaderMaterial({ vertexShader: RING_VS, fragmentShader: RING_FS, side: THREE.DoubleSide, ...additive,
      uniforms: { uOpacity: { value: 0 }, uTime: { value: 0 } } })
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 1, 192, 1), ringMat)
    ring.rotation.x = -Math.PI / 2
    ring.visible = false
    scene.add(ring)
    const shellMat = new THREE.ShaderMaterial({ vertexShader: SURFACE_VS, fragmentShader: SHELL_FS, side: THREE.DoubleSide, ...additive,
      uniforms: { uOpacity: { value: 0 } } })
    const shell = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 48), shellMat)
    shell.visible = false
    scene.add(shell)

    // gas cloud, integrated on the CPU under the remnant's gravity
    const gPos = new Float32Array(GAS * 3), gVel = new Float32Array(GAS * 3), gAlive = new Float32Array(GAS)
    const gKind = new Uint8Array(GAS) // 0 = disk gas, 1 = escaping ejecta
    const gasGeo = new THREE.BufferGeometry()
    gasGeo.setAttribute('position', new THREE.BufferAttribute(gPos, 3))
    gasGeo.setAttribute('aSize', new THREE.BufferAttribute(Float32Array.from({ length: GAS }, () => 0.04 + Math.random() ** 3 * 0.22), 1))
    gasGeo.setAttribute('aCool', new THREE.BufferAttribute(Float32Array.from({ length: GAS }, () => rand(0.04, 0.32)), 1))
    gasGeo.setAttribute('aAlive', new THREE.BufferAttribute(gAlive, 1))
    const gasMat = new THREE.ShaderMaterial({
      vertexShader: PARTICLE_VS, fragmentShader: PARTICLE_FS, ...additive,
      uniforms: { uAge: { value: 0 }, uScale: pointScale, uBase: { value: mobile ? 0.5 : 0.34 } },
    })
    const gas = new THREE.Points(gasGeo, gasMat)
    gas.frustumCulled = false
    gas.visible = false
    scene.add(gas)

    // rock debris: real lit meshes that tumble and orbit
    const rockMat = new THREE.MeshStandardMaterial({
      color: 0x6e6058, roughness: 0.92, metalness: 0.08, flatShading: true, emissive: new THREE.Color(1.0, 0.36, 0.08), emissiveIntensity: 0,
    })
    const rocks = new THREE.InstancedMesh(rockGeometry(), rockMat, ROCKS)
    rocks.frustumCulled = false
    rocks.visible = false
    scene.add(rocks)
    const rPos = new Float32Array(ROCKS * 3), rVel = new Float32Array(ROCKS * 3), rSize = new Float32Array(ROCKS), rAlive = new Uint8Array(ROCKS)
    const rAxis = Array.from({ length: ROCKS }, () => new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize())
    const rSpin = Float32Array.from({ length: ROCKS }, () => rand(0.3, 2.2))
    for (let i = 0; i < ROCKS; i++) rSize[i] = i < TRAILS ? rand(0.5, 0.85) : 0.06 + Math.random() ** 2.2 * 0.38

    const trails = Array.from({ length: TRAILS }, () => {
      const pos = new Float32Array(TRAIL_LEN * 3)
      const col = new Float32Array(TRAIL_LEN * 3)
      for (let k = 0; k < TRAIL_LEN; k++) {
        const f = (1 - k / TRAIL_LEN) ** 1.6
        col.set([1.0 * f, 0.6 * f, 0.35 * f], k * 3)
      }
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ vertexColors: true, ...additive, opacity: 0.9 }))
      line.frustumCulled = false
      line.visible = false
      scene.add(line)
      return { pos, line }
    })

    // the universe beyond: starfield + milky way band, invisible until the crash
    const SKY = mobile ? 5000 : 9000, BAND = mobile ? 14000 : 30000
    const skyPos = new Float32Array((SKY + BAND) * 3), skyCol = new Float32Array((SKY + BAND) * 3)
    const skySize = new Float32Array(SKY + BAND), skyPhase = new Float32Array(SKY + BAND)
    const tilt = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(0.9, 0.3, 0.5))
    const v = new THREE.Vector3()
    const tint = (bv: number) => bv < 0.3 ? [0.75, 0.84, 1.0] : bv < 0.7 ? [1.0, 0.97, 0.92] : bv < 1.1 ? [1.0, 0.85, 0.65] : [1.0, 0.68, 0.48]
    for (let i = 0; i < SKY + BAND; i++) {
      const band = i >= SKY
      if (band) {
        const lon = Math.random() * Math.PI * 2
        const g = (Math.random() + Math.random() + Math.random() - 1.5) * 0.11 * (1 + 1.6 * Math.exp(-((lon - Math.PI) ** 2) * 1.5))
        v.set(Math.cos(lon) * Math.cos(g), Math.sin(g), Math.sin(lon) * Math.cos(g)).applyMatrix4(tilt)
      } else {
        v.set(rand(-1, 1), rand(-1, 1), rand(-1, 1))
        if (v.lengthSq() > 1 || v.lengthSq() < 1e-3) { i--; continue }
        v.normalize()
      }
      v.multiplyScalar(band ? 700 : rand(600, 900))
      skyPos.set([v.x, v.y, v.z], i * 3)
      const c = tint(Math.random() * 1.6)
      const b = band ? rand(0.12, 0.35) : 0.4 + Math.random() ** 4 * 1.6
      skyCol.set([c[0] * b, c[1] * b, c[2] * b], i * 3)
      skySize[i] = band ? rand(0.8, 2.2) : 1.0 + Math.random() ** 6 * 5
      skyPhase[i] = Math.random()
    }
    const skyGeo = new THREE.BufferGeometry()
    skyGeo.setAttribute('position', new THREE.BufferAttribute(skyPos, 3))
    skyGeo.setAttribute('aColor', new THREE.BufferAttribute(skyCol, 3))
    skyGeo.setAttribute('aSize', new THREE.BufferAttribute(skySize, 1))
    skyGeo.setAttribute('aPhase', new THREE.BufferAttribute(skyPhase, 1))
    const skyMat = new THREE.ShaderMaterial({ vertexShader: SKY_VS, fragmentShader: SKY_FS, ...additive,
      uniforms: { uScale: pointScale, uTime: { value: 0 }, uOpacity: { value: 0 } } })
    const sky = new THREE.Points(skyGeo, skyMat)
    sky.frustumCulled = false
    scene.add(sky)

    // --- the merger ------------------------------------------------------------
    let merged = -1 // time of impact
    const p1 = new THREE.Vector3(), p2 = new THREE.Vector3()
    const merge = (t: number) => {
      merged = t
      s1.group.visible = false
      s2.group.visible = false
      stream.visible = false
      remnant.group.visible = true
      flare.visible = true
      ring.visible = true
      shell.visible = true
      gas.visible = true
      rocks.visible = true
      trails.forEach(tr => { tr.line.visible = true })
      setCaption('')

      const seed = (out: Float32Array, i: number) => {
        // matter starts inside one of the two stars at the moment of contact
        const from = Math.random() < M1 / (M1 + M2) ? p1 : p2
        const R = from === p1 ? R1 : R2
        let x, y, z
        do { x = rand(-1, 1); y = rand(-1, 1); z = rand(-1, 1) } while (x * x + y * y + z * z > 1)
        out[i * 3] = from.x + x * R; out[i * 3 + 1] = from.y + y * R * 0.7; out[i * 3 + 2] = from.z + z * R
      }
      const launch = (pos: Float32Array, vel: Float32Array, i: number, rc: number, vr: number, puff: number) => {
        const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2]
        const r = Math.hypot(x, z) || 0.01
        const rx = x / r, rz = z / r
        // angular momentum chosen so the gas settles on a circular orbit of radius rc
        const vt = Math.sqrt(GM * rc) / Math.max(r, 0.6)
        vel[i * 3] = rx * vr - rz * vt
        vel[i * 3 + 1] = (Math.random() - 0.5) * 2 * puff + y * 0.8
        vel[i * 3 + 2] = rz * vr + rx * vt
      }
      // the merged star's envelope puffs out; a bound orbit can at most double its radius
      // (L^2 < 2 GM r0), so the disk is seeded across the swollen envelope, not the core
      const envelope = (out: Float32Array, i: number, rMax: number) => {
        const th = Math.random() * Math.PI * 2, r0 = 1.3 + Math.random() ** 0.9 * rMax
        const g = (Math.random() + Math.random() + Math.random() - 1.5) * 0.35
        out[i * 3] = Math.cos(th) * r0; out[i * 3 + 1] = g * r0 * 0.45; out[i * 3 + 2] = Math.sin(th) * r0
        return r0
      }
      for (let i = 0; i < GAS; i++) {
        gAlive[i] = 1
        if (Math.random() < 0.12) {
          gKind[i] = 1
          seed(gPos, i)
          launch(gPos, gVel, i, rand(1, 6), rand(26, 48), rand(2, 9))
        } else {
          gKind[i] = 0
          const r0 = envelope(gPos, i, 6.5)
          launch(gPos, gVel, i, r0 * rand(1.0, 1.85), rand(0.5, 5), rand(0.3, 2.2))
        }
      }
      for (let i = 0; i < ROCKS; i++) {
        rAlive[i] = 1
        const r0 = envelope(rPos, i, i < TRAILS ? 6 : 7)
        launch(rPos, rVel, i, r0 * rand(1.25, 1.9), rand(1, 6), rand(0.2, 1.6))
      }
      trails.forEach((tr, k) => { for (let j = 0; j < TRAIL_LEN; j++) tr.pos.set([rPos[k * 3], rPos[k * 3 + 1], rPos[k * 3 + 2]], j * 3) })
      ;(gasGeo.attributes.aAlive as THREE.BufferAttribute).needsUpdate = true
    }

    // --- the loop --------------------------------------------------------------
    const clock = new THREE.Clock()
    let t = 0, phase = 0, raf = 0, captionStage = 0, endedFlag = false
    const dummy = new THREE.Object3D()
    const camTarget = new THREE.Vector3()

    const gravityStep = (pos: Float32Array, vel: Float32Array, n: number, dt: number, tau: number, isGas: boolean) => {
      const settle = smooth(0.4, 3, tau)
      const kR = (isGas ? 0.7 : 0.14) * settle, kZ = (isGas ? 0.9 : 0.3) * settle
      const swallow = 0.95 * Math.min(1.4, 0.4 + tau * 1.5)
      let changed = false
      for (let i = 0; i < n; i++) {
        if (isGas ? !gAlive[i] : !rAlive[i]) continue
        const j = i * 3
        const x = pos[j], y = pos[j + 1], z = pos[j + 2]
        const r2 = x * x + y * y + z * z
        const inv = GM / ((r2 + EPS2) * Math.sqrt(r2 + EPS2))
        let vx = vel[j] - x * inv * dt, vy = vel[j + 1] - y * inv * dt, vz = vel[j + 2] - z * inv * dt
        if (!isGas || gKind[i] === 0) {
          // viscosity: damp radial and vertical motion, keep angular momentum -> a thin disk
          const r = Math.sqrt(r2) || 1
          const vr = (vx * x + vy * y + vz * z) / r
          vx -= (x / r) * vr * kR * dt; vy -= (y / r) * vr * kR * dt; vz -= (z / r) * vr * kR * dt
          vy *= 1 - kZ * dt
        }
        vel[j] = vx; vel[j + 1] = vy; vel[j + 2] = vz
        pos[j] = x + vx * dt; pos[j + 1] = y + vy * dt; pos[j + 2] = z + vz * dt
        if (tau > 0.6 && r2 < swallow * swallow) {
          if (isGas) { gAlive[i] = 0; changed = true } else rAlive[i] = 0
        }
      }
      return changed
    }

    const update = (dt: number) => {
      t += dt

      // ---------------- before impact: inspiral --------------------------------
      if (merged < 0) {
        const u = Math.max(0, Math.min(1, (t - T_IN) / T_SPIRAL))
        const a = A0 * Math.max(1e-3, 1 - u) ** 0.25 // gravitational-wave inspiral law
        const omega = 0.32 * (A0 / a) ** 1.5
        phase += omega * dt
        const d1 = (a * M2) / (M1 + M2), d2 = (a * M1) / (M1 + M2)
        p1.set(Math.cos(phase) * d1, 0, Math.sin(phase) * d1)
        p2.set(-Math.cos(phase) * d2, 0, -Math.sin(phase) * d2)
        s1.group.position.copy(p1)
        s2.group.position.copy(p2)

        // tides stretch each star toward the other
        const tide = smooth(5.5, 2.6, a)
        s1.group.lookAt(p2); s2.group.lookAt(p1)
        s1.group.scale.set(R1 * (1 - 0.1 * tide), R1 * (1 - 0.1 * tide), R1 * (1 + 0.3 * tide))
        s2.group.scale.set(R2 * (1 - 0.14 * tide), R2 * (1 - 0.14 * tide), R2 * (1 + 0.42 * tide))

        const fade = smooth(0, T_IN + 0.6, t)
        const heat = 1 + 0.8 * tide
        for (const s of [s1, s2]) {
          s.surface.uniforms.uTime.value = t
          s.surface.uniforms.uIntensity.value = 1.2 * fade * (1 + 0.35 * tide)
          s.coronaMat.uniforms.uTime.value = t
          s.coronaMat.uniforms.uIntensity.value = 0.32 * fade * heat
        }

        // mass transfer stream from the smaller star onto the bigger one
        if (a < 6.2) {
          const rate = Math.floor(900 * dt * (1 + 3 * tide))
          const toward = new THREE.Vector3().subVectors(p1, p2).normalize()
          const along = new THREE.Vector3(-Math.sin(phase), 0, Math.cos(phase)) // star 1 orbital direction
          for (let k = 0; k < rate; k++) {
            const i = streamNext++ % STREAM
            const off = new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(0.25)
            const start = p2.clone().addScaledVector(toward, R2 * (1 + 0.3 * tide)).add(off)
            sPos.set([start.x, start.y, start.z], i * 3)
            const sp = rand(1.5, 3)
            sVel.set([toward.x * sp + along.x * 1.4, rand(-0.2, 0.2), toward.z * sp + along.z * 1.4], i * 3)
            sAlive[i] = 1
          }
        }
        for (let i = 0; i < STREAM; i++) {
          if (!sAlive[i]) continue
          const j = i * 3
          const dx = p1.x - sPos[j], dy = p1.y - sPos[j + 1], dz = p1.z - sPos[j + 2]
          const r2 = dx * dx + dy * dy + dz * dz
          if (r2 < R1 * R1 * 1.1) { sAlive[i] = 0; continue }
          const inv = 22 / (r2 * Math.sqrt(r2))
          sVel[j] += dx * inv * dt; sVel[j + 1] += dy * inv * dt; sVel[j + 2] += dz * inv * dt
          sPos[j] += sVel[j] * dt; sPos[j + 1] += sVel[j + 1] * dt; sPos[j + 2] += sVel[j + 2] * dt
        }
        streamGeo.attributes.position.needsUpdate = true
        ;(streamGeo.attributes.aAlive as THREE.BufferAttribute).needsUpdate = true

        // camera: close, slowly circling the pair
        const az = 0.35 + t * 0.05
        const dist = 15 - 3 * u
        camera.position.set(Math.sin(az) * dist, 2.2 - u * 0.8, Math.cos(az) * dist)
        camTarget.set(0, 0, 0)
        camera.lookAt(camTarget)
        bloom.strength = 0.5 + 0.25 * tide

        if (captionStage === 0 && t > 1.2) { captionStage = 1; setCaption('two stars, alone in the dark') }
        if (captionStage === 1 && u > 0.55) { captionStage = 2; setCaption('pulled closer every orbit') }
        if (a <= (R1 + R2) * 0.9) merge(t)
      }

      // ---------------- after impact --------------------------------------------
      if (merged >= 0) {
        const tau = t - merged

        // remnant: swells out of the impact, pulses, settles
        const grow = 0.4 + 1.25 * (1 - Math.exp(-tau * 2.2))
        remnant.group.scale.setScalar(grow * (1 + 0.035 * Math.sin(t * 3.1)))
        remnant.surface.uniforms.uTime.value = t
        remnant.surface.uniforms.uIntensity.value = 1.3 + 4 * Math.exp(-tau * 1.6)
        remnant.coronaMat.uniforms.uTime.value = t
        remnant.coronaMat.uniforms.uIntensity.value = 0.35 + 1.6 * Math.exp(-tau * 1.4)
        light.intensity = 420 + 3000 * Math.exp(-tau * 0.9)

        flare.scale.setScalar(4 + 45 * (1 - Math.exp(-tau * 6)))
        flare.material.opacity = Math.exp(-tau * 2.6)
        ring.scale.setScalar(2 + 46 * (1 - Math.exp(-tau * 0.7)))
        ringMat.uniforms.uOpacity.value = 1.4 * Math.exp(-tau * 0.9)
        ringMat.uniforms.uTime.value = t
        shell.scale.setScalar(2 + 55 * (1 - Math.exp(-tau * 1.1)))
        shellMat.uniforms.uOpacity.value = 1.4 * Math.exp(-tau * 1.3)
        if (flash.current) flash.current.style.opacity = String(0.9 * Math.exp(-tau * 3.2))

        bloom.strength = 0.55 + 1.3 * Math.exp(-tau * 2)
        bloom.threshold = 0.82 - 0.5 * Math.exp(-tau * 2)
        gasMat.uniforms.uAge.value = tau
        rockMat.emissiveIntensity = 1.6 * Math.exp(-tau * 0.45) + 0.04

        const sub = 2
        let changed = false
        for (let k = 0; k < sub; k++) {
          changed = gravityStep(gPos, gVel, GAS, dt / sub, tau, true) || changed
          gravityStep(rPos, rVel, ROCKS, dt / sub, tau, false)
        }
        gasGeo.attributes.position.needsUpdate = true
        if (changed) (gasGeo.attributes.aAlive as THREE.BufferAttribute).needsUpdate = true

        for (let i = 0; i < ROCKS; i++) {
          dummy.position.set(rPos[i * 3], rPos[i * 3 + 1], rPos[i * 3 + 2])
          dummy.quaternion.setFromAxisAngle(rAxis[i], rSpin[i] * t)
          dummy.scale.setScalar(rAlive[i] ? rSize[i] : 0)
          dummy.updateMatrix()
          rocks.setMatrixAt(i, dummy.matrix)
        }
        rocks.instanceMatrix.needsUpdate = true
        trails.forEach((tr, k) => {
          tr.pos.copyWithin(3, 0, (TRAIL_LEN - 1) * 3)
          tr.pos.set([rPos[k * 3], rPos[k * 3 + 1], rPos[k * 3 + 2]], 0)
          tr.line.geometry.attributes.position.needsUpdate = true
          tr.line.visible = !!rAlive[k]
        })

        skyMat.uniforms.uOpacity.value = smooth(2.2, 8, tau)
        skyMat.uniforms.uTime.value = t

        // camera: shake, then pull back and rise to take in the whole new system
        if (!controls.enabled) {
          const pull = Math.min(1, (1 - Math.exp(-tau * 0.55)) * 1.04)
          const az = 0.35 + t * 0.05 + pull * 0.6
          const dist = 12 + 26 * pull
          const el = 0.12 + 0.42 * pull
          camera.position.set(Math.sin(az) * Math.cos(el) * dist, Math.sin(el) * dist, Math.cos(az) * Math.cos(el) * dist)
          const shake = 0.5 * Math.exp(-tau * 2.4)
          camera.position.add(new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(shake))
          camera.lookAt(camTarget)
          if (tau > 8.2) {
            controls.target.set(0, 0, 0)
            controls.enabled = true
            controls.autoRotate = true
          }
        }
        if (captionStage < 3 && tau > 1.6) { captionStage = 3; setCaption('and everything they were is flung into orbit') }
        if (captionStage === 3 && tau > 7) { captionStage = 4; setCaption('') }
        if (!endedFlag && tau > 9) { endedFlag = true; setEnded(true) }
      }

    }
    const frame = () => {
      raf = requestAnimationFrame(frame)
      update(Math.min(clock.getDelta(), 1 / 30))
      if (controls.enabled) controls.update()
      composer.render()
    }
    // debug: ?t=12 fast-forwards the simulation to 12 s (for stills / checking a moment)
    const seek = Number(new URLSearchParams(location.search).get('t'))
    if (seek > 0) while (t < seek) update(1 / 30)
    clock.getDelta()
    raf = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      controls.dispose()
      scene.traverse(o => {
        const m = o as THREE.Mesh
        m.geometry?.dispose()
        const mat = m.material as THREE.Material | THREE.Material[] | undefined
        if (Array.isArray(mat)) mat.forEach(x => x.dispose()); else mat?.dispose()
      })
      composer.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [run])

  const replay = () => { setEnded(false); setCaption(''); setRun(r => r + 1) }

  return (
    <div className="sc-root">
      <div className="sc-gl" ref={mount} key={run} />
      <div className="sc-flash" ref={flash} />
      <p className="sc-caption" key={caption}>{caption}</p>
      {ended ? (
        <div className="sc-end">
          <button className="sc-enter" onClick={onDone}>enter the sky →</button>
          <button className="sc-ghost" onClick={replay}>↺ replay</button>
          <span className="sc-hint">drag to orbit · scroll to zoom</span>
        </div>
      ) : (
        onDone && <button className="sc-ghost sc-skip" onClick={onDone}>skip ›</button>
      )}
    </div>
  )
}
