import { useEffect, useState } from 'react'
import { useApp, type View } from './store'
import { getJSON, getPoints } from './api'
import Atlas from './views/Atlas'
import Families from './views/Families'
import Constellations from './views/Constellations'
import Merger from './views/Merger'
import Anomalies from './views/Anomalies'
import Validation from './views/Validation'
import Methods from './views/Methods'
import CosmicBackdrop from './components/CosmicBackdrop'

const NAV: { id: View; label: string; sub: string }[] = [
  { id: 'atlas', label: 'Atlas & time', sub: '3D stars, orbits, dossiers' },
  { id: 'families', label: 'Stellar families', sub: 'discover → test hypotheses' },
  { id: 'constellations', label: 'Constellations', sub: 'patterns vs. real structure' },
  { id: 'merger', label: 'Merger debris', sub: 'Gaia–Enceladus test' },
  { id: 'anomalies', label: 'Anomalies', sub: 'unusual orbit for chemistry' },
  { id: 'validation', label: 'Validation', sub: 'known clusters as controls' },
  { id: 'methods', label: 'Methods & limits', sub: 'data, assumptions, caveats' },
]

export default function App() {
  const { view, setView, setMeta, setPoints, meta, points } = useApp()
  const [err, setErr] = useState('')
  useEffect(() => {
    getJSON('/api/meta').then(setMeta).catch(e => setErr(String(e)))
    getPoints().then(setPoints).catch(e => setErr(String(e)))
  }, [setMeta, setPoints])

  if (err) return <div className="loading-screen"><div><h2>Backend not reachable</h2><p className="err">{err}</p><p className="dim">Start it with <code>./run.sh</code> (see README).</p></div></div>
  if (!meta || !points) return <div className="loading-screen"><div><span className="spinner" /><p>Loading {meta ? `${meta.n_stars.toLocaleString()} stars` : 'catalogue'}…</p></div></div>

  return (
    <div className="app">
      <CosmicBackdrop />
      <nav className="nav">
        <div className="brand">
          <div className="brand-orbit" aria-hidden="true"><i /><i /><i /></div>
          <div><h1>Palimpsest</h1><p>Galactic archaeology workbench</p></div>
        </div>
        <div className="nav-links">
          {NAV.map(n => (
            <button key={n.id} className={view === n.id ? 'active' : ''} onClick={() => setView(n.id)} aria-current={view === n.id ? 'page' : undefined}>
              <span>{n.label}</span><small>{n.sub}</small>
            </button>
          ))}
        </div>
        <div className="foot">
          {meta.n_stars.toLocaleString()} stars · APOGEE DR17 × Gaia DR3<br />
          <span className="tag measured" style={{ marginTop: 6 }}>measured</span> <span className="tag inferred">inferred</span> <span className="tag hypo">hypothesis</span>
        </div>
      </nav>
      <main className="main">
        <div className="view-stage" key={view}>
          {view === 'atlas' && <Atlas />}
          {view === 'families' && <Families />}
          {view === 'constellations' && <Constellations />}
          {view === 'merger' && <Merger />}
          {view === 'anomalies' && <Anomalies />}
          {view === 'validation' && <Validation />}
          {view === 'methods' && <Methods />}
        </div>
      </main>
    </div>
  )
}
