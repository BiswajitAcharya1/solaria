// The opening "film": a scripted camera move over the real sky (no stock footage, no
// particle effects), with the history of constellations told in big captions.
// Each shot names a camera target (or a constellation to frame), what to draw, and how
// long to hold. The engine eases between shots, so it plays like one continuous pan.
import type { CameraState } from './SkyEngine'

export interface Shot {
  era: string
  text: string
  cam?: Partial<CameraState>
  frame?: string // constellation abbreviation to frame
  zoom?: number // multiply the framed field of view (>1 = wider)
  figure?: string | null
  allFigures?: boolean
  labels?: 'names' | 'distance' | null
  kin?: boolean
  time?: { to: number; ms: number; back?: boolean }
  fly: number // ms for the camera move into this shot
  hold: number // total ms on this shot
}

export const SCRIPT: Shot[] = [
  { era: '13.8 billion years ago', text: 'the universe begins. a few hundred million years later, the first stars switch on.',
    cam: { ra: 312, dec: 42, fov: 110 }, figure: null, fly: 10, hold: 6500 },
  { era: '13 billion years ago', text: 'stars gather into galaxies. that river of light is our own galaxy, the milky way, seen from inside.',
    cam: { ra: 268, dec: -27, fov: 96 }, figure: null, fly: 6500, hold: 7200 },
  { era: '4.6 billion years ago', text: 'the sun is born in a cluster of sibling stars. over billions of years they drift apart.',
    cam: { ra: 60, dec: 20, fov: 34 }, figure: null, fly: 6000, hold: 6800 },
  { era: 'babylon · around 1000 bc', text: 'people join the brightest stars into pictures: a hunter, a bull, a lion.',
    frame: 'Ori', zoom: 1.25, figure: 'Ori', labels: 'names', fly: 4200, hold: 6800 },
  { era: '1922', text: 'astronomers fix 88 official constellations, drawn without knowing how far away a single star is.',
    cam: { ra: 95, dec: 12, fov: 112 }, figure: null, allFigures: true, fly: 4200, hold: 7000 },
  { era: '1989 to today', text: 'the hipparcos and gaia satellites measure how far away each of these stars is, and how it moves.',
    frame: 'Ori', zoom: 1.1, figure: 'Ori', labels: 'distance', fly: 4200, hold: 7600 },
  { era: 'one million years', text: 'nothing up there stands still. this is orion over the next million years.',
    frame: 'Ori', zoom: 1.6, figure: 'Ori', labels: 'names', time: { to: 1, ms: 5200, back: true }, fly: 2000, hold: 9200 },
  { era: 'now', text: 'so we can test every constellation: a real family of stars, or a trick of perspective?',
    frame: 'UMa', zoom: 1.15, figure: 'UMa', labels: 'names', kin: true, fly: 4800, hold: 7200 },
]

export const TITLE_HOLD_MS = 4200
