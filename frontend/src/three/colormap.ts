// Perceptually ordered colour maps (sampled from matplotlib viridis / plasma / a diverging blue-red).
const MAPS: Record<string, number[][]> = {
  viridis: [[68, 1, 84], [72, 40, 120], [62, 74, 137], [49, 104, 142], [38, 130, 142], [31, 158, 137], [53, 183, 121], [109, 205, 89], [180, 222, 44], [253, 231, 37]],
  plasma: [[13, 8, 135], [75, 3, 161], [125, 3, 168], [168, 34, 150], [203, 70, 121], [229, 107, 93], [248, 148, 65], [253, 195, 40], [240, 249, 33]],
  diverging: [[59, 76, 192], [98, 130, 234], [141, 176, 254], [184, 208, 249], [221, 221, 221], [245, 196, 173], [244, 154, 123], [222, 96, 77], [180, 4, 38]],
}

export function colormap(u: number, name = 'viridis'): [number, number, number] {
  const m = MAPS[name]
  if (!Number.isFinite(u)) return [0.3, 0.3, 0.35]
  const x = Math.min(1, Math.max(0, u)) * (m.length - 1)
  const i = Math.min(m.length - 2, Math.floor(x))
  const f = x - i
  return [0, 1, 2].map(k => (m[i][k] + f * (m[i + 1][k] - m[i][k])) / 255) as [number, number, number]
}

export function gradientCSS(name: string) {
  const m = MAPS[name]
  return `linear-gradient(90deg, ${m.map((c, i) => `rgb(${c.join(',')}) ${(i / (m.length - 1)) * 100}%`).join(',')})`
}

export interface ColorField { col: string; label: string; min: number; max: number; cmap: string; kind: 'measured' | 'inferred'; transform?: (v: number) => number }

export const COLOR_FIELDS: Record<string, ColorField> = {
  FE_H: { col: 'FE_H', label: '[Fe/H] (APOGEE)', min: -1.0, max: 0.4, cmap: 'plasma', kind: 'measured' },
  MG_FE: { col: 'MG_FE', label: '[Mg/Fe] (APOGEE)', min: -0.1, max: 0.35, cmap: 'viridis', kind: 'measured' },
  age_gyr: { col: 'age_gyr', label: 'Age [Gyr] (astroNN, model-dependent)', min: 0, max: 12, cmap: 'viridis', kind: 'inferred' },
  ecc: { col: 'ecc', label: 'Orbital eccentricity (McMillan17)', min: 0, max: 0.6, cmap: 'plasma', kind: 'inferred' },
  zmax: { col: 'zmax', label: 'z_max [kpc] (McMillan17)', min: 0, max: 2, cmap: 'viridis', kind: 'inferred' },
  W: { col: 'W', label: 'W velocity [km/s]', min: -40, max: 40, cmap: 'diverging', kind: 'inferred' },
  vT: { col: 'vT', label: 'v_φ [km/s]', min: 150, max: 270, cmap: 'viridis', kind: 'inferred' },
}
