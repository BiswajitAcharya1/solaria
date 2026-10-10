// Standalone preview of the research panels (open /research-preview.html?c=Ori).
import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { type Catalog, analyse, figureHips, loadCatalog, type Star } from '../constellations/data'
import ResearchPanel, { StatusBar } from './ResearchPanel'

function Preview() {
  const [cat, setCat] = useState<Catalog | null>(null)
  const [focus, setFocus] = useState<number | null>(null)
  useEffect(() => { loadCatalog().then(setCat) }, [])
  if (!cat) return null
  const abbr = new URLSearchParams(location.search).get('c') ?? 'UMa'
  const fig = cat.figures.find(f => f.abbr === abbr)!
  const stars = figureHips(fig.lines).map(h => cat.stars.get(h)).filter((s): s is Star => !!s)
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'radial-gradient(120% 90% at 50% 40%, #081333, #02040b 75%)' }}>
      <ResearchPanel name={fig.name.toLowerCase()} stars={stars} kin={analyse(stars)!} focus={focus} onFocus={setFocus} sources={cat.sources} />
      <StatusBar nStars={cat.all.length} nFigures={cat.figures.length} unfold={1} tMyr={0} />
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<StrictMode><Preview /></StrictMode>)
