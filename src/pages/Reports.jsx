import React, { useState } from 'react';
import { useApi } from '../lib/auth';
import { PageHeader, Card, Badge, Loading, ErrorState, InfoNote, EmptyState } from '../components/ui';
import { DataTable } from '../components/DataTable';
import { monthOptions, currentMonth, fmtDateTime, fmtNumber } from '../lib/format';
import { api, downloadFile } from '../lib/api';

export default function ReportsPage() {
  const [month, setMonth] = useState(currentMonth());
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [preview, setPreview] = useState(null);
  const catalogue = useApi('/api/reports');
  const history = useApi('/api/reports/history');

  async function generate(report, format) {
    setBusy(`${report.code}:${format}`);
    setError(null);
    try {
      const res = await api.post('/api/reports/generate', { code: report.code, format, period: { month } });
      await downloadFile(res.data.downloadUrl, res.data.filename);
      setPreview({ report, ...res.data });
      history.reload();
    } catch (e) {
      setError(e.message);
    } finally { setBusy(null); }
  }

  return (
    <div>
      <PageHeader
        title="Management reports"
        description="Downloadable reports generated from the same calculations as the dashboards, so figures always reconcile. Each file carries its period, filters, generation time and a note on data provenance."
        actions={
          <div className="flex items-end gap-2">
            <div>
              <label className="label" htmlFor="r-month">Period</label>
              <select id="r-month" className="input w-auto" value={month} onChange={(e) => setMonth(e.target.value)}>
                {monthOptions(18).map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
          </div>
        }
      />

      {error && <div className="mb-4"><ErrorState message={error} /></div>}

      {catalogue.loading ? <Loading rows={4} /> : catalogue.error ? <ErrorState message={catalogue.error} onRetry={catalogue.reload} /> : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {catalogue.data.map((r) => (
            <Card key={r.code} bodyClass="p-4 flex flex-col justify-between">
              <div>
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-sm font-semibold text-ink-900">{r.name}</h3>
                  {!r.available && <Badge tone="amber">no permission</Badge>}
                </div>
                <p className="text-[13px] text-ink-500 mt-1">{r.description}</p>
              </div>
              <div className="flex gap-2 mt-4">
                <button type="button" className="btn-secondary btn-sm" disabled={!r.available || busy === `${r.code}:csv`} onClick={() => generate(r, 'csv')}>
                  {busy === `${r.code}:csv` ? 'Preparing…' : 'CSV'}
                </button>
                <button type="button" className="btn-secondary btn-sm" disabled={!r.available || busy === `${r.code}:xlsx`} onClick={() => generate(r, 'xlsx')}>
                  {busy === `${r.code}:xlsx` ? 'Preparing…' : 'Excel'}
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {preview && (
        <Card className="mt-4" title={`Preview: ${preview.report.name}`} subtitle={`${preview.rowCount} rows · ${preview.filename}`} bodyClass="p-0">
          <div className="p-4 border-b border-ink-100">
            <InfoNote tone="brand">
              <strong>Lineage:</strong> generated {preview.meta.generated_at} by {preview.meta.generated_by} · organisation {preview.meta.organization} · period {preview.meta.period}.
              The downloaded file begins with the same metadata.
            </InfoNote>
          </div>
          <div className="overflow-x-auto max-h-96">
            <table className="w-full">
              <thead className="sticky top-0"><tr>{preview.headers.map((h) => <th key={h} className="th">{h.replace(/_/g, ' ')}</th>)}</tr></thead>
              <tbody>
                {preview.preview.slice(0, 50).map((row, i) => (
                  <tr key={i} className="hover:bg-ink-50/60">
                    {preview.headers.map((h) => <td key={h} className="td whitespace-nowrap">{row[h] == null || row[h] === '' ? '—' : String(row[h])}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card className="mt-4" title="Report history" subtitle="Who generated which report, when, and with what filters" bodyClass="p-0">
        {history.loading ? <div className="p-4"><Loading rows={2} /></div> : (
          <DataTable
            columns={[
              { key: 'created_at', label: 'Generated', render: (r) => fmtDateTime(r.created_at) },
              { key: 'report_code', label: 'Report', render: (r) => r.report_code.replace(/_/g, ' ') },
              { key: 'generated_by_name', label: 'By', render: (r) => r.generated_by_name || '—' },
              { key: 'format', label: 'Format', render: (r) => <Badge tone="neutral">{r.format}</Badge> },
              { key: 'row_count', label: 'Rows', align: 'right', render: (r) => fmtNumber(r.row_count) },
              { key: 'params', label: 'Period', render: (r) => { try { const p = JSON.parse(r.params); return p.period ? `${p.period.start} → ${p.period.end}` : '—'; } catch { return '—'; } } },
            ]}
            rows={history.data || []}
            pageSize={10}
            emptyTitle="No reports generated yet"
          />
        )}
      </Card>
    </div>
  );
}
