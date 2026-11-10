import React from 'react';
import { Link } from 'react-router-dom';
import { useApi, useAuth } from '../lib/auth';
import { PageHeader, Card, EmptyState, Loading, ErrorState, InfoNote } from '../components/ui';
import { fmtDateTime } from '../lib/format';
import { api } from '../lib/api';

export default function NotificationsPage() {
  const { refresh } = useAuth();
  const list = useApi('/api/governance/notifications');

  async function markRead(id) {
    await api.post(`/api/governance/notifications/${id}/read`, {});
    list.reload();
    refresh();
  }

  return (
    <div>
      <PageHeader title="Notifications" description="In-app messages from automation rules, approvals and data workflows." />
      <Card bodyClass="p-0">
        {list.loading ? <div className="p-5"><Loading /></div>
          : list.error ? <div className="p-5"><ErrorState message={list.error} onRetry={list.reload} /></div>
            : (list.data || []).length === 0 ? (
              <EmptyState title="No notifications" description="Automation and approval events will appear here. Email delivery is not enabled in this build." />
            ) : (
              <ul className="divide-y divide-ink-100">
                {list.data.map((n) => (
                  <li key={n.id} className={`p-4 ${n.read_at ? '' : 'bg-brand-50/40'}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-ink-900">{n.title}</p>
                        <p className="text-[13px] text-ink-600 mt-0.5">{n.body}</p>
                        <p className="text-[11px] text-ink-400 mt-1">{fmtDateTime(n.created_at)} · {n.kind}</p>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        {n.link && <Link className="link text-xs" to={n.link}>Open</Link>}
                        {!n.read_at && <button type="button" className="text-xs text-ink-500 hover:text-ink-700" onClick={() => markRead(n.id)}>Mark read</button>}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
      </Card>
      <div className="mt-3"><InfoNote>Email notifications require an approved mail provider and are not enabled. All current notifications are in-app only.</InfoNote></div>
    </div>
  );
}
