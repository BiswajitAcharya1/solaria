import { useEffect, useRef } from 'react'
import Plotly from 'plotly.js-dist-min'

const BASE_LAYOUT: Partial<Plotly.Layout> = {
  paper_bgcolor: 'rgba(0,0,0,0)',
  plot_bgcolor: 'rgba(0,0,0,0)',
  font: { family: 'Inter, sans-serif', size: 11.5, color: '#6e6558' },
  margin: { l: 56, r: 14, t: 26, b: 44 },
  xaxis: { gridcolor: 'rgba(81,69,51,0.09)', zerolinecolor: 'rgba(81,69,51,0.2)', linecolor: 'rgba(81,69,51,0.2)' },
  yaxis: { gridcolor: 'rgba(81,69,51,0.09)', zerolinecolor: 'rgba(81,69,51,0.2)', linecolor: 'rgba(81,69,51,0.2)' },
  legend: { bgcolor: 'rgba(0,0,0,0)', font: { size: 11 } },
  hoverlabel: { bgcolor: '#fefbf5', bordercolor: '#ddd3c1', font: { color: '#2e2821' } },
}

function merge(a: any, b: any): any {
  const out = { ...a }
  for (const k of Object.keys(b || {})) {
    out[k] = b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k] ? merge(a[k], b[k]) : b[k]
  }
  return out
}

export default function Plot({ data, layout, height = 300, onClick }: {
  data: Partial<Plotly.PlotData>[]
  layout?: Partial<Plotly.Layout>
  height?: number
  onClick?: (pt: any) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!ref.current) return
    const el = ref.current as any
    Plotly.react(el, data as any, merge(merge(BASE_LAYOUT, { height }), layout || {}),
      { displaylogo: false, responsive: true, modeBarButtonsToRemove: ['lasso2d', 'select2d'] })
    if (onClick) {
      el.removeAllListeners?.('plotly_click')
      el.on('plotly_click', (ev: any) => onClick(ev.points[0]))
    }
  }, [data, layout, height, onClick])
  useEffect(() => () => { if (ref.current) Plotly.purge(ref.current) }, [])
  return <div ref={ref} className="plot" />
}

export const COLORS = ['#5f7f66', '#a86145', '#557887', '#806d8a', '#b08a5d', '#739192', '#9a6f73', '#7f9066']
