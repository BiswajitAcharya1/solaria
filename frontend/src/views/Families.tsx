import { useEffect, useMemo, useState } from 'react'
import { getJSON, postJSON, fmt, download } from '../api'
import { useApp } from '../store'
import Plot, { COLORS } from '../components/Plot'

export default function Families() {
  const { setGroup, setView, meta } = useApp()
  const [presets, setPresets] = useState<any[]>([])
  const [disc, setDisc] = useState<any>(null)
  const [params, setParams] = useState({ cx: 0, cy: 0, cz: 0, radius: 300, mode: 'phase_space', mcs: 8, ms: 5, poe: 10, ps: 10, vs: 1 })
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [ev, setEv] = useState<any>(null)
  const [evName, setEvName] = useState('')
  const [lookback, setLookback] = useState(30)

  useEffect(() => { getJSON('/api/presets').then(setPresets).catch(() => {}) }, [])

  const runDiscover = async () => {
    setBusy('discover'); setErr('')
    try {
      setDisc(await postJSON('/api/discover', { center_pc: [params.cx, params.cy, params.cz], radius_pc: params.radius, mode: params.mode,
        min_cluster_size: params.mcs, min_samples: params.ms, min_poe: params.poe, pos_scale_pc: params.ps, vel_scale_kms: params.vs }))
    } catch (e) { setErr(String(e)) } finally { setBusy('') }
  }
  const evaluate = async (name: string, ids: string[]) => {
    setBusy('evaluate'); setErr(''); setEv(null); setEvName(name)
    setGroup({ name, ids })
    try { setEv(await postJSON('/api/evaluate', { source_ids: ids, lookback_myr: lookback, n_mc: 48, n_null: 200 })) }
    catch (e) { setErr(String(e)) } finally { setBusy('') }
  }
  const centreOn = (p: any) => setParams({ ...params, cx: Math.round(p.centroid_pc[0]), cy: Math.round(p.centroid_pc[1]), cz: Math.round(p.centroid_pc[2]), radius: 150 })

  return (
    <div className="page">
      <h2>Stellar family reconstruction</h2>
      <p className="lede">Candidate discovery uses <b>kinematics only</b>; chemistry, ages and orbital traceback are then used as <b>independent</b> tests of two competing hypotheses, always against matched field stars. Known open clusters act as positive controls.</p>
      <div className="grid g2">
        <div className="card">
          <h3>1 · Discover kinematic candidates (HDBSCAN)</h3>
          <div className="row">
            <label className="f">Mode<select value={params.mode} onChange={e => setParams({ ...params, mode: e.target.value })}>
              <option value="phase_space">Phase space (X,Y,Z,U,V,W) — clusters, associations</option>
              <option value="integrals">Orbital actions (√J_R, L_z, √J_z) — dispersed populations</option></select></label>
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <label className="f">Centre X [pc]<input type="number" value={params.cx} onChange={e => setParams({ ...params, cx: +e.target.value })} /></label>
            <label className="f">Y<input type="number" value={params.cy} onChange={e => setParams({ ...params, cy: +e.target.value })} /></label>
            <label className="f">Z<input type="number" value={params.cz} onChange={e => setParams({ ...params, cz: +e.target.value })} /></label>
            <label className="f">Radius [pc]<input type="number" value={params.radius} onChange={e => setParams({ ...params, radius: +e.target.value })} /></label>
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <label className="f">min cluster size<input type="number" value={params.mcs} onChange={e => setParams({ ...params, mcs: +e.target.value })} /></label>
            <label className="f">min samples<input type="number" value={params.ms} onChange={e => setParams({ ...params, ms: +e.target.value })} /></label>
            <label className="f">ϖ/σ ≥<input type="number" value={params.poe} onChange={e => setParams({ ...params, poe: +e.target.value })} /></label>
            {params.mode === 'phase_space' && <>
              <label className="f">pc per unit<input type="number" value={params.ps} onChange={e => setParams({ ...params, ps: +e.target.value })} /></label>
              <label className="f">km/s per unit<input type="number" value={params.vs} onChange={e => setParams({ ...params, vs: +e.target.value })} /></label></>}
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn" onClick={runDiscover} disabled={!!busy}>{busy === 'discover' ? 'Clustering…' : 'Find candidates'}</button>
            <span className="muted small">Scaling choice is a physical assumption: it sets how many pc of separation equal 1 km/s of velocity difference.</span>
          </div>
        </div>
        <div className="card">
          <h3>Known open clusters in the sample <span className="tag good">validation targets</span></h3>
          <p className="small muted">OCCAM members (Gaia astrometric probability ≥ 0.7 and APOGEE RV probability ≥ 0.5 — chemistry not used for membership).</p>
          <div className="scroll" style={{ maxHeight: 220 }}><table className="t"><thead><tr><th>Cluster</th><th className="num">members</th><th className="num">d [pc]</th><th></th></tr></thead>
            <tbody>{presets.map(p => <tr key={p.name}><td>{p.name}</td><td className="num">{p.n}</td><td className="num">{fmt(p.dist_pc, 0)}</td>
              <td><div className="row"><button className="btn small" disabled={!!busy} onClick={() => evaluate(`${p.name} (OCCAM members)`, p.source_ids)}>evaluate</button>
                <button className="btn ghost small" onClick={() => centreOn(p)}>discover here</button></div></td></tr>)}</tbody></table></div>
        </div>
      </div>
      {err && <div className="note bad" style={{ marginTop: 12 }}>{err}</div>}
      {disc && <div className="card" style={{ marginTop: 14 }}>
        <h3>Candidates: {disc.groups.length} groups from {disc.n_region.toLocaleString()} stars in region ({disc.n_grouped} grouped)</h3>
        <p className="small muted">{disc.note}</p>
        <div className="scroll"><table className="t"><thead><tr><th>#</th><th className="num">N</th><th className="num">w/ chem</th><th className="num">size [pc]</th><th className="num">σ_v [km/s]</th><th className="num">[Fe/H]</th><th>OCCAM labels</th><th>Nearest known (HR23)</th><th></th></tr></thead>
          <tbody>{disc.groups.map((g: any) => <tr key={g.label}><td>{g.label}</td><td className="num">{g.n}</td><td className="num">{g.n_with_chemistry}</td><td className="num">{fmt(g.size_pc, 0)}</td>
            <td className="num">{fmt(g.sigma_v_kms, 1)}</td><td className="num">{fmt(g.feh_median, 2)} ± {fmt(g.feh_spread, 2)}</td>
            <td className="small">{Object.entries(g.occam_members).map(([k, v]) => `${k} (${v})`).join(', ') || '–'}</td>
            <td className="small">{g.known_match[0] ? `${g.known_match[0].name} (${fmt(g.known_match[0].centroid_offset_pc, 0)} pc, ${fmt(g.known_match[0].velocity_offset_kms, 1)} km/s)` : '–'}</td>
            <td><button className="btn small" disabled={!!busy} onClick={() => evaluate(`Candidate #${g.label}`, g.source_ids)}>evaluate</button></td></tr>)}</tbody></table></div>
      </div>}
      <div className="row" style={{ marginTop: 14 }}>
        <label className="f">Traceback look-back for evaluation [Myr]<input type="number" value={lookback} min={1} max={300} onChange={e => setLookback(+e.target.value)} /></label>
        {busy === 'evaluate' && <><span className="spinner" /><span className="dim">Evaluating {evName}: field model, null calibration, Monte Carlo traceback…</span></>}
      </div>
      {ev && <Evaluation ev={ev} name={evName} onShow={() => setView('atlas')} floor={meta?.floor} />}
    </div>
  )
}

function Evaluation({ ev, name, onShow }: { ev: any; name: string; onShow: () => void; floor?: any }) {
  const { setOrbits } = useApp()
  const ch = ev.chemistry
  const elPlot = useMemo(() => {
    if (!ch.available) return null
    const els = ch.elements.filter((e: any) => e.sigma_int !== null)
    return [
      { x: els.map((e: any) => e.element), y: els.map((e: any) => e.sigma_int), name: 'group intrinsic scatter', type: 'bar', marker: { color: '#7aa2ff' },
        error_y: { type: 'data', symmetric: false, array: els.map((e: any) => Math.max(0, (e.sigma_int_upper95 ?? e.sigma_int) - e.sigma_int)), arrayminus: els.map(() => 0), color: '#a7b2cc' } },
      { x: els.map((e: any) => e.element), y: els.map((e: any) => ch.reference_spread[e.element]), name: 'field spread (matched reference)', type: 'bar', marker: { color: '#3a4766' } },
      { x: els.map((e: any) => e.element), y: els.map((e: any) => e.median_err), name: 'median measurement error', mode: 'markers', marker: { color: '#ffcf6e', symbol: 'diamond', size: 8 } },
    ]
  }, [ch])
  const exportMd = async () => download(`${name.replace(/\W+/g, '_')}_report.md`, await postJSON('/api/report', { kind: 'group', result: ev, title: name }))
  const exportJson = () => download(`${name.replace(/\W+/g, '_')}_result.json`, JSON.stringify(ev, null, 1), 'application/json')
  const exportCsv = async () => download(`${name.replace(/\W+/g, '_')}_members.csv`, await (await fetch(`/api/members.csv?ids=${ev.source_ids.join(',')}`)).text(), 'text/csv')
  const showOrbits = async () => {
    const r = await postJSON('/api/orbits', { source_ids: ev.source_ids.slice(0, 12), lookback_myr: ev.traceback?.lookback_myr ?? 30, n_mc: 16, potentials: ['McMillan17', 'MWPotential2014'] })
    setOrbits(r); onShow()
  }
  const h = ev.hypotheses
  return (
    <div className="grid" style={{ marginTop: 14 }}>
      <div className="card">
        <div className="row"><h3 style={{ margin: 0 }}>{name}: {ev.n} stars</h3><span className="spacer" />
          <button className="btn ghost small" onClick={showOrbits}>trajectories in 3D</button>
          <button className="btn ghost small" onClick={exportMd}>report (.md)</button>
          <button className="btn ghost small" onClick={exportCsv}>members (.csv)</button>
          <button className="btn ghost small" onClick={exportJson}>full result (.json)</button></div>
        <div className="grid g2" style={{ marginTop: 10 }}>
          <div><span className="tag hypo">A</span> {h.A}</div><div><span className="tag hypo">B</span> {h.B}</div>
        </div>
        <div className="verdict" style={{ marginTop: 10 }}>{h.verdict}</div>
        <table className="t" style={{ marginTop: 10 }}>
          <thead><tr><th>Evidence</th><th>Measured value</th><th>A predicts</th><th>B predicts</th><th>Favours</th></tr></thead>
          <tbody>{h.rows.map((r: any) => <tr key={r.evidence}><td>{r.evidence}{r.quantitative && <span className="tag measured" style={{ marginLeft: 6 }}>likelihood</span>}</td><td>{r.value}</td><td className="muted">{r.A_predicts}</td><td className="muted">{r.B_predicts}</td><td className={`fav-${r.favours}`}>{r.favours}</td></tr>)}</tbody>
        </table>
        <p className="small muted">No overall probability is reported: only the chemical test is a calibrated likelihood ratio; the other rows are consistency checks.</p>
      </div>
      <div className="grid g2">
        {ch.available ? <div className="card">
          <h3>Chemical homogeneity vs field</h3>
          <Plot data={elPlot as any} height={280} layout={{ barmode: 'group', yaxis: { title: { text: 'dex' } }, legend: { orientation: 'h', y: -0.25 } }} />
          <p className="small muted">Systematic floor from calibration clusters is included in the errors. Reference: {ch.reference.n.toLocaleString()} field stars with Teff {ch.reference.teff.map((v: number) => v.toFixed(0)).join('–')} K, log g {ch.reference.logg.map((v: number) => v.toFixed(1)).join('–')}, R {ch.reference.R_kpc.map((v: number) => v.toFixed(1)).join('–')} kpc.</p>
        </div> : <div className="card"><h3>Chemistry</h3><div className="note">{ch.reason}</div></div>}
        {ch.available && <div className="card">
          <h3>Evidence ratio against the null</h3>
          <Plot height={280} data={[{ x: ch.null_lnBF.values, type: 'histogram', nbinsx: 40, name: 'random field groups', marker: { color: '#3a4766' } } as any]}
            layout={{ xaxis: { title: { text: 'ln BF (single birth cloud vs independent field stars)' } }, yaxis: { title: { text: 'trials' } },
              shapes: [{ type: 'line', x0: ch.ln_bayes_factor, x1: ch.ln_bayes_factor, y0: 0, y1: 1, yref: 'paper', line: { color: '#ff9fd0', width: 3 } }],
              annotations: [{ x: ch.ln_bayes_factor, y: 1, yref: 'paper', text: `this group: ${ch.ln_bayes_factor.toFixed(1)}`, showarrow: false, font: { color: '#ff9fd0' }, yanchor: 'bottom' }] }} />
          <p className="small muted">Empirical false-positive rate: {(100 * ch.empirical_false_positive_rate).toFixed(2)}% of {ch.null_lnBF.values.length} same-size random field groups reach this ln BF.</p>
        </div>}
        {ch.available && <div className="card">
          <h3>Which elements carry the signal?</h3>
          <Plot height={250} data={[{ x: ch.element_contributions.map((e: any) => e.element), y: ch.element_contributions.map((e: any) => e.delta_lnBF), type: 'bar',
            marker: { color: ch.element_contributions.map((e: any) => e.delta_lnBF >= 0 ? '#5fd4a0' : '#ff7b8a') } } as any]}
            layout={{ yaxis: { title: { text: 'Δ ln BF when element included' } } }} />
          <p className="small muted">Positive: the element supports a common origin; negative: it weakens it.</p>
        </div>}
        {ch.available && <div className="card">
          <h3>Which members weaken the case?</h3>
          <Plot height={250} data={[{ y: ch.member_contributions.map((m: any) => m.delta_lnBF_if_removed), x: ch.member_contributions.map((_: any, i: number) => i), type: 'bar',
            text: ch.member_contributions.map((m: any) => m.source_id), hovertemplate: '%{text}<br>Δ ln BF %{y:.2f}<extra></extra>',
            marker: { color: ch.member_contributions.map((m: any) => m.delta_lnBF_if_removed >= 0 ? '#5fd4a0' : '#ff7b8a') } } as any]}
            layout={{ xaxis: { title: { text: 'member' } }, yaxis: { title: { text: 'Δ ln BF contributed' } } }} />
        </div>}
        {ev.traceback && <div className="card">
          <h3>Traceback: group size vs time <span className="tag inferred">McMillan17</span></h3>
          <Plot height={260} data={[
            { x: ev.traceback.times_myr, y: ev.traceback.size_pc_p84, line: { width: 0 }, showlegend: false, hoverinfo: 'skip' },
            { x: ev.traceback.times_myr, y: ev.traceback.size_pc_p16, fill: 'tonexty', fillcolor: 'rgba(122,162,255,0.2)', line: { width: 0 }, name: '16–84% MC' },
            { x: ev.traceback.times_myr, y: ev.traceback.size_pc_median, line: { color: COLORS[0], width: 2 }, name: 'median' }] as any}
            layout={{ xaxis: { title: { text: 'time [Myr]' } }, yaxis: { title: { text: 'median distance to group centre [pc]' } }, legend: { orientation: 'h', y: -0.3 } }} />
          <p className="small muted">Minimum size {fmt(ev.traceback.size_min_pc.median, 1)} pc at {fmt(ev.traceback.t_min_myr.median, 1)} Myr (16–84%: {fmt(ev.traceback.t_min_myr.p16, 1)} to {fmt(ev.traceback.t_min_myr.p84, 1)}). Measurement errors inflate apparent sizes, especially along the line of sight.</p>
        </div>}
        <div className="card">
          <h3>Kinematics, ages & known populations</h3>
          <dl className="kv">
            <dt>Present size</dt><dd>{fmt(ev.kinematics.size_pc, 1)} pc (median distance error {fmt(ev.kinematics.median_distance_error_pc, 1)} pc)</dd>
            <dt>σ_v (U,V,W)</dt><dd>{['U', 'V', 'W'].map(c => fmt(ev.kinematics.velocity_dispersion[c].sigma_int, 2)).join(', ')} km/s</dd>
            <dt>Ages</dt><dd>{ev.ages.available ? `${ev.ages.n} giants, median ${fmt(ev.ages.median_age_gyr, 2)} Gyr, intrinsic log-age scatter ${fmt(ev.ages.log_age_sigma_int, 2)} dex` : ev.ages.reason}</dd>
            <dt>GALAH DR4</dt><dd>{ev.galah_check.available ? `${ev.galah_check.n} members; ` + ev.galah_check.elements.map((e: any) => `${e.element} σ=${fmt(e.sigma_int, 3)}`).join(', ') : `${ev.galah_check.n} members with GALAH data — not enough for an independent test`}</dd>
            <dt>OCCAM labels</dt><dd>{Object.entries(ev.known.occam).map(([k, v]) => `${k} (${v})`).join(', ') || 'none'}</dd>
            <dt>Hunt & Reffert 2023</dt><dd>{ev.known.hunt_reffert_2023.map((m: any) => `${m.name} (Δ ${fmt(m.centroid_offset_pc, 0)} pc, ${fmt(m.velocity_offset_kms, 1)} km/s, ${fmt(m.age_myr, 0)} Myr)`).join('; ')}</dd>
          </dl>
        </div>
      </div>
      <div className="grid g2">
        <div className="card"><h3>Suggested follow-up observations</h3><ul className="caveats">{ev.follow_up.map((s: string) => <li key={s}>{s}</li>)}</ul></div>
        <div className="card"><h3>Limitations</h3><ul className="caveats">{ev.caveats.map((s: string) => <li key={s}>{s}</li>)}</ul></div>
      </div>
    </div>
  )
}
