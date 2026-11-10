import React from 'react';
import { useApi } from '../lib/auth';
import { PageHeader, Card, Loading, ErrorState, InfoNote } from '../components/ui';

export default function MetricsPage() {
  const defs = useApi('/api/analytics/definitions');
  return (
    <div>
      <PageHeader
        title="Metric definitions"
        description="Every number in the platform comes from one of these definitions. They are documented so results are reproducible and can be checked against your own data."
      />
      {defs.loading ? <Loading rows={4} /> : defs.error ? <ErrorState message={defs.error} onRetry={defs.reload} /> : (
        <>
          <Card bodyClass="p-0">
            <table className="w-full">
              <thead><tr><th className="th">Measure</th><th className="th">How it is calculated</th><th className="th">Notes</th></tr></thead>
              <tbody>
                {(defs.data?.metrics || []).map((m) => (
                  <tr key={m.key}>
                    <td className="td whitespace-nowrap"><span className="font-medium">{m.name}</span><span className="block font-mono text-[10px] text-ink-400">{m.key}</span></td>
                    <td className="td text-[13px]">{m.formula}</td>
                    <td className="td text-[12px] text-ink-500">{m.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card title="Calculation settings for your organization" bodyClass="p-4">
              <pre className="text-[12px] bg-ink-50 border border-ink-200 rounded-lg p-3 overflow-x-auto">{JSON.stringify(defs.data?.calculation_settings ?? {}, null, 2)}</pre>
            </Card>
            <div className="space-y-3">
              <InfoNote tone="brand" title="Why fixed formulas">
                If the formula behind a metric changed silently, two reports could disagree and no decision would be safe.
                The platform therefore fixes the formulas and lets you configure targets and inclusion rules instead.
              </InfoNote>
              <InfoNote tone="caution" title="Actuals versus plans versus estimates">
                Allocations are plans. Timesheets are actuals. Forecasts are estimates. The interface labels all three, and they are never added together.
              </InfoNote>
              <InfoNote>{defs.data?.note}</InfoNote>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
