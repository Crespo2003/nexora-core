'use client';

import { useEffect, useRef, useState } from 'react';

type SearchItem = {
  id: string;
  title: string;
  subtitle: string;
  status: string;
  href: string;
};

type SearchGroup = {
  type: string;
  label: string;
  items: SearchItem[];
};

type SearchPayload = {
  success: boolean;
  groups?: SearchGroup[];
};

export default function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [groups, setGroups] = useState<SearchGroup[]>([]);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(true);
      }
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 40);
    } else {
      setQuery('');
      setGroups([]);
    }
  }, [open]);

  useEffect(() => {
    if (!query.trim()) {
      setGroups([]);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setSearching(true);
      fetch(`/api/search?q=${encodeURIComponent(query)}`)
        .then((r) => r.json())
        .then((p: SearchPayload) => {
          setGroups(p.groups ?? []);
        })
        .catch(() => setGroups([]))
        .finally(() => setSearching(false));
    }, 250);
  }, [query]);

  const hasResults = groups.length > 0;
  const noResults = query.length >= 2 && !searching && !hasResults;

  return (
    <>
      <button className="search-trigger" onClick={() => setOpen(true)} aria-label="Open search (Ctrl+K)">
        <svg className="search-trigger-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="6.5" cy="6.5" r="5" stroke="currentColor" strokeWidth="1.5" />
          <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <span className="search-trigger-label">Search</span>
        <kbd className="search-trigger-kbd">Ctrl K</kbd>
      </button>

      {open && (
        <div className="search-overlay" role="presentation" onClick={() => setOpen(false)}>
          <div
            className="search-modal"
            role="dialog"
            aria-label="Global search"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="search-input-row">
              <svg className="search-input-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <circle cx="6.5" cy="6.5" r="5" stroke="currentColor" strokeWidth="1.5" />
                <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              <input
                ref={inputRef}
                className="search-input"
                type="search"
                autoComplete="off"
                placeholder="Search tenants, properties, documents, leads…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {searching && <span className="search-loading" aria-label="Searching…" />}
              <button className="search-close-btn" onClick={() => setOpen(false)} aria-label="Close search">
                <kbd>Esc</kbd>
              </button>
            </div>

            <div className="search-body">
              {!query && (
                <p className="search-hint">
                  Search across tenants, landlords, properties, documents, and commercial leads.
                </p>
              )}

              {noResults && (
                <p className="search-empty">No results for <strong>"{query}"</strong></p>
              )}

              {hasResults && (
                <div className="search-results" role="list">
                  {groups.map((g) => (
                    <div key={g.type} className="search-group" role="group" aria-label={g.label}>
                      <div className="search-group-label">{g.label}</div>
                      {g.items.map((item) => (
                        <a
                          key={item.id}
                          href={item.href}
                          className="search-result-row"
                          role="listitem"
                          onClick={() => setOpen(false)}
                        >
                          <span className={`search-result-type-dot search-dot--${g.type}`} aria-hidden="true" />
                          <div className="search-result-body">
                            <span className="search-result-title">{item.title}</span>
                            {item.subtitle && (
                              <span className="search-result-sub">{item.subtitle}</span>
                            )}
                          </div>
                          {item.status && (
                            <span className="search-result-status">
                              {String(item.status).replaceAll('_', ' ')}
                            </span>
                          )}
                        </a>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="search-footer">
              <span>↑↓ navigate</span>
              <span>↵ open</span>
              <span>Esc close</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
