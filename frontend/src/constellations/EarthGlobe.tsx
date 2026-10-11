// "you are here": a textured, lit, turning earth in its own little WebGL view.
// Day side lit by the sun, city lights on the night side, a drifting cloud layer and an atmosphere rim.
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { earthMaps } from './textures'
import './earth.css'

const EARTH_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vN;
varying vec3 vView;
void main() {
  vUv = uv;
  vN = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`
const EARTH_FRAG = /* glsl */ `
uniform sampler2D uDay;
uniform sampler2D uNight;
uniform vec3 uSun;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vView;
void main() {
  float l = dot(normalize(vN), normalize(uSun));
  float day = smoothstep(-0.12, 0.25, l);
  vec3 albedo = texture2D(uDay, vUv).rgb;
  vec3 d = albedo * (0.25 + 0.95 * max(l, 0.0));
  vec3 n = texture2D(uNight, vUv).rgb * 1.6 + vec3(0.01, 0.02, 0.05);
  vec3 c = mix(n, d, day);
  // sun glint, only on water (blue-dominant pixels)
  vec3 h = normalize(normalize(uSun) + vView);
  float spec = pow(max(dot(normalize(vN), h), 0.0), 40.0) * day;
  float sea = step(albedo.r + 0.15, albedo.b);
  c += vec3(0.5, 0.6, 0.7) * spec * sea * 0.5;
  float rim = pow(1.0 - max(dot(normalize(vN), vView), 0.0), 3.0);
  c += vec3(0.3, 0.55, 1.0) * rim * (0.25 + 0.75 * day);
  gl_FragColor = vec4(c, 1.0);
}`
const ATMO_FRAG = /* glsl */ `
uniform vec3 uSun;
varying vec3 vN;
varying vec3 vView;
void main() {
  float rim = pow(1.0 - abs(dot(normalize(vN), vView)), 2.2);
  float lit = 0.35 + 0.65 * smoothstep(-0.4, 0.6, dot(normalize(vN), normalize(uSun)));
  gl_FragColor = vec4(vec3(0.35, 0.6, 1.0) * rim * lit, rim * lit);
}`

export default function EarthGlobe({ size = 132 }: { size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const cv = ref.current!
    const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
    renderer.setSize(size, size, false)
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50)
    camera.position.set(0, 0.35, 4.2)
    camera.lookAt(0, 0, 0)

    const { day, clouds, lights } = earthMaps()
    const sun = new THREE.Vector3(1, 0.3, 0.6).normalize()
    const tilt = new THREE.Group()
    tilt.rotation.z = (23.4 * Math.PI) / 180 // axial tilt
    scene.add(tilt)
    const earthMat = new THREE.ShaderMaterial({
      vertexShader: EARTH_VERT, fragmentShader: EARTH_FRAG,
      uniforms: { uDay: { value: day }, uNight: { value: lights }, uSun: { value: sun.clone() } },
    })
    const earth = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), earthMat)
    tilt.add(earth)
    const cloudMesh = new THREE.Mesh(new THREE.SphereGeometry(1.012, 96, 64),
      new THREE.MeshLambertMaterial({ map: clouds, transparent: true, depthWrite: false }))
    tilt.add(cloudMesh)
    const atmo = new THREE.Mesh(new THREE.SphereGeometry(1.08, 64, 48), new THREE.ShaderMaterial({
      vertexShader: EARTH_VERT, fragmentShader: ATMO_FRAG, uniforms: { uSun: { value: sun.clone() } },
      transparent: true, blending: THREE.AdditiveBlending, side: THREE.BackSide, depthWrite: false,
    }))
    scene.add(atmo)
    const light = new THREE.DirectionalLight(0xffffff, 2.2)
    light.position.copy(sun)
    scene.add(light, new THREE.AmbientLight(0x223355, 0.25))

    let raf = 0, last = performance.now()
    const v = new THREE.Vector3()
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      earth.rotation.y += dt * 0.12
      cloudMesh.rotation.y += dt * 0.15
      // sun direction in the earth's view space for the day/night shader
      v.copy(sun).transformDirection(camera.matrixWorldInverse)
      earthMat.uniforms.uSun.value.copy(v)
      ;(atmo.material as THREE.ShaderMaterial).uniforms.uSun.value.copy(v)
      renderer.render(scene, camera)
    }
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      renderer.dispose()
      day.dispose(); clouds.dispose(); lights.dispose()
    }
  }, [size])

  return (
    <figure className="sl-earth" title="earth (continents are illustrative)">
      <canvas ref={ref} width={size} height={size} style={{ width: size, height: size }} aria-label="the earth, turning" />
      <figcaption>you are here</figcaption>
    </figure>
  )
}
