'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, BarChart3, Building2, Calculator, CircleDollarSign, Database, Languages,
  LayoutDashboard, Map, MapPin, Menu, Plus, RefreshCw, Search, Sparkles, Trash2, X
} from 'lucide-react';

export type PropertyIntelligenceView = 'intelligence' | 'analysis' | 'comparables' | 'nearby' | 'score' | 'map';
type Row = Record<string, unknown> & { id: string };
type PropertyOption = { id: string; source: string; name: string; address: string; propertyType: string; status: string };
type Language = 'en' | 'zh';

const navigation: Array<{ view: PropertyIntelligenceView; href: string; label: string; zh: string; icon: typeof Map }> = [
  { view: 'intelligence', href: '/property-intelligence', label: 'Intelligence', zh: '物业智能', icon: LayoutDashboard },
  { view: 'analysis', href: '/property-analysis', label: 'AI Analysis', zh: 'AI 分析', icon: Sparkles },
  { view: 'comparables', href: '/property-comparables', label: 'Comparables', zh: '可比物业', icon: Database },
  { view: 'nearby', href: '/property-nearby', label: 'Nearby Places', zh: '周边设施', icon: MapPin },
  { view: 'score', href: '/property-score', label: 'Property Score', zh: '物业评分', icon: BarChart3 },
  { view: 'map', href: '/property-map', label: 'Map', zh: '地图', icon: Map }
];

export default function PropertyIntelligenceWorkspace({ view }: { view: PropertyIntelligenceView }) {
  const [analyses, setAnalyses] = useState<Row[]>([]);
  const [properties, setProperties] = useState<PropertyOption[]>([]);
  const [comparables, setComparables] = useState<Row[]>([]);
  const [nearby, setNearby] = useState<Row[]>([]);
  const [scores, setScores] = useState<Row[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [language, setLanguage] = useState<Language>('en');
  const [menuOpen, setMenuOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [createOpen, setCreateOpen] = useState(false);

  const selected = analyses.find((row) => row.id === selectedId) ?? analyses[0] ?? null;
  const score = scores.find((row) => row.analysis_id === selected?.id) ?? null;

  const loadBase = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [analysisResult, propertyResult] = await Promise.all([api('/api/property-intelligence/analyses'), api('/api/property-intelligence/properties')]);
      const nextAnalyses = analysisResult.rows ?? [];
      setAnalyses(nextAnalyses);
      setProperties(propertyResult.properties ?? []);
      setSelectedId((current) => current && nextAnalyses.some((row: Row) => row.id === current) ? current : nextAnalyses[0]?.id ?? '');
    } catch (cause) { setError(message(cause)); }
    finally { setLoading(false); }
  }, []);

  const loadEvidence = useCallback(async (analysisId: string) => {
    if (!analysisId) { setComparables([]); setNearby([]); setScores([]); return; }
    try {
      const [comparableResult, nearbyResult, scoreResult] = await Promise.all([
        api(`/api/property-intelligence/comparables?analysis_id=${analysisId}`),
        api(`/api/property-intelligence/nearby?analysis_id=${analysisId}`),
        api(`/api/property-intelligence/scores?analysis_id=${analysisId}`)
      ]);
      setComparables(comparableResult.rows ?? []); setNearby(nearbyResult.rows ?? []); setScores(scoreResult.rows ?? []);
    } catch (cause) { setError(message(cause)); }
  }, []);

  useEffect(() => { void loadBase(); }, [loadBase]);
  useEffect(() => { void loadEvidence(selected?.id ?? ''); }, [selected?.id, loadEvidence]);

  async function createAnalysis(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); const sourceValue = String(form.get('property'));
    const property = properties.find((item) => `${item.source}:${item.id}` === sourceValue);
    if (!property) return;
    setBusy(true); setError('');
    try {
      const payload = property.source === 'residential_tenancy' ? { tenancy_id: property.id } : { commercial_listing_id: property.id };
      const result = await api('/api/property-intelligence/analyses', { method: 'POST', body: JSON.stringify(payload) });
      setCreateOpen(false); setNotice('Property analysis workspace created.'); await loadBase(); setSelectedId(result.record.id);
    } catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  }

  async function updateAnalysis(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selected) return; setBusy(true); setError('');
    const form = new FormData(event.currentTarget); const payload: Record<string, unknown> = { id: selected.id };
    for (const key of ['latitude','longitude','built_up_sqft','purchase_price','down_payment','estimated_market_value','estimated_monthly_rental','monthly_operating_cost','monthly_financing_cost','occupancy_rate','annual_capital_growth_rate']) payload[key] = nullableNumber(form.get(key));
    try { await api('/api/property-intelligence/analyses', { method: 'PATCH', body: JSON.stringify(payload) }); setNotice('Analysis assumptions saved.'); await loadBase(); }
    catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  }

  async function runAnalysis() {
    if (!selected) return; setBusy(true); setError(''); setNotice('');
    try { const result = await api('/api/property-intelligence/analyze', { method: 'POST', body: JSON.stringify({ analysisId: selected.id }) }); setNotice(result.aiStatus === 'generated' ? 'AI analysis generated and saved.' : 'Evidence-based analysis generated and saved.'); await loadBase(); await loadEvidence(selected.id); }
    catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  }

  async function createEvidence(event: FormEvent<HTMLFormElement>, resource: 'comparables' | 'nearby') {
    event.preventDefault(); if (!selected) return; setBusy(true); setError('');
    const form = new FormData(event.currentTarget); const payload = Object.fromEntries(form.entries()) as Record<string, unknown>;
    payload.analysis_id = selected.id;
    for (const key of ['price','rental','built_up_sqft','latitude','longitude','travel_time_minutes']) if (key in payload) payload[key] = nullableNumber(payload[key]);
    try { await api(`/api/property-intelligence/${resource}`, { method: 'POST', body: JSON.stringify(payload) }); event.currentTarget.reset(); setNotice(resource === 'comparables' ? 'Comparable added.' : 'Nearby place added.'); await loadEvidence(selected.id); }
    catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  }

  async function removeEvidence(resource: 'comparables' | 'nearby', id: string) {
    if (!confirm('Remove this evidence record?')) return; setBusy(true);
    try { await api(`/api/property-intelligence/${resource}`, { method: 'DELETE', body: JSON.stringify({ id }) }); await loadEvidence(selected?.id ?? ''); }
    catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  }

  return <div className="pi-app">
    <aside className={`pi-sidebar ${menuOpen ? 'open' : ''}`}>
      <div className="pi-brand"><span>NX</span><div><strong>Nexora AI</strong><small>Property Intelligence</small></div><button className="pi-close" onClick={() => setMenuOpen(false)} aria-label="Close navigation"><X size={18}/></button></div>
      <nav>{navigation.map((item) => <Link key={item.view} href={item.href} className={item.view === view ? 'active' : ''} onClick={() => setMenuOpen(false)}><item.icon size={17}/><span>{item.label}<small>{item.zh}</small></span></Link>)}</nav>
      <Link className="pi-back" href="/commercial"><ArrowLeft size={16}/> Commercial CRM</Link>
    </aside>
    <main className="pi-main">
      <header className="pi-header">
        <button className="pi-menu" onClick={() => setMenuOpen(true)} aria-label="Open navigation"><Menu size={19}/></button>
        <div className="pi-search"><Search size={17}/><select value={selected?.id ?? ''} onChange={(event) => setSelectedId(event.target.value)} aria-label="Selected property analysis"><option value="">Select a property analysis</option>{analyses.map((row) => <option key={row.id} value={row.id}>{String(row.property_name)}</option>)}</select></div>
        <button className="pi-icon-button" onClick={() => setLanguage(language === 'en' ? 'zh' : 'en')} title="Switch analysis language"><Languages size={17}/><span>{language.toUpperCase()}</span></button>
        <button className="pi-icon-button" onClick={() => void loadBase()} title="Refresh"><RefreshCw size={17}/></button>
      </header>

      <div className="pi-title"><div><p>SPRINT 007 / PROPERTY INTELLIGENCE</p><h1>{navigation.find((item) => item.view === view)?.label}</h1></div><button className="pi-primary" onClick={() => setCreateOpen(true)}><Plus size={17}/> New analysis</button></div>
      {notice && <div className="pi-notice" role="status">{notice}</div>}
      {error && <div className="pi-error" role="alert">{error}</div>}
      {loading ? <Loading/> : !selected ? <Empty properties={properties.length} open={() => setCreateOpen(true)}/> : <>
        <PropertyStrip analysis={selected} score={score}/>
        {view === 'intelligence' && <Overview analysis={selected} score={score} comparables={comparables} nearby={nearby} language={language} run={runAnalysis} busy={busy}/>} 
        {view === 'analysis' && <Analysis analysis={selected} language={language} save={updateAnalysis} run={runAnalysis} busy={busy}/>} 
        {view === 'comparables' && <Comparables rows={comparables} submit={(event) => createEvidence(event, 'comparables')} remove={(id) => removeEvidence('comparables', id)} busy={busy}/>} 
        {view === 'nearby' && <Nearby rows={nearby} submit={(event) => createEvidence(event, 'nearby')} remove={(id) => removeEvidence('nearby', id)} busy={busy}/>} 
        {view === 'score' && <Score score={score} run={runAnalysis} busy={busy}/>} 
        {view === 'map' && <PropertyMap analysis={selected} nearby={nearby}/>} 
      </>}
    </main>
    {createOpen && <div className="pi-modal" role="dialog" aria-modal="true" aria-labelledby="create-analysis-title"><form onSubmit={createAnalysis}><header><div><p>REAL PROPERTY SOURCE</p><h2 id="create-analysis-title">Create analysis</h2></div><button type="button" onClick={() => setCreateOpen(false)} aria-label="Close"><X/></button></header><label><span>Residential tenancy or commercial listing</span><select name="property" required defaultValue=""><option value="" disabled>Select an existing property</option>{properties.map((item) => <option key={`${item.source}:${item.id}`} value={`${item.source}:${item.id}`}>{item.name} · {item.source === 'commercial_listing' ? 'Commercial' : 'Residential'}</option>)}</select></label>{properties.length === 0 && <p className="pi-form-help">Create a tenancy or commercial listing first. No demo records are generated.</p>}<footer><button type="button" className="pi-secondary" onClick={() => setCreateOpen(false)}>Cancel</button><button className="pi-primary" disabled={busy || !properties.length}>Create workspace</button></footer></form></div>}
  </div>;
}

function PropertyStrip({ analysis, score }: { analysis: Row; score: Row | null }) {
  return <section className="pi-property-strip"><div><Building2/><span>{String(analysis.property_source).replaceAll('_',' ')}</span><strong>{String(analysis.property_name)}</strong><small>{String(analysis.property_address || 'Address not supplied')}</small></div><Metric label="Investment score" value={score ? `${score.overall_score}/100` : 'Not scored'}/><Metric label="Market value" value={money(analysis.estimated_market_value)}/><Metric label="Monthly rental" value={money(analysis.estimated_monthly_rental)}/><Metric label="Rental yield" value={percent(analysis.rental_yield)}/></section>;
}

function Overview({ analysis, score, comparables, nearby, language, run, busy }: { analysis: Row; score: Row | null; comparables: Row[]; nearby: Row[]; language: Language; run: () => void; busy: boolean }) {
  const summary = String(analysis[`summary_${language}`] ?? '');
  return <div className="pi-overview">
    <section className="pi-panel pi-narrative"><header><div><p>AI PROPERTY SUMMARY</p><h2>{language === 'en' ? 'Investment view' : '投资观点'}</h2></div><button className="pi-primary" onClick={run} disabled={busy}><Sparkles size={16}/>{busy ? 'Analyzing...' : 'Generate analysis'}</button></header>{summary ? <><p className="pi-lead">{summary}</p><div className="pi-bilingual-grid"><Narrative title="Marketing description" value={analysis[`marketing_description_${language}`]}/><Narrative title="Investment opinion" value={analysis[`investment_opinion_${language}`]}/><Narrative title="Suitable tenant" value={analysis[`suitable_tenant_profile_${language}`]}/><Narrative title="Suitable buyer" value={analysis[`suitable_buyer_profile_${language}`]}/></div></> : <PanelEmpty text="Run the analysis after adding source-backed comparable and nearby-place evidence."/>}</section>
    <aside className="pi-panel"><header><div><p>EVIDENCE</p><h2>Coverage</h2></div></header><div className="pi-evidence-stats"><Metric label="Comparables" value={String(comparables.length)}/><Metric label="Nearby places" value={String(nearby.length)}/><Metric label="Data completeness" value={score ? percent(score.data_completeness) : '-'}/><Metric label="Cashflow / month" value={money(analysis.monthly_cashflow)}/><Metric label="Annual ROI" value={percent(analysis.annual_roi)}/></div>{array(analysis.warnings).map((warning) => <p className="pi-warning" key={warning}>{warning}</p>)}</aside>
  </div>;
}

function Analysis({ analysis, language, save, run, busy }: { analysis: Row; language: Language; save: (event: FormEvent<HTMLFormElement>) => void; run: () => void; busy: boolean }) {
  return <div className="pi-analysis-grid"><form className="pi-panel pi-assumptions" onSubmit={save}><header><div><p>ANALYSIS INPUTS</p><h2>Property facts & assumptions</h2></div><button className="pi-primary" disabled={busy}>Save</button></header><div className="pi-form-grid">{[
    ['latitude','Latitude'],['longitude','Longitude'],['built_up_sqft','Built-up (sq ft)'],['purchase_price','Purchase price'],['down_payment','Cash invested / down payment'],['estimated_market_value','Market value override'],['estimated_monthly_rental','Monthly rental override'],['monthly_operating_cost','Monthly operating cost'],['monthly_financing_cost','Monthly financing cost'],['occupancy_rate','Occupancy rate (%)'],['annual_capital_growth_rate','Annual capital growth (%)']
  ].map(([name, label]) => <label key={name}><span>{label}</span><input name={name} type="number" step="any" defaultValue={String(analysis[name] ?? '')}/></label>)}</div></form><section className="pi-panel pi-narrative"><header><div><p>{language === 'en' ? 'BILINGUAL ANALYSIS' : '双语分析'}</p><h2>{language === 'en' ? 'Strengths, risks & suitability' : '优势、风险与适合度'}</h2></div><button className="pi-secondary" onClick={run} disabled={busy}><Calculator size={16}/> Recalculate</button></header><Narrative title="Strengths" value={array(analysis[`strengths_${language}`]).join(' · ')}/><Narrative title="Weaknesses" value={array(analysis[`weaknesses_${language}`]).join(' · ')}/><Narrative title="Commercial suitability" value={analysis[`commercial_suitability_${language}`]}/><div className="pi-method"><span>Market value method</span><strong>{String(analysis.market_value_method)}</strong><span>Rental method</span><strong>{String(analysis.rental_method)}</strong></div></section></div>;
}

function Comparables({ rows, submit, remove, busy }: { rows: Row[]; submit: (event: FormEvent<HTMLFormElement>) => void; remove: (id: string) => void; busy: boolean }) {
  return <div className="pi-data-layout"><form className="pi-panel pi-entry-form" onSubmit={submit}><header><div><p>SOURCE-ATTRIBUTED</p><h2>Add comparable</h2></div></header><label><span>Type</span><select name="comparable_type"><option value="sale">Sale</option><option value="rental">Rental</option></select></label><label><span>Property name</span><input name="property_name" required/></label><label><span>Price</span><input name="price" type="number" min="0" step=".01"/></label><label><span>Monthly rental</span><input name="rental" type="number" min="0" step=".01"/></label><label><span>Built-up (sq ft)</span><input name="built_up_sqft" type="number" min="0" step=".01"/></label><label><span>Transaction date</span><input name="transaction_date" type="date"/></label><label><span>Source name</span><input name="source_name" required placeholder="Registry, portal or valuer"/></label><label><span>Source reference</span><input name="source_reference"/></label><button className="pi-primary" disabled={busy}><Plus size={16}/> Add comparable</button></form><section className="pi-panel pi-table-panel"><header><div><p>COMPARABLE SALES & RENTALS</p><h2>{rows.length} evidence record{rows.length === 1 ? '' : 's'}</h2></div></header>{rows.length ? <div className="pi-table-wrap"><table><thead><tr><th>Property</th><th>Type</th><th>Price / rental</th><th>PSF</th><th>Distance</th><th>Source</th><th></th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><strong>{String(row.property_name)}</strong><small>{String(row.transaction_date ?? 'Date not supplied')}</small></td><td>{String(row.comparable_type)}</td><td>{money(row.comparable_type === 'sale' ? row.price : row.rental)}</td><td>{row.psf ? money(row.psf) : '-'}</td><td>{row.distance_km ? `${row.distance_km} km` : '-'}</td><td>{String(row.source_name)}</td><td><button onClick={() => remove(row.id)} title="Delete comparable"><Trash2 size={15}/></button></td></tr>)}</tbody></table></div> : <PanelEmpty text="Add verified sale or rental evidence. Nexora will not create synthetic comparables."/>}</section></div>;
}

function Nearby({ rows, submit, remove, busy }: { rows: Row[]; submit: (event: FormEvent<HTMLFormElement>) => void; remove: (id: string) => void; busy: boolean }) {
  return <div className="pi-data-layout"><form className="pi-panel pi-entry-form" onSubmit={submit}><header><div><p>GEO EVIDENCE</p><h2>Add nearby place</h2></div></header><label><span>Category</span><select name="category">{['public_transport','school','hospital','shopping_mall','restaurant','petrol_station','other'].map((value) => <option key={value} value={value}>{value.replaceAll('_',' ')}</option>)}</select></label><label><span>Name</span><input name="name" required/></label><label><span>Latitude</span><input name="latitude" type="number" min="-90" max="90" step="any" required/></label><label><span>Longitude</span><input name="longitude" type="number" min="-180" max="180" step="any" required/></label><label><span>Travel mode</span><select name="travel_mode"><option>driving</option><option>walking</option><option>transit</option><option>cycling</option></select></label><label><span>Travel time (minutes)</span><input name="travel_time_minutes" type="number" min="0"/></label><label><span>Source name</span><input name="source_name" required placeholder="Map provider or authority"/></label><label><span>Source reference</span><input name="source_reference"/></label><button className="pi-primary" disabled={busy}><Plus size={16}/> Add place</button></form><section className="pi-panel"><header><div><p>NEARBY PLACES</p><h2>{rows.length} mapped place{rows.length === 1 ? '' : 's'}</h2></div></header>{rows.length ? <div className="pi-place-grid">{rows.map((row) => <article key={row.id}><MapPin size={18}/><div><strong>{String(row.name)}</strong><small>{String(row.category).replaceAll('_',' ')} · {row.distance_km ? `${row.distance_km} km` : 'distance pending'} · {row.travel_time_minutes ? `${row.travel_time_minutes} min` : 'travel time pending'}</small><span>Source: {String(row.source_name)}</span></div><button onClick={() => remove(row.id)} title="Delete nearby place"><Trash2 size={15}/></button></article>)}</div> : <PanelEmpty text="Add source-attributed amenities, transport, schools, hospitals, malls, restaurants and petrol stations."/>}</section></div>;
}

function Score({ score, run, busy }: { score: Row | null; run: () => void; busy: boolean }) {
  if (!score) return <section className="pi-panel"><PanelEmpty text="Generate an analysis to calculate the first evidence-based property score." action={<button className="pi-primary" onClick={run} disabled={busy}>Generate score</button>}/></section>;
  const fields = [['location_score','Location'],['accessibility_score','Accessibility'],['amenities_score','Amenities'],['rental_demand_score','Rental demand'],['capital_growth_score','Capital growth'],['commercial_potential_score','Commercial potential']];
  const rationale = (score.rationale ?? {}) as Record<string, string>;
  return <section className="pi-panel pi-score-panel"><header><div><p>PROPERTY SCORE / {String(score.score_version)}</p><h2>Overall {String(score.overall_score)}/100</h2></div><button className="pi-secondary" onClick={run} disabled={busy}><RefreshCw size={16}/> Recalculate</button></header><div className="pi-score-hero"><strong>{String(score.overall_score)}</strong><span>Data completeness {String(score.data_completeness)}%</span></div><div className="pi-score-list">{fields.map(([field, label]) => { const key = field.replace('_score',''); return <article key={field}><div><strong>{label}</strong><span>{String(score[field])}/100</span></div><div className="pi-score-track"><i style={{ width: `${score[field]}%` }}/></div><p>{rationale[key] ?? 'Evidence-based component score.'}</p></article>; })}</div></section>;
}

function PropertyMap({ analysis, nearby }: { analysis: Row; nearby: Row[] }) {
  const points = [{ id: 'property', name: String(analysis.property_name), category: 'property', latitude: Number(analysis.latitude), longitude: Number(analysis.longitude) }, ...nearby.map((row) => ({ id: row.id, name: String(row.name), category: String(row.category), latitude: Number(row.latitude), longitude: Number(row.longitude) }))].filter((point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude));
  const bounds = mapBounds(points);
  const hasPropertyCoordinates = analysis.latitude !== null && analysis.latitude !== undefined && analysis.longitude !== null && analysis.longitude !== undefined;
  return <section className="pi-panel pi-map-panel"><header><div><p>MAP INTEGRATION READY</p><h2>Coordinates & nearby places</h2></div><a className="pi-secondary" href={hasPropertyCoordinates ? `https://www.openstreetmap.org/?mlat=${analysis.latitude}&mlon=${analysis.longitude}#map=16/${analysis.latitude}/${analysis.longitude}` : '#'} target="_blank" rel="noreferrer">Open map</a></header>{points.length ? <><div className="pi-map-canvas" aria-label="Property coordinate map">{points.map((point) => <button key={point.id} className={point.id === 'property' ? 'property' : ''} style={mapPosition(point, bounds)} title={`${point.name} · ${point.latitude}, ${point.longitude}`}><MapPin size={point.id === 'property' ? 25 : 18}/><span>{point.name}</span></button>)}</div><div className="pi-coordinate-list">{points.map((point) => <div key={point.id}><strong>{point.name}</strong><span>{point.latitude.toFixed(6)}, {point.longitude.toFixed(6)}</span><small>{point.category.replaceAll('_',' ')}</small></div>)}</div></> : <PanelEmpty text="Add property coordinates and nearby places to activate the map workspace."/>}</section>;
}

function Loading() { return <div className="pi-loading" aria-label="Loading"><div/><div/><div/></div>; }
function Empty({ properties, open }: { properties: number; open: () => void }) { return <div className="pi-empty"><Building2 size={30}/><h2>No property analysis yet</h2><p>{properties ? 'Connect a real tenancy or commercial listing to begin.' : 'Create a tenancy or commercial listing first. No sample production records are used.'}</p><button className="pi-primary" onClick={open} disabled={!properties}>Create analysis</button></div>; }
function PanelEmpty({ text, action }: { text: string; action?: React.ReactNode }) { return <div className="pi-panel-empty"><Database size={24}/><p>{text}</p>{action}</div>; }
function Metric({ label, value }: { label: string; value: string }) { return <div className="pi-metric"><span>{label}</span><strong>{value}</strong></div>; }
function Narrative({ title, value }: { title: string; value: unknown }) { return <div className="pi-narrative-item"><span>{title}</span><p>{String(value || 'Not generated yet.')}</p></div>; }

async function api(url: string, init?: RequestInit) { const response = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } }); const data = await response.json(); if (!response.ok || !data.success) throw new Error(data.error || 'request-failed'); return data; }
function message(error: unknown) { const code = error instanceof Error ? error.message : 'request-failed'; return ({ 'tables-missing': 'Sprint 007 database migration has not been applied.', 'database-unavailable': 'The database is unavailable.', 'duplicate-record': 'An analysis or source reference already exists.', 'permission-denied': 'You do not have permission for this action.', 'property-source-not-found': 'The source property is unavailable or restricted.' } as Record<string,string>)[code] ?? 'The property intelligence request could not be completed.'; }
function nullableNumber(value: FormDataEntryValue | unknown) { if (value === '' || value === null || value === undefined) return null; const number = Number(value); return Number.isFinite(number) ? number : null; }
function money(value: unknown) { if (value === null || value === undefined || value === '') return '-'; return new Intl.NumberFormat('en-MY', { style: 'currency', currency: 'MYR', maximumFractionDigits: 0 }).format(Number(value)); }
function percent(value: unknown) { return value === null || value === undefined || value === '' ? '-' : `${Number(value).toFixed(1)}%`; }
function array(value: unknown) { return Array.isArray(value) ? value.map(String) : []; }
function mapBounds(points: Array<{ latitude: number; longitude: number }>) { const latitudes = points.map((p) => p.latitude), longitudes = points.map((p) => p.longitude); return { minLat: Math.min(...latitudes), maxLat: Math.max(...latitudes), minLng: Math.min(...longitudes), maxLng: Math.max(...longitudes) }; }
function mapPosition(point: { latitude: number; longitude: number }, bounds: ReturnType<typeof mapBounds>) { const latSpan = bounds.maxLat - bounds.minLat || .01, lngSpan = bounds.maxLng - bounds.minLng || .01; return { left: `${8 + (point.longitude - bounds.minLng) / lngSpan * 84}%`, top: `${8 + (bounds.maxLat - point.latitude) / latSpan * 84}%` }; }
