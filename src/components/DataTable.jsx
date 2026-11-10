import React, { useMemo, useState } from 'react';
import { fmtNumber, fmtPct } from '../lib/format';
import { EmptyState } from './ui';

/**
 * Accessible, sortable data table with optional search and CSV export of the
 * currently visible rows. Client-side sorting only — the dataset shown is always
 * exactly what the backend authorised for this user.
 */
export function DataTable({
  columns, rows, emptyTitle = 'No records', emptyDescription, searchable = false,
  initialSort = null, pageSize = 25, rowKey = (r, i) => r.id ?? i, dense = false,
}) {
  const [sort, setSort] = useState(initialSort);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    if (!query.trim()) return rows;
    const q = query.toLowerCase();
    return rows.filter((r) => columns.some((c) => String(r[c.key] ?? '').toLowerCase().includes(q)));
  }, [rows, query, columns]);

  const sorted = useMemo(() => {
    if (!sort) return filtered;
    const col = columns.find((c) => c.key === sort.key);
    const dir = sort.dir === 'desc' ? -1 : 1;
    return [...filtered].sort((a, b) => {
      const av = a[sort.key], bv = b[sort.key];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (col?.type === 'num' || col?.type === 'pct' || typeof av === 'number') return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }, [filtered, sort, columns]);

  const totalPages = Math.max(Math.ceil(sorted.length / pageSize), 1);
  const current = Math.min(page, totalPages - 1);
  const visible = sorted.slice(current * pageSize, current * pageSize + pageSize);

  const toggleSort = (key) => {
    setSort((s) => (s?.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  };

  const cellValue = (row, col) => {
    const v = col.render ? col.render(row) : row[col.key];
    if (col.render) return v;
    if (v == null || v === '') return <span className="text-ink-300">—</span>;
    if (col.type === 'pct') return fmtPct(v);
    if (col.type === 'num') return fmtNumber(v, col.dp ?? 1);
    return v;
  };

  if (!rows.length) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <div>
      {searchable && (
        <div className="px-4 pt-3 pb-2 no-print">
          <input
            type="search"
            className="input max-w-xs"
            placeholder="Search these records…"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setPage(0); }}
            aria-label="Search records"
          />
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={`th ${c.align === 'right' ? 'text-right' : ''} ${c.sortable === false ? '' : 'cursor-pointer select-none hover:text-ink-700'}`}
                  onClick={c.sortable === false ? undefined : () => toggleSort(c.key)}
                  aria-sort={sort?.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  title={c.tip}
                  style={c.width ? { width: c.width } : undefined}
                >
                  <span className="inline-flex items-center gap-1">
                    {c.label}
                    {sort?.key === c.key && <span aria-hidden className="text-brand-600">{sort.dir === 'asc' ? '▲' : '▼'}</span>}
                    {c.tip && !sort?.key && <span className="text-ink-400 font-normal" aria-hidden>ⓘ</span>}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row, i) => (
              <tr key={rowKey(row, i)} className="hover:bg-ink-50/60">
                {columns.map((c) => (
                  <td key={c.key} className={`td ${c.align === 'right' ? 'text-right tabular-nums' : ''} ${dense ? 'py-1.5' : ''} ${c.className || ''}`}>
                    {cellValue(row, c)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-xs text-ink-500 no-print">
        <span>
          Showing {sorted.length === 0 ? 0 : current * pageSize + 1}–{Math.min((current + 1) * pageSize, sorted.length)} of {sorted.length}
          {query && rows.length !== sorted.length ? ` (filtered from ${rows.length})` : ''}
        </span>
        {totalPages > 1 && (
          <div className="flex items-center gap-1">
            <button type="button" className="btn-secondary btn-sm" disabled={current === 0} onClick={() => setPage(current - 1)}>Previous</button>
            <span className="px-2">Page {current + 1} of {totalPages}</span>
            <button type="button" className="btn-secondary btn-sm" disabled={current >= totalPages - 1} onClick={() => setPage(current + 1)}>Next</button>
          </div>
        )}
      </div>
    </div>
  );
}
