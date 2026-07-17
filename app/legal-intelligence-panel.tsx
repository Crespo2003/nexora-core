'use client';

import { useEffect, useMemo, useState } from 'react';
import type { TenancyLegalIntelligence } from '../lib/ai/extractTenancy';
import {
  buildLegalIntelligence,
  compareLegalIntelligence,
  searchClauses,
  type AgreementComparison,
  type LegalIntelligenceResult,
  type LegalRiskLevel
} from '../lib/legal-intelligence/core';

type AvailableDocument = {
  id: string;
  filename: string;
  documentType: string;
  executiveSummary: string;
  updatedAt: string;
};

const filters = ['All', 'Financial', 'Renewal', 'Termination', 'Maintenance', 'Utilities', 'Entry', 'Restrictions', 'Other'] as const;

export function LegalIntelligencePanel({ extraction, rawText }: { extraction: TenancyLegalIntelligence; rawText: string }) {
  const analysis = useMemo<LegalIntelligenceResult>(
    () => extraction.legal_intelligence ?? buildLegalIntelligence(extraction, rawText),
    [extraction, rawText]
  );
  const [filter, setFilter] = useState<string>('All');
  const [query, setQuery] = useState('');
  const [documents, setDocuments] = useState<AvailableDocument[]>([]);
  const [documentA, setDocumentA] = useState('');
  const [documentB, setDocumentB] = useState('');
  const [comparison, setComparison] = useState<AgreementComparison | null>(null);
  const [compareState, setCompareState] = useState<'idle' | 'loading' | 'error'>('idle');

  useEffect(() => {
    let active = true;
    fetch('/api/tenancy-legal-intelligence/documents', { cache: 'no-store' })
      .then(async (response) => response.ok ? response.json() as Promise<{ documents?: AvailableDocument[] }> : { documents: [] })
      .then((payload) => {
        if (!active) return;
        setDocuments(Array.isArray(payload.documents) ? payload.documents : []);
      })
      .catch(() => {
        if (active) setDocuments([]);
      });
    return () => { active = false; };
  }, []);

  const visibleClauses = useMemo(() => searchClauses(analysis.clauses, query, filter), [analysis.clauses, filter, query]);
  const riskCounts = useMemo(() => ({
    high: analysis.risks.filter((risk) => risk.severity === 'high').length,
    medium: analysis.risks.filter((risk) => risk.severity === 'medium').length,
    low: analysis.risks.filter((risk) => risk.severity === 'low').length
  }), [analysis.risks]);

  async function compare() {
    if (!documentA || !documentB || documentA === documentB) return;
    setCompareState('loading');
    try {
      const response = await fetch('/api/tenancy-legal-intelligence/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentAId: documentA, documentBId: documentB })
      });
      if (!response.ok) throw new Error('comparison-failed');
      const payload = await response.json() as { comparison?: AgreementComparison };
      setComparison(payload.comparison ?? null);
      setCompareState('idle');
    } catch {
      setComparison(null);
      setCompareState('error');
    }
  }

  return (
    <section className="legal-intelligence" aria-labelledby="legal-intelligence-title">
      <div className="section-title">
        <div>
          <p className="eyebrow">AI legal intelligence</p>
          <h2 id="legal-intelligence-title">Agreement review</h2>
        </div>
        <span className="legal-clause-count">{analysis.clauses.length} clauses analysed</span>
      </div>
      <p className="legal-summary">{analysis.executive_summary || 'Legal intelligence is ready for review. Confirm material terms with the executed agreement and seek advice where required.'}</p>

      <div className="legal-risk-overview" aria-label="Risk overview">
        <RiskBadge level="high" count={riskCounts.high} />
        <RiskBadge level="medium" count={riskCounts.medium} />
        <RiskBadge level="low" count={riskCounts.low} />
      </div>

      <div className="legal-toolbar">
        <label className="legal-search">
          <span className="sr-only">Search clauses</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search clauses, obligations, or risks" />
        </label>
        <div className="legal-filters" aria-label="Filter legal clauses">
          {filters.map((item) => (
            <button key={item} type="button" className={filter === item ? 'active' : ''} onClick={() => setFilter(item)}>{item}</button>
          ))}
        </div>
      </div>

      <div className="legal-clause-list">
        {visibleClauses.map((clause) => (
          <article className="legal-clause-card" key={clause.id}>
            <div className="legal-clause-card-heading">
              <div>
                <span className="legal-category">{clause.category}</span>
                <h3>{clause.title}</h3>
              </div>
              <RiskBadge level={clause.risk_level} />
            </div>
            <p>{clause.summary}</p>
            <dl className="legal-clause-details">
              <div><dt>Responsible party</dt><dd>{clause.responsible_party}</dd></div>
              <div><dt>Confidence</dt><dd>{Math.round(clause.confidence)}%</dd></div>
              {clause.obligation && <div><dt>Obligation</dt><dd>{clause.obligation}</dd></div>}
              {clause.deadline && <div><dt>Deadline</dt><dd>{clause.deadline}</dd></div>}
              {clause.financial_impact && <div><dt>Financial impact</dt><dd>{clause.financial_impact}</dd></div>}
            </dl>
            {clause.source_excerpt && <blockquote>Page {clause.source_page ?? 'not identified'}: {clause.source_excerpt}</blockquote>}
            {clause.recommendation && <p className="legal-recommendation"><strong>Review action:</strong> {clause.recommendation}</p>}
          </article>
        ))}
        {!visibleClauses.length && <p className="legal-empty">No clauses match the current search and filters.</p>}
      </div>

      <div className="legal-comparison">
        <div>
          <p className="eyebrow">Agreement comparison</p>
          <h3>Compare two saved agreements</h3>
          <p>Upload and save each agreement through the existing tenancy import, then select both documents to compare their material terms.</p>
        </div>
        <div className="legal-comparison-controls">
          <label>Agreement A<select value={documentA} onChange={(event) => setDocumentA(event.target.value)}><option value="">Select agreement A</option>{documents.map((document) => <option key={document.id} value={document.id}>{document.filename}</option>)}</select></label>
          <label>Agreement B<select value={documentB} onChange={(event) => setDocumentB(event.target.value)}><option value="">Select agreement B</option>{documents.map((document) => <option key={document.id} value={document.id}>{document.filename}</option>)}</select></label>
          <button type="button" className="secondary-button" onClick={compare} disabled={compareState === 'loading' || !documentA || !documentB || documentA === documentB}>{compareState === 'loading' ? 'Comparing…' : 'Compare agreements'}</button>
        </div>
        {compareState === 'error' && <p className="legal-comparison-error">Comparison could not be completed. Make sure both saved documents belong to this workspace and have legal intelligence data.</p>}
        {comparison && <ComparisonResult comparison={comparison} />}
      </div>
    </section>
  );
}

function RiskBadge({ level, count }: { level: LegalRiskLevel; count?: number }) {
  return <span className={`legal-risk-badge ${level}`}>{count === undefined ? level : `${count} ${level}`}</span>;
}

function ComparisonResult({ comparison }: { comparison: AgreementComparison }) {
  const findings = [
    ...comparison.financial_changes,
    ...comparison.date_changes,
    ...comparison.changed_fields,
    ...comparison.added_clauses,
    ...comparison.removed_clauses,
    ...comparison.modified_clauses,
    ...comparison.risk_changes
  ];
  return (
    <div className="legal-comparison-result">
      <p>{comparison.summary}</p>
      {findings.map((finding) => (
        <article key={finding.id} className="legal-comparison-finding">
          <RiskBadge level={finding.materiality} />
          <div><strong>{finding.title}</strong><span>{finding.category}</span></div>
          <p><em>Agreement A:</em> {finding.before || 'Not present'}<br /><em>Agreement B:</em> {finding.after || 'Not present'}</p>
        </article>
      ))}
      {!findings.length && <p className="legal-empty">No material changes were found.</p>}
    </div>
  );
}
