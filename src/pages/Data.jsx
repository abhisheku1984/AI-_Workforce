import React, { useMemo, useState } from 'react';
import { useApi, useAuth } from '../lib/auth';
import { PageHeader, Card, Badge, Loading, ErrorState, InfoNote, Tabs, EmptyState } from '../components/ui';
import { DataTable } from '../components/DataTable';
import { fmtDateTime, fmtNumber, fmtDate } from '../lib/format';
import { api, downloadFile } from '../lib/api';

const STEP_LABELS = ['1. Upload', '2. Map columns', '3. Validate', '4. Commit'];

export default function DataPage() {
  const { can } = useAuth();
  const [tab, setTab] = useState('upload');
  const schemas = useApi('/api/imports/schemas');
  const history = useApi('/api/imports');

  return (
    <div>
      <PageHeader
        title="Data"
        description="Bring in workforce, project, allocation and financial data from Excel or CSV. Raw files and raw cell values are always kept; nothing reaches your reports until you have mapped the columns and reviewed the validation results."
      />

      <Tabs
        tabs={[
          { id: 'upload', label: 'Upload & import' },
          { id: 'history', label: 'Import history', count: history.data?.length },
          { id: 'retention', label: 'Retention & deletion' },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'upload' && <UploadWizard schemas={schemas} onDone={() => history.reload()} />}
      {tab === 'history' && <ImportHistory history={history} />}
      {tab === 'retention' && <RetentionPanel canManage={can('org.manage')} />}
    </div>
  );
}

/* ------------------------------------------------------------------ wizard */
function UploadWizard({ schemas, onDone }) {
  const [step, setStep] = useState(0);
  const [entityType, setEntityType] = useState('employees');
  const [file, setFile] = useState(null);
  const [upload, setUpload] = useState(null);
  const [mapping, setMapping] = useState({});
  const [validation, setValidation] = useState(null);
  const [commitResult, setCommitResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [force, setForce] = useState(false);
  const [rowFilter, setRowFilter] = useState('invalid');

  const schema = useMemo(() => schemas.data?.entities.find((e) => e.key === entityType), [schemas.data, entityType]);
  const detail = useApi(upload ? `/api/imports/${upload.importId}` : null, { skip: !upload, deps: [upload?.importId, step] });

  function reset() {
    setStep(0); setFile(null); setUpload(null); setMapping({}); setValidation(null); setCommitResult(null); setError(null); setRowFilter('invalid');
  }

  async function doUpload(e) {
    e?.preventDefault();
    if (!file) { setError('Choose a file first.'); return; }
    setBusy(true); setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('entity_type', entityType);
      if (force) fd.append('force', 'true');
      const res = await api.upload('/api/imports/upload', fd);
      setUpload(res.data);
      setMapping(res.data.suggestedMapping || {});
      setStep(1);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  async function saveMapping() {
    setBusy(true); setError(null);
    try {
      await api.post(`/api/imports/${upload.importId}/map`, { mapping });
      setStep(2);
      const v = await api.post(`/api/imports/${upload.importId}/validate`, {});
      setValidation(v.data);
      detail.reload();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  async function doCommit() {
    setBusy(true); setError(null);
    try {
      const res = await api.post(`/api/imports/${upload.importId}/commit`, {});
      setCommitResult(res.data);
      setStep(3);
      onDone?.();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  const requiredMapped = schema ? schema.fields.filter((f) => f.required).every((f) => Object.values(mapping).includes(f.key)) : false;

  return (
    <div>
      <ol className="flex flex-wrap items-center gap-2 mb-4 text-[13px]">
        {STEP_LABELS.map((label, i) => (
          <li key={label} className={`flex items-center gap-2 rounded-lg px-3 py-1.5 ${i === step ? 'bg-brand-600 text-white' : i < step ? 'bg-positive-50 text-positive-700' : 'bg-ink-100 text-ink-500'}`}>
            {label}
          </li>
        ))}
        {step > 0 && <li><button type="button" className="link text-xs" onClick={reset}>Start over</button></li>}
      </ol>

      {error && <div className="mb-4"><ErrorState message={error} /></div>}

      {step === 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="lg:col-span-2" title="Choose what you are uploading" subtitle="Each data type has its own required fields and validation rules.">
            {schemas.loading ? <Loading rows={3} /> : (
              <>
                <div className="grid sm:grid-cols-2 gap-2">
                  {(schemas.data?.entities || []).map((e) => (
                    <button
                      key={e.key}
                      type="button"
                      onClick={() => setEntityType(e.key)}
                      className={`text-left rounded-lg border px-3 py-2.5 transition ${entityType === e.key ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500' : 'border-ink-200 hover:border-ink-300'}`}
                    >
                      <span className="text-[13px] font-medium text-ink-900">{e.label}</span>
                      <span className="block text-[11px] text-ink-500 mt-0.5">{e.description}</span>
                    </button>
                  ))}
                </div>

                <form onSubmit={doUpload} className="mt-5 space-y-3">
                  <div>
                    <label className="label" htmlFor="file">File ({(schemas.data?.limits.types || []).join(', ')}, max {schemas.data?.limits.max_mb} MB)</label>
                    <input
                      id="file"
                      type="file"
                      accept=".csv,.xlsx,.xls"
                      className="block w-full text-sm text-ink-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-600 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-brand-700"
                      onChange={(e) => setFile(e.target.files?.[0] || null)}
                    />
                    {file && <p className="hint mt-1">{file.name} · {(file.size / 1024).toFixed(0)} KB</p>}
                  </div>
                  <label className="flex items-center gap-2 text-[13px] text-ink-600">
                    <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} className="rounded border-ink-300" />
                    Upload even if this exact file was imported before (refresh)
                  </label>
                  <div className="flex items-center gap-2">
                    <button type="submit" className="btn-primary" disabled={busy || !file}>{busy ? 'Uploading…' : 'Upload and preview'}</button>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={async () => {
                        try { await downloadFile(`/api/imports/template/${entityType}`, `workforceiq_${entityType}_template.csv`); } catch (e) { setError(e.message); }
                      }}
                    >
                      Download template
                    </button>
                  </div>
                </form>
              </>
            )}
          </Card>

          <Card title="What happens to my file" bodyClass="p-4 space-y-3 text-[13px] text-ink-600">
            <p><strong>Nothing is applied on upload.</strong> The file is stored unmodified with a checksum, and rows are held in a staging area.</p>
            <p><strong>You map the columns.</strong> The platform suggests a mapping from your header names; you confirm it.</p>
            <p><strong>You review validation.</strong> Safe formatting fixes (dates, numbers, capitalisation) are applied and listed. Questionable values are flagged — never invented.</p>
            <p><strong>Commit is all-or-nothing.</strong> Records are written in one transaction; a failure leaves your existing data untouched.</p>
            <p className="text-ink-500">Uploaded text is treated strictly as data. Instructions inside files are never executed.</p>
          </Card>
        </div>
      )}

      {step === 1 && upload && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <Card className="xl:col-span-2" title={`Map columns — ${upload.label}`} subtitle={`${upload.rowsTotal} rows detected, ${upload.autoMappedCount} columns matched automatically. Confirm or change below.`} bodyClass="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead><tr><th className="th">Your column</th><th className="th">Maps to</th><th className="th">Sample value</th></tr></thead>
                <tbody>
                  {upload.headers.map((h) => {
                    const sample = upload.preview?.[0]?.[h];
                    return (
                      <tr key={h}>
                        <td className="td font-medium">{h}</td>
                        <td className="td">
                          <select
                            className="input"
                            value={mapping[h] || ''}
                            onChange={(e) => {
                              const next = { ...mapping };
                              if (e.target.value) next[h] = e.target.value; else delete next[h];
                              setMapping(next);
                            }}
                            aria-label={`Map column ${h}`}
                          >
                            <option value="">— Ignore this column —</option>
                            {(schema?.fields || []).map((f) => (
                              <option key={f.key} value={f.key} disabled={f.key !== mapping[h] && Object.values(mapping).includes(f.key)}>
                                {f.label}{f.required ? ' *' : ''}{f.sensitive ? ' (sensitive)' : ''}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="td text-ink-500 max-w-[200px] truncate">{sample === undefined || sample === '' ? '—' : String(sample)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="p-4 border-t border-ink-100 flex items-center gap-2">
              <button type="button" className="btn-primary" onClick={saveMapping} disabled={busy || !requiredMapped}>
                {busy ? 'Validating…' : 'Confirm mapping and validate'}
              </button>
              {!requiredMapped && <span className="text-xs text-caution-700">Map every field marked * to continue.</span>}
            </div>
          </Card>

          <div className="space-y-3">
            <Card title="Required fields" bodyClass="p-4">
              <ul className="text-[13px] space-y-1.5">
                {(schema?.fields || []).filter((f) => f.required).map((f) => (
                  <li key={f.key} className="flex items-center justify-between gap-2">
                    <span>{f.label}</span>
                    {Object.values(mapping).includes(f.key) ? <Badge tone="green">mapped</Badge> : <Badge tone="red">missing</Badge>}
                  </li>
                ))}
              </ul>
            </Card>
            <Card title="File preview" subtitle="First 3 rows as read from the file" bodyClass="p-3">
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {upload.preview.slice(0, 3).map((r, i) => (
                  <pre key={i} className="text-[10px] bg-ink-50 border border-ink-200 rounded p-2 whitespace-pre-wrap">{JSON.stringify(r.values, null, 1)}</pre>
                ))}
              </div>
            </Card>
            {schema?.fields.some((f) => f.sensitive) && (
              <InfoNote tone="caution" title="Contains sensitive fields">
                This data type can include cost information. Cost fields are visible only to roles with cost permission, and are hidden from everyone else at the server.
              </InfoNote>
            )}
          </div>
        </div>
      )}

      {step === 2 && upload && (
        <div className="space-y-4">
          {validation && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Stat label="Total rows" value={validation.rowsTotal} />
              <Stat label="Valid" value={validation.rowsValid} tone="positive" />
              <Stat label="Warnings" value={validation.rowsWarning} tone="caution" note="will be imported with recorded warnings" />
              <Stat label="Errors" value={validation.rowsInvalid} tone="danger" note="will be skipped" />
            </div>
          )}

          {validation && validation.rowsDuplicate > 0 && (
            <InfoNote tone="caution" title={`${validation.rowsDuplicate} duplicate row(s) in the file`}>
              Rows repeating the same natural key are marked and skipped, so records are not created twice. Existing records matching a row will be updated, not duplicated.
            </InfoNote>
          )}

          <Card
            title="Row-level results"
            subtitle="Filter to review problems before committing. You can download a full error report."
            actions={
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={async () => { try { await downloadFile(`/api/imports/${upload.importId}/error-report`, `import_${upload.importId}_errors.csv`); } catch (e) { setError(e.message); } }}
              >
                Download error report
              </button>
            }
            bodyClass="p-0"
          >
            <div className="px-4 py-3 border-b border-ink-100 flex flex-wrap gap-2">
              {[['invalid', 'Errors'], ['warning', 'Warnings'], ['duplicate', 'Duplicates'], ['valid', 'Valid'], ['skipped', 'Skipped']].map(([k, label]) => (
                <button key={k} type="button" className={`tab ${rowFilter === k ? 'tab-active' : ''}`} onClick={() => setRowFilter(k)}>
                  {label}
                  {detail.data?.counts?.[k] != null && <span className="ml-1 text-xs text-ink-400">{detail.data.counts[k]}</span>}
                </button>
              ))}
            </div>
            {detail.loading ? <div className="p-4"><Loading rows={3} /></div> : (
              <div className="max-h-[480px] overflow-y-auto">
                <table className="w-full">
                  <thead className="sticky top-0"><tr><th className="th">Row</th><th className="th">Status</th><th className="th">Issues</th><th className="th">Normalised values</th></tr></thead>
                  <tbody>
                    {(detail.data?.rows || []).filter((r) => r.status === rowFilter).slice(0, 200).map((r) => (
                      <tr key={r.id}>
                        <td className="td font-mono text-xs">{r.row_number}</td>
                        <td className="td"><Badge tone={r.status === 'valid' ? 'green' : r.status === 'invalid' ? 'red' : r.status === 'duplicate' ? 'amber' : 'neutral'}>{r.status}</Badge></td>
                        <td className="td max-w-[380px]">
                          <ul className="space-y-1">
                            {r.issues.map((iss, i) => (
                              <li key={i} className={`text-[12px] ${iss.severity === 'error' ? 'text-danger-700' : iss.severity === 'warning' ? 'text-caution-700' : 'text-ink-500'}`}>
                                <span className="font-mono text-[10px] mr-1 opacity-60">{iss.code}</span>{iss.message}
                              </li>
                            ))}
                            {r.issues.length === 0 && <span className="text-[12px] text-ink-400">No issues</span>}
                          </ul>
                        </td>
                        <td className="td max-w-[280px]">
                          <pre className="text-[10px] text-ink-500 whitespace-pre-wrap max-h-24 overflow-y-auto">{r.normalized ? JSON.stringify(r.normalized) : JSON.stringify(r.raw)}</pre>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {(detail.data?.rows || []).filter((r) => r.status === rowFilter).length === 0 && (
                  <p className="p-6 text-center text-sm text-ink-500">No rows in this state.</p>
                )}
              </div>
            )}
          </Card>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn-primary"
              onClick={doCommit}
              disabled={busy || !validation || validation.rowsValid + validation.rowsWarning === 0}
            >
              {busy ? 'Committing…' : `Commit ${validation ? validation.rowsValid + validation.rowsWarning : 0} valid row(s)`}
            </button>
            <button type="button" className="btn-ghost" onClick={reset}>Cancel import</button>
            {validation && validation.rowsValid + validation.rowsWarning === 0 && (
              <span className="text-xs text-danger-700">There are no valid rows to commit. Fix the file and upload again.</span>
            )}
          </div>
          <InfoNote tone="caution">
            Committing is transactional: either every valid row is written or none is. Rows with errors are skipped and remain visible in the import history for audit.
          </InfoNote>
        </div>
      )}

      {step === 3 && commitResult && (
        <Card title="Import complete" bodyClass="p-5">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <Stat label="Created" value={commitResult.created} tone="positive" />
            <Stat label="Updated" value={commitResult.updated} tone="brand" />
            <Stat label="Skipped" value={commitResult.skipped} tone={commitResult.skipped ? 'danger' : 'neutral'} />
            <Stat label="Insights refreshed" value={commitResult.insights?.generated ?? '—'} tone="neutral" />
          </div>
          {commitResult.created_detail?.length > 0 && (
            <div className="mb-4">
              <h4 className="text-[13px] font-semibold mb-1">New reference data created automatically</h4>
              <p className="text-[12px] text-ink-600">{commitResult.created_detail.join(' · ')}</p>
            </div>
          )}
          {commitResult.details?.length > 0 && (
            <details className="text-[12px]">
              <summary className="cursor-pointer text-ink-600">Row outcomes ({commitResult.details.length})</summary>
              <ul className="mt-2 space-y-0.5 max-h-48 overflow-y-auto">
                {commitResult.details.slice(0, 100).map((d, i) => (
                  <li key={i} className="text-ink-500">{d.row}: {d.action}{d.reason ? ` — ${d.reason}` : ''}</li>
                ))}
              </ul>
            </details>
          )}
          <div className="flex gap-2 mt-4">
            <button type="button" className="btn-primary" onClick={reset}>Import another file</button>
            <a className="btn-secondary" href="/utilization">View updated analytics</a>
          </div>
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value, tone = 'neutral', note }) {
  const colors = { neutral: 'text-ink-900', positive: 'text-positive-700', caution: 'text-caution-700', danger: 'text-danger-700', brand: 'text-brand-700' };
  return (
    <div className="card card-pad">
      <p className="text-[12px] font-medium text-ink-500">{label}</p>
      <p className={`text-xl font-semibold mt-1 tabular-nums ${colors[tone]}`}>{fmtNumber(value)}</p>
      {note && <p className="text-[11px] text-ink-400 mt-0.5">{note}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ history */
function ImportHistory({ history }) {
  const [detailId, setDetailId] = useState(null);
  const detail = useApi(detailId ? `/api/imports/${detailId}` : null, { skip: !detailId, deps: [detailId] });

  if (history.loading) return <Loading rows={4} />;
  if (history.error) return <ErrorState message={history.error} onRetry={history.reload} />;

  return (
    <>
      <Card bodyClass="p-0">
        <DataTable
          columns={[
            { key: 'created_at', label: 'Uploaded', render: (r) => fmtDateTime(r.created_at) },
            { key: 'filename', label: 'File', render: (r) => <span className="font-medium">{r.filename}<span className="block text-[11px] text-ink-400">{r.entity_type} · {(r.size_bytes / 1024).toFixed(0)} KB</span></span> },
            { key: 'status', label: 'Status', render: (r) => <Badge tone={r.status === 'committed' ? 'green' : r.status === 'failed' ? 'red' : r.status === 'validated' ? 'brand' : 'neutral'}>{r.status}</Badge> },
            { key: 'rows_total', label: 'Rows', align: 'right' },
            { key: 'rows_valid', label: 'Valid', align: 'right' },
            { key: 'rows_invalid', label: 'Errors', align: 'right', render: (r) => <span className={r.rows_invalid ? 'text-danger-700 font-medium' : ''}>{r.rows_invalid}</span> },
            { key: 'rows_committed', label: 'Committed', align: 'right' },
            { key: 'uploaded_by_name', label: 'By', render: (r) => r.uploaded_by_name || '—' },
            {
              key: 'actions', label: '', sortable: false, render: (r) => (
                <button type="button" className="link text-xs" onClick={() => setDetailId(r.id)}>Details</button>
              ),
            },
          ]}
          rows={history.data || []}
          pageSize={15}
          emptyTitle="No imports yet"
          emptyDescription="Upload a CSV or Excel file to get started."
        />
      </Card>

      {detailId && (
        <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Import details">
          <button type="button" className="absolute inset-0 bg-ink-950/40" aria-label="Close" onClick={() => setDetailId(null)} />
          <div className="relative w-full max-w-2xl h-full bg-white shadow-2xl overflow-y-auto p-5">
            <div className="flex justify-between items-start mb-3">
              <div>
                <h2 className="text-base font-semibold">Import #{detailId}</h2>
                {detail.data && <p className="text-xs text-ink-500">{detail.data.import.filename} · {detail.data.schema.label} · {fmtDateTime(detail.data.import.created_at)}</p>}
              </div>
              <button type="button" className="btn-ghost btn-sm" onClick={() => setDetailId(null)} aria-label="Close">✕</button>
            </div>
            {detail.loading ? <Loading /> : detail.error ? <ErrorState message={detail.error} /> : detail.data && (
              <>
                <div className="grid grid-cols-2 gap-2 mb-4 text-[13px]">
                  <Info label="Status" value={<Badge tone="brand">{detail.data.import.status}</Badge>} />
                  <Info label="Checksum" value={<span className="font-mono text-[10px] break-all">{detail.data.import.checksum.slice(0, 24)}…</span>} />
                  <Info label="Rows total" value={detail.data.import.rows_total} />
                  <Info label="Rows committed" value={detail.data.import.rows_committed} />
                  <Info label="Valid / invalid" value={`${detail.data.import.rows_valid} / ${detail.data.import.rows_invalid}`} />
                  <Info label="Duplicates" value={detail.data.import.duplicate_rows} />
                </div>
                {detail.data.import.notes?.created?.length > 0 && (
                  <div className="mb-3"><InfoNote tone="brand" title="Reference data created during commit">{detail.data.import.notes.created.join(' · ')}</InfoNote></div>
                )}
                <h3 className="text-sm font-semibold mb-2">Validation issues ({detail.data.rows.filter((r) => r.issues.length).length} rows)</h3>
                <ul className="space-y-2 text-[12px] max-h-[50vh] overflow-y-auto">
                  {detail.data.rows.filter((r) => r.issues.length).slice(0, 100).map((r) => (
                    <li key={r.id} className="border border-ink-200 rounded-lg p-2">
                      <p className="font-mono text-[11px] text-ink-500">Row {r.row_number} · {r.status}</p>
                      <ul className="mt-1 space-y-0.5">
                        {r.issues.map((iss, i) => <li key={i} className={iss.severity === 'error' ? 'text-danger-700' : 'text-caution-700'}>• {iss.message}</li>)}
                      </ul>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function Info({ label, value }) {
  return <div><p className="text-[11px] uppercase tracking-wide text-ink-400">{label}</p><p className="text-ink-800">{value}</p></div>;
}

/* ------------------------------------------------------------------ retention */
function RetentionPanel({ canManage }) {
  const retention = useApi('/api/admin/data-retention', { skip: !canManage });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [form, setForm] = useState({ scope: 'import', target_id: '', reason: '' });

  if (!canManage) return <Card><EmptyState title="Administrator access required" description="Retention and deletion controls are limited to organization administrators." /></Card>;
  if (retention.loading) return <Loading rows={3} />;
  if (retention.error) return <ErrorState message={retention.error} onRetry={retention.reload} />;

  async function request() {
    setBusy(true); setError(null);
    try {
      await api.post('/api/governance/data/deletion-requests', form);
      setForm({ scope: 'import', target_id: '', reason: '' });
      retention.reload();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      <Card title="Stored files and retention" subtitle="Original uploads are retained for lineage until the retention policy removes them." bodyClass="p-0">
        <DataTable
          columns={[
            { key: 'created_at', label: 'Uploaded', render: (r) => fmtDateTime(r.created_at) },
            { key: 'filename', label: 'File', render: (r) => <span className="text-[13px]">{r.filename}</span> },
            { key: 'entity_type', label: 'Type' },
            { key: 'size_bytes', label: 'Size', align: 'right', render: (r) => `${(r.size_bytes / 1024).toFixed(0)} KB` },
            { key: 'status', label: 'Status', render: (r) => <Badge tone="neutral">{r.status}</Badge> },
          ]}
          rows={retention.data.imports}
          pageSize={10}
          emptyTitle="No stored files"
        />
        <div className="p-4 border-t border-ink-100">
          <p className="text-[12px] text-ink-600">Retention setting: <strong>{retention.data.settings.retention_days ?? '—'} days</strong> for processed data, <strong>{retention.data.settings.raw_retention_days ?? '—'} days</strong> for raw files. Configure this in Settings → Data.</p>
        </div>
      </Card>

      <div className="space-y-4">
        <Card title="Request data deletion" subtitle="A second administrator must approve before anything is deleted">
          {error && <div className="mb-2"><ErrorState message={error} /></div>}
          <div className="space-y-3">
            <div>
              <label className="label" htmlFor="d-scope">What should be deleted</label>
              <select id="d-scope" className="input" value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value })}>
                <option value="import">A specific import and its raw rows</option>
                <option value="entity">An entire data type (requires maintenance window)</option>
                <option value="org">The whole organization (platform administrator)</option>
              </select>
            </div>
            {form.scope === 'import' && (
              <div>
                <label className="label" htmlFor="d-import">Import</label>
                <select id="d-import" className="input" value={form.target_id} onChange={(e) => setForm({ ...form, target_id: e.target.value })}>
                  <option value="">Select an import…</option>
                  {retention.data.imports.map((i) => <option key={i.id} value={i.id}>#{i.id} · {i.filename} · {fmtDate(i.created_at)}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className="label" htmlFor="d-reason">Reason</label>
              <textarea id="d-reason" className="input min-h-[60px]" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="Why is this deletion needed?" />
            </div>
            <button type="button" className="btn-danger btn-sm" onClick={request} disabled={busy || (form.scope === 'import' && !form.target_id)}>
              {busy ? 'Submitting…' : 'Submit deletion request'}
            </button>
          </div>
        </Card>

        <Card title="Deletion requests" bodyClass="p-0">
          <DataTable
            columns={[
              { key: 'created_at', label: 'Requested', render: (r) => fmtDateTime(r.created_at) },
              { key: 'scope', label: 'Scope', render: (r) => <Badge tone="neutral">{r.scope}</Badge> },
              { key: 'status', label: 'Status', render: (r) => <Badge tone={r.status === 'executed' ? 'green' : r.status === 'rejected' ? 'red' : 'amber'}>{r.status}</Badge> },
              { key: 'requested_by_name', label: 'By', render: (r) => r.requested_by_name || '—' },
              {
                key: 'actions', label: '', sortable: false, render: (r) => (r.status === 'pending' ? (
                  <span className="flex gap-2">
                    <button type="button" className="link text-xs" onClick={async () => { await api.post(`/api/governance/data/deletion-requests/${r.id}/decide`, { decision: 'approved' }); retention.reload(); }}>Approve</button>
                    <button type="button" className="link text-xs text-danger-700" onClick={async () => { await api.post(`/api/governance/data/deletion-requests/${r.id}/decide`, { decision: 'rejected' }); retention.reload(); }}>Reject</button>
                  </span>
                ) : '—'),
              },
            ]}
            rows={retention.data.deletion_requests}
            pageSize={8}
            emptyTitle="No deletion requests"
          />
        </Card>
      </div>
    </div>
  );
}
