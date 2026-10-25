import Link from 'next/link';
import { requireUser } from '@/lib/session';
import { listSessions } from '@/lib/auth-core';
import * as C from '@/lib/crm';
import { db } from '@/lib/db-core';
import { fmtDateTime } from '@/lib/dates';
import { STAGES, STAGE_LABEL, STAGE_HELP } from '@/lib/constants';
import { Card, PageHeader } from '@/components/ui';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { changePasswordAction, signOutOthersAction, restoreLeadAction } from '@/app/actions';

export const metadata = { title: 'Settings' };

function device(ua: string | null) {
  if (!ua) return 'Unknown device';
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows PC' : 'Device';
  const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return `${br} on ${os}`;
}

const TABLE: Record<string, string> = { lead: 'enquiry', supplier: 'supplier', supplier_quote: 'supplier quote', lead_payment: 'payment' };
const ACTION: Record<string, string> = { insert: 'Created', update: 'Edited', delete: 'Removed', soft_delete: 'Deleted', restore: 'Restored' };

export default async function SettingsPage() {
  const user = await requireUser();
  const [sessions, deleted, audit] = await Promise.all([
    listSessions(user),
    C.listDeletedLeads(50),
    db()<{ at: string; actor: string | null; table_name: string; action: string; record_id: string; label: string | null; lead_id: string | null }>`
      select a.at::text, a.actor, a.table_name, a.action, a.record_id,
             coalesce(a.new_data->>'lead_no', a.old_data->>'lead_no', a.new_data->>'name', a.old_data->>'name', a.new_data->>'amount', a.old_data->>'amount') as label,
             case when a.table_name = 'lead' then a.record_id else coalesce(a.new_data->>'lead_id', a.old_data->>'lead_id') end as lead_id
      from crm.audit_log a order by a.at desc, a.id desc limit 40`,
  ]);
  return (
    <div className="stack">
      <PageHeader title="Settings" subtitle={`Signed in as ${user.username}`} />
      <div className="two-col">
        <Card title="Change password">
          <ActionForm action={changePasswordAction} className="form">
            <div className="grid">
              <label className="field field-wide"><span className="field-label">Current password</span><input type="password" name="current" required autoComplete="current-password" /></label>
              <label className="field"><span className="field-label">New password</span><input type="password" name="password" required minLength={8} autoComplete="new-password" /></label>
              <label className="field"><span className="field-label">Confirm new password</span><input type="password" name="confirm" required minLength={8} autoComplete="new-password" /></label>
            </div>
            <p className="muted small">Changing your password signs out every other device.</p>
            <div className="form-actions"><SubmitButton>Change password</SubmitButton></div>
          </ActionForm>
        </Card>
        <Card title="Signed-in devices">
          <table><tbody>
            {sessions.map((s) => (
              <tr key={s.id}><td>{device(s.user_agent)}{s.current && <span className="badge b-in" style={{ marginLeft: 6 }}>This device</span>}<span className="sub">Last active {fmtDateTime(s.last_seen_at)}</span></td></tr>
            ))}
          </tbody></table>
          <ActionForm action={signOutOthersAction} confirm="Sign out all other devices?">
            <div className="form-actions"><SubmitButton className="btn btn-ghost">Sign out all other devices</SubmitButton></div>
          </ActionForm>
        </Card>
      </div>

      <Card title="Backup & export">
        <p style={{ marginTop: 0 }}>Download every enquiry, supplier, quote, payment and the full timeline and change history.</p>
        <div className="row">
          <a href="/api/backup" className="btn btn-primary">Download full backup (JSON)</a>
          <a href="/api/export?r=register&from=2000-01-01&to=2999-12-31&label=All%20time" className="btn btn-ghost">All enquiries (CSV)</a>
        </div>
        <p className="muted small">Recommended: download a backup every Friday and keep it in Google Drive or iCloud.</p>
      </Card>

      <Card title="How the stages work">
        <ol className="stage-help">
          {STAGES.map((s) => <li key={s}><strong>{STAGE_LABEL[s]}</strong> – {STAGE_HELP[s]}</li>)}
        </ol>
        <p className="muted small">Recording a supplier request, a supplier quote, sharing a quote, logging a client call after the quote, confirming, and recording payments all move the stage forward for you.</p>
      </Card>

      <Card title="Trash – deleted enquiries">
        {deleted.length === 0 ? <p className="muted small">Nothing deleted.</p> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Enquiry</th><th>Deleted</th><th></th></tr></thead>
            <tbody>
              {deleted.map((l) => (
                <tr key={l.id}>
                  <td><Link href={`/leads/${l.id}`}>{l.lead_no}</Link><span className="sub">{l.client_name} · {l.destination}</span></td>
                  <td>{fmtDateTime(l.deleted_at)}</td>
                  <td><ActionForm action={restoreLeadAction}><input type="hidden" name="id" value={l.id} /><SubmitButton className="btn btn-ghost btn-sm" pendingText="…">Restore</SubmitButton></ActionForm></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </Card>

      <Card title="Audit trail – latest changes">
        <div className="table-wrap"><table>
          <thead><tr><th>When</th><th>Who</th><th>What</th><th>Record</th></tr></thead>
          <tbody>
            {audit.map((a, i) => (
              <tr key={i}>
                <td>{fmtDateTime(a.at)}</td><td>{a.actor ?? 'system'}</td>
                <td>{ACTION[a.action] ?? a.action} {TABLE[a.table_name] ?? a.table_name}</td>
                <td>{a.lead_id ? <Link href={`/leads/${a.lead_id}`}>{a.label ?? `#${a.record_id}`}</Link> : a.table_name === 'supplier' ? <Link href={`/suppliers/${a.record_id}`}>{a.label}</Link> : (a.label ?? a.record_id)}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </Card>
    </div>
  );
}
