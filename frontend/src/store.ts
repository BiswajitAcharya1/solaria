import { create } from 'zustand'
import type { Points } from './api'

export type View = 'atlas' | 'families' | 'constellations' | 'merger' | 'anomalies' | 'validation' | 'methods'

export interface OrbitRun {
  times_myr: number[]
  stars: { source_id: string; nominal: number[][]; samples: number[][][]; spread_pc_p50: number[]; spread_pc_p84: number[]; galcen_nominal_kpc: number[][] }[]
  sun_galcen_kpc: number[][]
}

export interface OrbitResult {
  source_ids: string[]
  lookback_myr: number
  n_mc: number
  runs: Record<string, OrbitRun>
  potential_difference?: { between: string[]; stars: { source_id: string; separation_pc: number[] }[] }
  caveats: string[]
  provenance: any
}

interface State {
  view: View
  setView: (v: View) => void
  meta: any | null
  setMeta: (m: any) => void
  points: Points | null
  setPoints: (p: Points) => void
  selected: string | null           // focused star (source_id)
  select: (id: string | null) => void
  group: { name: string; ids: string[] } | null   // highlighted group
  setGroup: (g: { name: string; ids: string[] } | null) => void
  orbits: OrbitResult | null
  setOrbits: (o: OrbitResult | null) => void
  time: number                       // Myr (negative = past)
  setTime: (t: number) => void
  colorBy: string
  setColorBy: (c: string) => void
  activePotential: string
  setActivePotential: (p: string) => void
}

export const useApp = create<State>((set) => ({
  view: 'atlas',
  setView: (view) => set({ view }),
  meta: null,
  setMeta: (meta) => set({ meta }),
  points: null,
  setPoints: (points) => set({ points }),
  selected: null,
  select: (selected) => set({ selected }),
  group: null,
  setGroup: (group) => set({ group }),
  orbits: null,
  setOrbits: (orbits) => set({ orbits, time: 0 }),
  time: 0,
  setTime: (time) => set({ time }),
  colorBy: 'FE_H',
  setColorBy: (colorBy) => set({ colorBy }),
  activePotential: 'McMillan17',
  setActivePotential: (activePotential) => set({ activePotential }),
}))
