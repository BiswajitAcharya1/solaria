export async function getJSON<T = any>(url: string): Promise<T> {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${r.status}: ${(await r.text()).slice(0, 300)}`)
  return r.json()
}

export async function postJSON<T = any>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!r.ok) {
    let msg = await r.text()
    try { msg = JSON.parse(msg).detail ?? msg } catch { /* plain text */ }
    throw new Error(`${r.status}: ${String(msg).slice(0, 300)}`)
  }
  const ct = r.headers.get('content-type') || ''
  return (ct.includes('json') ? r.json() : r.text()) as Promise<T>
}

export interface Points {
  n: number
  columns: string[]
  data: Float32Array
  col: (name: string) => Float32Array
}

export async function getPoints(): Promise<Points> {
  const r = await fetch('/api/points')
  if (!r.ok) throw new Error('could not load star table')
  const columns = (r.headers.get('X-Columns') || '').split(',')
  const n = Number(r.headers.get('X-Rows'))
  const data = new Float32Array(await r.arrayBuffer())
  const k = columns.length
  const cache: Record<string, Float32Array> = {}
  return {
    n, columns, data,
    col(name: string) {
      if (cache[name]) return cache[name]
      const j = columns.indexOf(name)
      const out = new Float32Array(n)
      for (let i = 0; i < n; i++) out[i] = data[i * k + j]
      cache[name] = out
      return out
    },
  }
}

export function download(name: string, text: string, type = 'text/plain') {
  const blob = new Blob([text], { type })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

export const fmt = (v: number | null | undefined, d = 2) =>
  v === null || v === undefined || !Number.isFinite(v) ? '–' : v.toFixed(d)
