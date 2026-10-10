import { useApp } from '../store'
import { fmt } from '../api'

export default function Methods() {
  const { meta } = useApp()
  if (!meta) return <div className="page"><span className="spinner" /></div>
  const off = meta.galah_offsets?.offsets || {}
  return (
    <div className="page">
      <h2>Data, methods & limitations</h2>
      <p className="lede">Everything shown in Palimpsest is computed from public survey data with documented assumptions. Nothing is simulated for visual effect; no language model is involved in any calculation.</p>
      <div className="grid g2">
        <div className="card">
          <h3>Data</h3>
          <dl className="kv">
            {Object.entries(meta.provenance.data).map(([k, v]) => <><dt key={k}>{k.replace(/_/g, ' ')}</dt><dd>{String(v)}</dd></>)}
            <dt>Analysis sample</dt><dd>{meta.n_stars.toLocaleString()} stars ({meta.n_giants.toLocaleString()} giants); median distance {fmt(meta.distance_pc_percentiles[1], 0)} pc (5–95%: {fmt(meta.distance_pc_percentiles[0], 0)}–{fmt(meta.distance_pc_percentiles[2], 0)} pc)</dd>
            <dt>GALAH DR4 overlap</dt><dd>{meta.n_galah_matched.toLocaleString()} stars</dd>
          </dl>
          <h4>Sample selection</h4>
          <pre className="mono small" style={{ whiteSpace: 'pre-wrap', color: 'var(--text-2)' }}>{JSON.stringify(meta.selection, null, 1)}</pre>
        </div>
        <div className="card">
          <h3>Physical model</h3>
          <ul className="caveats">
            <li>Distances: 1/ϖ after the Lindegren et al. (2021) parallax zero-point; only stars with ϖ/σ &gt; 5 are used (10 for discovery by default), where the inversion bias is small.</li>
            <li>Velocities: Gaia DR3 proper motions + APOGEE radial velocities (0.1 km/s systematic floor added). Solar motion (U,V,W) = ({meta.provenance.solar_motion_UVW_kms.join(', ')}) km/s (Schönrich et al. 2010); z☉ = {meta.provenance.solar_height_kpc * 1000} pc.</li>
            <li>Potentials: {Object.values(meta.potentials).map((p: any) => `${p.label} — ${p.description}`).join(' / ')} Each uses its own R☉ and v_c normalisation.</li>
            <li>Orbits: galpy DOP853 integration; Monte Carlo over the full Gaia (ϖ, μα*, μδ) covariance and RV error. Actions: Stäckel fudge (δ = 0.4 kpc).</li>
            <li>Default look-back {meta.default_lookback_myr} Myr, maximum {meta.max_lookback_myr} Myr.</li>
          </ul>
          <h3 style={{ marginTop: 12 }}>Chemistry</h3>
          <ul className="caveats">
            <li>Elements: {meta.elements.map((e: any) => e.label).join(', ')} (ASPCAP; per-element flags applied). C and N excluded (altered by stellar evolution in giants).</li>
            <li>Systematic floor per element, calibrated on held-out open clusters: {Object.entries(meta.floor).map(([k, v]: any) => `${k.replace('_FE', '').replace('_H', '')} ${v.toFixed(3)}`).join(', ')} dex.</li>
            <li>Group test: analytic Bayesian evidence ratio, one shared abundance vector (drawn from the field distribution) vs independent field draws; field = Gaussian mixture of matched reference stars; always shown against an empirical null from random field groups.</li>
          </ul>
        </div>
      </div>
      <div className="grid g2" style={{ marginTop: 14 }}>
        <div className="card">
          <h3>APOGEE vs GALAH: survey calibration differences</h3>
          <p className="small muted">Measured on stars observed by both surveys. These offsets are reported, not applied — the two scales are kept separate and GALAH is used only as an independent check.</p>
          <table className="t"><thead><tr><th>Element</th><th className="num">N</th><th className="num">median APOGEE − GALAH</th><th className="num">robust scatter</th></tr></thead>
            <tbody>{Object.entries(off).map(([k, v]: any) => <tr key={k}><td>{k}</td><td className="num">{v.n.toLocaleString()}</td><td className="num">{fmt(v.median_apogee_minus_galah, 3)}</td><td className="num">{fmt(v.robust_scatter, 3)}</td></tr>)}</tbody></table>
        </div>
        <div className="card">
          <h3>Known limitations</h3>
          <ul className="caveats">
            <li>The potential is static and axisymmetric: no bar, spiral arms, giant molecular clouds or Sagittarius. Individual traceback is meaningful over tens of Myr, not Gyr.</li>
            <li>Radial migration changes angular momentum over Gyr, so action-space matching of old stars constrains only recent shared history.</li>
            <li>APOGEE's selection function is complex and targeted known clusters; group statistics inherit that selection.</li>
            <li>ASPCAP abundances have Teff/log g-dependent systematics; dwarfs and giants in one cluster can differ by ~0.05–0.1 dex.</li>
            <li>astroNN ages are data-driven estimates (~30% uncertainty) valid for red giants only.</li>
            <li>Binary stars bias RVs; APOGEE multi-epoch scatter is used to flag them, but single-visit stars cannot be checked.</li>
            <li>Constellation-star RVs, metallicities and ages are heterogeneous literature compilations (XHIP).</li>
            <li>Supernova, magnetic-field and cosmic-ray modules are not implemented: they would require gas, pulsar rotation-measure and high-energy data and models that could not be validated in this build.</li>
          </ul>
        </div>
      </div>
      <div className="card" style={{ marginTop: 14 }}>
        <h3>Reproducibility</h3>
        <p className="small dim">Every result exported from the app (Markdown report, CSV of members, full JSON) carries a provenance block: data releases, selection cuts, solar parameters, potential, Monte Carlo sample counts, random seeds and a parameter hash. The cached dataset is rebuilt with <code className="mono">python scripts/build_dataset.py</code>.</p>
      </div>
    </div>
  )
}
