import { useEffect, useMemo, useState } from 'react'
import { getJSON, postJSON, fmt, download } from '../api'
import { useApp } from '../store'
import Plot, { COLORS } from '../components/Plot'

type Tab = 'overview' | 'history' | 'chemistry' | 'siblings' | 'ejection' | 'origin'

export default function StarPanel({ id }: { id: string }) {
  const [d, setD] = useState<any>(null)
  const [err, setErr] = useState('')
  const [tab, setTab] = useState<Tab>('overview')
  const { select } = useApp()
  useEffect(() => { getJSON(`/api/star/${id}`).then(setD).catch(e => setErr(String(e))) }, [id])
  if (err) return <div className="err">{err}</div>
  if (!d) return <div className="row"><span className="spinner" /> loading dossier…</div>
  return (
    <>
      <div className="row">
        <div>
          <div className="muted small">Gaia DR3</div>
          <div className="mono" style={{ fontSize: 14 }}>{d.source_id}</div>
          <div className="muted small">{d.apogee_id}{d.occam.cluster ? ` · OCCAM: ${d.occam.cluster} (p=${fmt(d.occam.cg_prob, 2)})` : ''}</div>
        </div>
        <span className="spacer" />
        <button className="btn ghost small" onClick={() => select(null)}>close</button>
      </div>
      <div className="tabs">
        {(['overview', 'history', 'chemistry', 'siblings', 'ejection', 'origin'] as Tab[]).map(t =>
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{t}</button>)}
      </div>
      {tab === 'overview' && <Overview d={d} />}
      {tab === 'history' && <History d={d} />}
      {tab === 'chemistry' && <Chemistry d={d} />}
      {tab === 'siblings' && <Siblings d={d} />}
      {tab === 'ejection' && <Ejection d={d} />}
      {tab === 'origin' && <Origin d={d} />}
    </>
  )
}

function Overview({ d }: { d: any }) {
  const m = d.measured, x = d.derived
  return (
    <div className="grid">
      <div className="card">
        <h3><span className="tag measured">measured</span> Observations</h3>
        <dl className="kv">
          <dt>RA, Dec</dt><dd>{fmt(m.ra_deg, 5)}°, {fmt(m.dec_deg, 5)}°</dd>
          <dt>Parallax</dt><dd>{fmt(m.parallax_mas, 4)} ± {fmt(m.parallax_error_mas, 4)} mas <span className="muted">(ZP {fmt(m.parallax_zero_point_mas, 3)})</span></dd>
          <dt>Proper motion</dt><dd>{fmt(m.pmra_masyr, 3)} ± {fmt(m.pmra_error, 3)}, {fmt(m.pmdec_masyr, 3)} ± {fmt(m.pmdec_error, 3)} mas/yr</dd>
          <dt>Correlations</dt><dd className="muted">ϖ–μα {fmt(m.parallax_pmra_corr, 2)}, ϖ–μδ {fmt(m.parallax_pmdec_corr, 2)}, μα–μδ {fmt(m.pmra_pmdec_corr, 2)}</dd>
          <dt>RV (APOGEE)</dt><dd>{fmt(m.rv_apogee_kms, 2)} ± {fmt(m.rv_error_kms, 2)} km/s <span className="muted">{m.apogee_nvisits} visit(s), scatter {fmt(m.apogee_vscatter_kms, 2)}</span></dd>
          <dt>RV (Gaia DR3)</dt><dd>{m.rv_gaia_kms === null ? '–' : `${fmt(m.rv_gaia_kms, 2)} ± ${fmt(m.rv_gaia_error_kms, 2)} km/s`}</dd>
          <dt>RUWE</dt><dd>{fmt(m.ruwe, 2)}</dd>
          <dt>G, BP−RP, H</dt><dd>{fmt(m.G, 2)}, {fmt(m.bp_rp, 2)}, {fmt(m.H_2mass, 2)}</dd>
          <dt>Teff, log g</dt><dd>{fmt(m.teff_K, 0)} K, {fmt(m.logg, 2)} <span className="muted">(ASPCAP, S/N {fmt(m.snr, 0)})</span></dd>
        </dl>
      </div>
      <div className="card">
        <h3><span className="tag inferred">inferred</span> Phase space & orbit <span className="muted small">McMillan (2017) potential</span></h3>
        <dl className="kv">
          <dt>Distance</dt><dd>{fmt(x.distance_pc, 1)} pc <span className="muted">(1/ϖ, zero-point corrected)</span></dd>
          <dt>X, Y, Z</dt><dd>{fmt(x.X_pc, 1)}, {fmt(x.Y_pc, 1)}, {fmt(x.Z_pc, 1)} pc</dd>
          <dt>U, V, W</dt><dd>{fmt(x.U_kms, 2)}, {fmt(x.V_kms, 2)}, {fmt(x.W_kms, 2)} km/s <span className="muted">(heliocentric)</span></dd>
          <dt>R, z, v_φ</dt><dd>{fmt(x.R_gal_kpc, 3)} kpc, {fmt(x.z_gal_kpc, 3)} kpc, {fmt(x.v_phi_kms, 1)} km/s</dd>
          <dt>Actions</dt><dd>J_R {fmt(x.J_R_kpckms, 1)}, L_z {fmt(x.Lz_kpckms, 0)}, J_z {fmt(x.J_z_kpckms, 2)} kpc km/s</dd>
          <dt>Orbit shape</dt><dd>e = {fmt(x.eccentricity, 3)}, z_max = {fmt(x.zmax_kpc, 3)} kpc, R {fmt(x.rperi_kpc, 2)}–{fmt(x.rapo_kpc, 2)} kpc</dd>
          <dt>Age</dt><dd>{x.age_astroNN_gyr === null ? <span className="muted">not estimated (astroNN ages used only for giants)</span> : <>{fmt(x.age_astroNN_gyr, 1)} ± {fmt(x.age_astroNN_error_gyr, 1)} Gyr <span className="muted">(astroNN, model-dependent)</span></>}</dd>
        </dl>
      </div>
      <div className="card">
        <h3>Data quality</h3>
        <table className="t"><tbody>
          {d.anomaly.quality.map((q: any) => (
            <tr key={q.check}><td>{q.ok ? <span className="tag good">ok</span> : <span className="tag bad">check</span>}</td><td>{q.check}</td><td className="muted">{q.detail}</td></tr>
          ))}
        </tbody></table>
      </div>
    </div>
  )
}

function History({ d }: { d: any }) {
  const { orbits, setOrbits, group } = useApp()
  const [lookback, setLookback] = useState(100)
  const [nmc, setNmc] = useState(32)
  const [both, setBoth] = useState(true)
  const [withGroup, setWithGroup] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const run = async () => {
    setBusy(true); setErr('')
    try {
      const ids = withGroup && group ? Array.from(new Set([d.source_id, ...group.ids])).slice(0, 12) : [d.source_id]
      const r = await postJSON('/api/orbits', { source_ids: ids, lookback_myr: lookback, n_mc: nmc,
        potentials: both ? ['McMillan17', 'MWPotential2014'] : ['McMillan17'] })
      setOrbits(r)
    } catch (e) { setErr(String(e)) } finally { setBusy(false) }
  }
  const mine = orbits && orbits.source_ids.includes(d.source_id) ? orbits : null
  const plots = useMemo(() => {
    if (!mine) return null
    const pots = Object.keys(mine.runs)
    const spread: any[] = [], rz: any[] = []
    pots.forEach((p, k) => {
      const run = mine.runs[p]
      const s = run.stars.find(s => s.source_id === d.source_id)!
      spread.push({ x: run.times_myr, y: s.spread_pc_p50, name: `${p} median`, line: { color: COLORS[k] } })
      spread.push({ x: run.times_myr, y: s.spread_pc_p84, name: `${p} 84%`, line: { color: COLORS[k], dash: 'dot' } })
      const R = s.galcen_nominal_kpc.map(v => Math.hypot(v[0], v[1])), z = s.galcen_nominal_kpc.map(v => v[2])
      rz.push({ x: R, y: z, name: p, mode: 'lines', line: { color: COLORS[k] } })
    })
    const diff = mine.potential_difference?.stars.find(s => s.source_id === d.source_id)
    if (diff) spread.push({ x: mine.runs[pots[0]].times_myr, y: diff.separation_pc, name: 'McMillan17 vs MWPotential2014', line: { color: '#ff9fd0', width: 2 } })
    return { spread, rz }
  }, [mine, d.source_id])
  return (
    <div className="grid">
      <div className="card">
        <h3><span className="tag inferred">model</span> Where was this star in the past?</h3>
        <p className="small dim">Monte Carlo realisations of the Gaia astrometry (with its covariance) and the APOGEE RV are integrated backwards through a static Milky Way potential with galpy. Results appear in the 3D view with a time slider.</p>
        <div className="row">
          <label className="f">Look-back [Myr]<input type="number" min={1} max={500} value={lookback} onChange={e => setLookback(Number(e.target.value))} /></label>
          <label className="f">MC samples<input type="number" min={4} max={200} value={nmc} onChange={e => setNmc(Number(e.target.value))} /></label>
          <label className="row small"><input type="checkbox" checked={both} onChange={e => setBoth(e.target.checked)} /> compare 2 potentials</label>
          {group && <label className="row small"><input type="checkbox" checked={withGroup} onChange={e => setWithGroup(e.target.checked)} /> include group ({Math.min(group.ids.length, 11)})</label>}
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <button className="btn" disabled={busy} onClick={run}>{busy ? 'Integrating…' : 'Reconstruct trajectories'}</button>
          {busy && <span className="spinner" />}
        </div>
        {lookback > 200 && <div className="note" style={{ marginTop: 8 }}>Beyond ~200 Myr the bar, spiral arms and scattering by molecular clouds (not modelled) dominate; treat the result as illustrative of the orbit family, not the star's actual position.</div>}
        {err && <div className="err">{err}</div>}
      </div>
      {plots && (
        <>
          <div className="card">
            <h3>Positional uncertainty vs time</h3>
            <p className="small muted">Distance of Monte Carlo realisations from the nominal trajectory (measurement errors only), and the separation between nominal trajectories in the two potentials (model uncertainty).</p>
            <Plot data={plots.spread} height={260} layout={{ xaxis: { title: { text: 'time [Myr]' } }, yaxis: { title: { text: 'pc' }, type: 'log' }, legend: { orientation: 'h', y: -0.3 } }} />
          </div>
          <div className="card">
            <h3>Meridional orbit (R, z)</h3>
            <Plot data={plots.rz} height={240} layout={{ xaxis: { title: { text: 'R [kpc]' } }, yaxis: { title: { text: 'z [kpc]' } } }} />
          </div>
          <div className="card"><ul className="caveats">{mine!.caveats.map(c => <li key={c}>{c}</li>)}</ul></div>
        </>
      )}
    </div>
  )
}

function Chemistry({ d }: { d: any }) {
  const [nb, setNb] = useState<any>(null)
  const [busy, setBusy] = useState(false)
  const { setGroup } = useApp()
  const ab = d.abundances
  const go = async () => { setBusy(true); try { setNb(await getJSON(`/api/chem_neighbours/${d.source_id}?n=25`)) } finally { setBusy(false) } }
  return (
    <div className="grid">
      <div className="card">
        <h3><span className="tag measured">measured</span> Abundances</h3>
        <table className="t">
          <thead><tr><th>Element</th><th className="num">APOGEE DR17</th><th className="num">GALAH DR4</th></tr></thead>
          <tbody>{ab.map((a: any) => (
            <tr key={a.key}><td>{a.element}</td>
              <td className="num">{a.value === null ? <span className="muted">flagged / –</span> : `${fmt(a.value, 3)} ± ${fmt(a.error, 3)}`}</td>
              <td className="num">{a.galah === null ? <span className="muted">–</span> : `${fmt(a.galah, 3)} ± ${fmt(a.galah_error, 3)}`}</td></tr>))}
          </tbody>
        </table>
        <p className="small muted">GALAH values are on their own scale (not merged); see Methods for the measured APOGEE−GALAH offsets.</p>
      </div>
      <div className="card">
        <h3>Chemical twins</h3>
        <p className="small dim">χ² over ≥6 shared elements using errors plus an empirically calibrated systematic floor. A high p-value means "indistinguishable given the errors" — not "born together".</p>
        <button className="btn" onClick={go} disabled={busy}>{busy ? 'Comparing with 360k stars…' : 'Find chemical twins'}</button>
        {nb && <>
          <div className="note info" style={{ margin: '10px 0' }}>{nb.interpretation}</div>
          <div className="row"><button className="btn ghost small" onClick={() => setGroup({ name: 'Chemical twins', ids: nb.neighbours.map((n: any) => n.source_id) })}>show twins in 3D</button></div>
          <div className="scroll"><table className="t">
            <thead><tr><th>source_id</th><th className="num">χ²/dof</th><th className="num">p</th><th className="num">sep [pc]</th><th className="num">Δv [km/s]</th></tr></thead>
            <tbody>{nb.neighbours.map((n: any) => (
              <tr key={n.source_id}><td className="mono">{n.source_id}</td><td className="num">{fmt(n.chi2 / n.dof, 2)}</td><td className="num">{fmt(n.p_value, 3)}</td><td className="num">{fmt(n.separation_pc, 0)}</td><td className="num">{fmt(n.dv_kms, 1)}</td></tr>))}
            </tbody></table></div>
          <p className="small muted">Most chemical twins are far away and move very differently — chemistry alone does not identify siblings.</p>
        </>}
      </div>
    </div>
  )
}

function Siblings({ d }: { d: any }) {
  const [r, setR] = useState<any>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [sig, setSig] = useState(1.0)
  const { setGroup } = useApp()
  const go = async () => {
    setBusy(true); setErr('')
    try { setR(await postJSON('/api/siblings', { source_id: d.source_id, birth_sigma_kms: sig })) } catch (e) { setErr(String(e)) } finally { setBusy(false) }
  }
  const exportMd = async () => download(`siblings_${d.source_id}.md`, await postJSON('/api/report', { kind: 'siblings', result: r }))
  return (
    <div className="grid">
      <div className="card">
        <h3><span className="tag hypo">hypothesis</span> Were any stars born with this one?</h3>
        <p className="small dim">Combines two independent tests across the whole sample: orbital actions compatible with a shared birth site (given errors + a birth velocity dispersion) and chemistry indistinguishable within errors. The top candidates are then traced back in time.</p>
        <div className="row">
          <label className="f">Birth velocity dispersion [km/s]<input type="number" step={0.5} min={0.2} max={10} value={sig} onChange={e => setSig(Number(e.target.value))} /></label>
          <button className="btn" onClick={go} disabled={busy}>{busy ? 'Searching…' : 'Run sibling search'}</button>
        </div>
        {err && <div className="err">{err}</div>}
      </div>
      {r && <>
        <div className="card">
          <h3>What combining the evidence does</h3>
          <table className="t"><tbody>
            <tr><td>Comparable stars (same evolutionary class)</td><td className="num">{r.counts.comparable_stars.toLocaleString()}</td></tr>
            <tr><td>Chemically compatible (p &gt; 0.05)</td><td className="num">{r.counts.chemically_compatible.toLocaleString()}</td></tr>
            <tr><td>Dynamically compatible (actions)</td><td className="num">{r.counts.dynamically_compatible.toLocaleString()}</td></tr>
            <tr><td><b>Both</b></td><td className="num"><b>{r.counts.both}</b></td></tr>
            <tr><td>Expected if chemistry & orbits were independent</td><td className="num">{fmt(r.counts.expected_both_if_independent, 1)}</td></tr>
          </tbody></table>
          <p className="small muted">{r.method.chance}</p>
          <div className="row"><button className="btn ghost small" onClick={() => setGroup({ name: `Sibling candidates of ${d.source_id}`, ids: [d.source_id, ...r.candidates.slice(0, 100).map((c: any) => c.source_id)] })}>show in 3D</button>
            <button className="btn ghost small" onClick={exportMd}>export report</button></div>
        </div>
        {r.traceback.length > 0 && <div className="card">
          <h3>Past proximity of top candidates</h3>
          <table className="t"><thead><tr><th>source_id</th><th className="num">now [pc]</th><th className="num">closest [pc] (16–84%)</th><th className="num">when [Myr]</th></tr></thead>
            <tbody>{r.traceback.map((t: any) => <tr key={t.source_id}><td className="mono">{t.source_id}</td><td className="num">{fmt(t.separation_now_pc, 0)}</td>
              <td className="num">{fmt(t.d_min_pc.median, 0)} ({fmt(t.d_min_pc.p16, 0)}–{fmt(t.d_min_pc.p84, 0)})</td><td className="num">{fmt(t.t_min_myr, 1)}</td></tr>)}</tbody></table>
        </div>}
        <div className="card"><h3>Candidates ({r.candidates.length})</h3>
          <div className="scroll"><table className="t"><thead><tr><th>source_id</th><th className="num">M² (actions)</th><th className="num">chem p</th><th className="num">sep [pc]</th><th className="num">Δv</th></tr></thead>
            <tbody>{r.candidates.slice(0, 60).map((c: any) => <tr key={c.source_id}><td className="mono">{c.source_id}</td><td className="num">{fmt(c.mahalanobis2_actions, 2)}</td><td className="num">{fmt(c.chem_p, 3)}</td><td className="num">{fmt(c.separation_pc, 0)}</td><td className="num">{fmt(c.dv_kms, 1)}</td></tr>)}</tbody></table></div>
          <ul className="caveats">{r.caveats.map((c: string) => <li key={c}>{c}</li>)}</ul>
        </div>
      </>}
    </div>
  )
}

function Ejection({ d }: { d: any }) {
  const [cl, setCl] = useState<any[]>([])
  const [q, setQ] = useState('')
  const [pick, setPick] = useState('')
  const [lb, setLb] = useState(50)
  const [r, setR] = useState<any>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => {
    getJSON(`/api/clusters?max_dist_pc=2000&q=${encodeURIComponent(q)}`).then((c: any[]) => {
      const X = d.derived.X_pc, Y = d.derived.Y_pc, Z = d.derived.Z_pc
      c.forEach(k => k.sep = Math.hypot(k.X - X, k.Y - Y, k.Z - Z))
      setCl(c.sort((a, b) => a.sep - b.sep).slice(0, 60))
    })
  }, [q, d])
  const go = async () => {
    setBusy(true); setErr('')
    try { setR(await postJSON('/api/encounter', { source_id: d.source_id, cluster: pick, lookback_myr: lb })) } catch (e) { setErr(String(e)) } finally { setBusy(false) }
  }
  return (
    <div className="grid">
      <div className="card">
        <h3><span className="tag hypo">hypothesis</span> Was this star ejected from a cluster?</h3>
        <p className="small dim">Traces the star and a known cluster (Hunt & Reffert 2023, with mean Gaia RV) back in time with Monte Carlo errors and records the closest approach. A control sample of field stars estimates how often chance fly-bys look as convincing.</p>
        <div className="row"><input type="text" placeholder="filter clusters by name" value={q} onChange={e => setQ(e.target.value)} />
          <label className="f">Look-back [Myr]<input type="number" value={lb} min={1} max={300} onChange={e => setLb(Number(e.target.value))} /></label></div>
        <div className="scroll" style={{ maxHeight: 200, marginTop: 8 }}><table className="t"><thead><tr><th>Cluster</th><th className="num">now [pc]</th><th className="num">age [Myr]</th></tr></thead>
          <tbody>{cl.map(c => <tr key={c.name} className={`click ${pick === c.name ? 'sel' : ''}`} onClick={() => setPick(c.name)}><td>{c.name}</td><td className="num">{fmt(c.sep, 0)}</td><td className="num">{fmt(c.age_myr, 0)}</td></tr>)}</tbody></table></div>
        <div className="row" style={{ marginTop: 8 }}><button className="btn" disabled={!pick || busy} onClick={go}>{busy ? 'Integrating…' : `Test encounter with ${pick || '…'}`}</button></div>
        {err && <div className="err">{err}</div>}
      </div>
      {r && <div className="card">
        <h3>Result</h3>
        <div className="note info">{r.interpretation}</div>
        <Plot height={220} data={[{ x: r.d_min_samples, type: 'histogram', nbinsx: 40, marker: { color: '#7aa2ff' }, name: 'closest approach' } as any]}
          layout={{ xaxis: { title: { text: 'closest approach [pc]' } }, yaxis: { title: { text: 'MC realisations' } },
            shapes: [{ type: 'line', x0: r.radius_pc, x1: r.radius_pc, y0: 0, y1: 1, yref: 'paper', line: { color: '#ffcf6e', dash: 'dash' } }] }} />
        <dl className="kv"><dt>Radius used</dt><dd>{fmt(r.radius_pc, 0)} pc (2 × tidal radius, ≥10 pc)</dd>
          <dt>Control mean</dt><dd>{r.control.mean_fraction_within_radius === null ? '–' : `${(100 * r.control.mean_fraction_within_radius).toFixed(0)}% of realisations (n=${r.control.n})`}</dd></dl>
        <ul className="caveats">{r.caveats.map((c: string) => <li key={c}>{c}</li>)}</ul>
        <button className="btn ghost small" onClick={async () => download(`ejection_${d.source_id}.md`, await postJSON('/api/report', { kind: 'encounter', result: r }))}>export report</button>
      </div>}
    </div>
  )
}

function Origin({ d }: { d: any }) {
  const m = d.merger_test, a = d.anomaly
  return (
    <div className="grid">
      <div className="card">
        <h3><span className="tag hypo">hypothesis</span> Accreted (Gaia–Enceladus) origin?</h3>
        <table className="t"><tbody>
          <tr><td>Dynamics (action space)</td><td>{m.gse_kinematic ? <span className="tag good">consistent</span> : <span className="tag neutral">not selected</span>}</td><td className="muted">L_z {fmt(m.Lz, 0)}, √J_R {fmt(m.sqrt_JR, 1)}</td></tr>
          <tr><td>Chemistry</td><td>{!m.chem_measured ? <span className="tag neutral">not measured</span> : m.accreted_chemistry ? <span className="tag good">accreted-like</span> : <span className="tag neutral">in-situ-like</span>}</td><td className="muted">[Al/Fe] {fmt(m.Al_Fe, 2)}, [Mg/Mn] {fmt(m.Mg_Mn, 2)}, [Fe/H] {fmt(m.Fe_H, 2)}</td></tr>
        </tbody></table>
        <p className="small muted">{m.criteria.kinematic}. {m.criteria.chemical}. The two criteria are independent; agreement strengthens the case, disagreement is informative.</p>
      </div>
      <div className="card">
        <h3>How unusual is this star?</h3>
        <h4>Orbit compared with chemically similar stars</h4>
        <p className="small muted">{a.reference.kinematic}</p>
        <table className="t"><thead><tr><th>quantity</th><th className="num">value</th><th className="num">reference</th><th className="num">z</th></tr></thead>
          <tbody>{a.kinematics_vs_chemical_twins.map((k: any) => <tr key={k.quantity}><td>{k.quantity}</td><td className="num">{fmt(k.value, 2)}</td><td className="num">{fmt(k.reference_median, 2)} ± {fmt(k.reference_spread, 2)}</td><td className="num" style={{ color: Math.abs(k.z) > 4 ? 'var(--bad)' : undefined }}>{fmt(k.z, 1)}</td></tr>)}</tbody></table>
        <h4>Chemistry compared with stars on similar orbits</h4>
        <table className="t"><thead><tr><th>element</th><th className="num">value</th><th className="num">reference</th><th className="num">z</th></tr></thead>
          <tbody>{a.chemistry_vs_orbital_twins.map((k: any) => <tr key={k.element}><td>{k.element}</td><td className="num">{fmt(k.value, 3)}</td><td className="num">{fmt(k.reference_median, 3)} ± {fmt(k.reference_spread, 3)}</td><td className="num" style={{ color: Math.abs(k.z) > 4 ? 'var(--bad)' : undefined }}>{fmt(k.z, 1)}</td></tr>)}</tbody></table>
        {a.follow_up.length > 0 && <><h4>Suggested follow-up</h4><ul className="caveats">{a.follow_up.map((s: string) => <li key={s}>{s}</li>)}</ul></>}
      </div>
    </div>
  )
}
