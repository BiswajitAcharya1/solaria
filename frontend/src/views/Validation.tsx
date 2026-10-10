import { useEffect, useState } from 'react'
import { getJSON, fmt } from '../api'
import Plot from '../components/Plot'

export default function Validation() {
  const [v, setV] = useState<any>(null)
  useEffect(() => { getJSON('/api/validation').then(setV) }, [])
  if (!v) return <div className="page"><span className="spinner" /></div>
  if (!v.floor) return <div className="page"><h2>Validation</h2><div className="note">Validation results not generated yet. Run <code>python -m palimpsest.validate</code>.</div></div>
  const ge = v.group_evidence || []
  const disc = (v.discovery || []).filter((d: any) => d.found)
  return (
    <div className="page">
      <h2>Scientific validation against known open clusters</h2>
      <p className="lede">Before trusting the method on unknown groups, it is tested on open clusters whose membership is established independently (OCCAM: Gaia astrometric membership + APOGEE RVs, <b>without</b> chemistry). Clusters are split into a calibration half (sets the systematic floor) and a held-out test half. Generated {v.generated}.</p>
      <div className="grid g2">
        <div className="card">
          <h3>1 · Systematic abundance floor (calibration half)</h3>
          <p className="small muted">Median intrinsic scatter of cluster members after removing reported errors: captures pipeline systematics and residual inhomogeneity. Calibration clusters: {v.calibration_clusters.join(', ')}.</p>
          <Plot height={240} data={[{ x: Object.keys(v.floor), y: Object.values(v.floor), type: 'bar', marker: { color: '#7aa2ff' } } as any]} layout={{ yaxis: { title: { text: 'floor [dex]' } } }} />
        </div>
        <div className="card">
          <h3>2 · Pairs: siblings vs chemical doppelgängers (test half)</h3>
          <p className="small muted">Fraction of member–member pairs judged chemically indistinguishable (recall) vs the fraction of random field pairs with matched Teff/log g that are equally indistinguishable (doppelgänger rate, cf. Ness et al. 2018). {v.pairs.n_member_pairs} member pairs, {v.pairs.n_field_pairs.toLocaleString()} field pairs.</p>
          <table className="t"><thead><tr><th>p threshold</th><th className="num">member-pair recall</th><th className="num">field doppelgänger rate</th></tr></thead>
            <tbody>{v.pairs.thresholds.map((t: any) => <tr key={t.p_threshold}><td>p &gt; {t.p_threshold}</td><td className="num">{fmt(100 * t.member_pair_recall, 1)}%</td><td className="num">{fmt(100 * t.field_doppelganger_rate, 1)}%</td></tr>)}</tbody></table>
          <p className="small dim" style={{ marginTop: 8 }}>A non-negligible doppelgänger rate means pairwise chemistry alone cannot establish common birth in a sample of hundreds of thousands of stars — the reason this tool combines chemistry with dynamics.</p>
        </div>
      </div>
      <div className="card" style={{ marginTop: 14 }}>
        <h3>3 · Group evidence ratio: true clusters, half-contaminated clusters, random field groups (test half)</h3>
        <Plot height={300} data={[
          { x: ge.map((g: any) => g.cluster), y: ge.map((g: any) => g.lnBF), name: 'true members', type: 'bar', marker: { color: '#5fd4a0' } },
          { x: ge.map((g: any) => g.cluster), y: ge.map((g: any) => g.lnBF_half_contaminated), name: '50% replaced by field stars', type: 'bar', marker: { color: '#ffcf6e' } },
          { x: ge.map((g: any) => g.cluster), y: ge.map((g: any) => g.null_p99), name: 'random field groups, 99th pct', mode: 'markers', marker: { color: '#ff7b8a', symbol: 'line-ew-open', size: 22, line: { width: 3 } } },
        ] as any} layout={{ barmode: 'group', yaxis: { title: { text: 'ln BF' } }, legend: { orientation: 'h', y: -0.25 } }} />
        <table className="t"><thead><tr><th>Cluster</th><th className="num">N</th><th className="num">ln BF</th><th className="num">FPR</th><th className="num">ln BF (50% contaminated)</th><th className="num">FPR</th><th className="num">null median</th></tr></thead>
          <tbody>{ge.map((g: any) => <tr key={g.cluster}><td>{g.cluster}</td><td className="num">{g.n}</td><td className="num">{fmt(g.lnBF, 1)}</td><td className="num">{fmt(g.fpr, 3)}</td><td className="num">{fmt(g.lnBF_half_contaminated, 1)}</td><td className="num">{fmt(g.fpr_contaminated, 3)}</td><td className="num">{fmt(g.null_median, 1)}</td></tr>)}</tbody></table>
      </div>
      <div className="card" style={{ marginTop: 14 }}>
        <h3>4 · Does chemistry improve recovery of real clusters? (kinematics-only vs kinematics + chemical vetting)</h3>
        <p className="small muted">HDBSCAN in 6D phase space within 150 pc of each cluster; the best-matching group is scored against OCCAM membership. Chemical vetting removes members inconsistent with the group mean abundances at p &lt; 0.01.</p>
        <div className="grid g2">
          {Object.entries(v.discovery_summary || {}).map(([ps, s]: any) => <div key={ps} className="card" style={{ background: 'var(--panel-2)' }}>
            <h3>scale {ps} pc per km/s — {s.n_clusters} clusters recovered</h3>
            <table className="t"><thead><tr><th></th><th className="num">precision</th><th className="num">recall</th></tr></thead><tbody>
              <tr><td>kinematics only</td><td className="num">{fmt(100 * s.kin_precision, 1)}%</td><td className="num">{fmt(100 * s.kin_recall, 1)}%</td></tr>
              <tr><td>+ chemical vetting</td><td className="num">{fmt(100 * s.kinchem_precision, 1)}%</td><td className="num">{fmt(100 * s.kinchem_recall, 1)}%</td></tr>
            </tbody></table></div>)}
        </div>
        <div className="scroll" style={{ marginTop: 10 }}><table className="t"><thead><tr><th>Cluster</th><th className="num">scale</th><th className="num">truth</th><th className="num">group</th><th className="num">P (kin)</th><th className="num">R (kin)</th><th className="num">after chem</th><th className="num">P (+chem)</th><th className="num">R (+chem)</th></tr></thead>
          <tbody>{disc.map((d: any) => <tr key={d.cluster + d.pos_scale_pc}><td>{d.cluster}</td><td className="num">{d.pos_scale_pc}</td><td className="num">{d.n_truth}</td><td className="num">{d.n_group}</td><td className="num">{fmt(d.kin_precision, 2)}</td><td className="num">{fmt(d.kin_recall, 2)}</td><td className="num">{d.n_after_chem}</td><td className="num">{fmt(d.kinchem_precision, 2)}</td><td className="num">{fmt(d.kinchem_recall, 2)}</td></tr>)}</tbody></table></div>
        <p className="small muted" style={{ marginTop: 8 }}>Caveat: "truth" labels are themselves based on Gaia kinematics, so kinematic recall is partly circular; precision changes from chemical vetting are the informative comparison. Field stars genuinely co-moving with a cluster but unlisted by OCCAM count as false positives.</p>
      </div>
    </div>
  )
}
