import Link from 'next/link';
import { requireUser } from '@/lib/session';
import * as C from '@/lib/crm';
import { fmtDate } from '@/lib/dates';
import { STAGES, STAGE_LABEL, LEAD_SOURCES, isStatus } from '@/lib/constants';
import { Card, Chips, Empty, Flash, Money, PageHeader, StageBadge } from '@/components/ui';
import { PriorityDot, tripLine } from '@/components/LeadBits';
import { AutoSubmitSelect } from '@/components/client';

export const metadata = { title: 'Enquiries' };

export default async function LeadsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireUser();
  const sp = await searchParams;
  const scope = (['open', 'won', 'lost', 'all'] as const).find((s) => s === sp.scope) ?? (sp.stage ? 'all' : 'all');
  const leads = await C.listLeads({
    stage: sp.stage, q: sp.q, source: sp.source, priority: sp.priority, scope, month: sp.month,
    sort: sp.sort === 'travel' || sp.sort === 'follow' ? sp.sort : 'recent',
  });
  const keep = { q: sp.q, source: sp.source, priority: sp.priority, sort: sp.sort, month: sp.month };
  const exportQs = new URLSearchParams({ r: 'register', from: '2000-01-01', to: '2999-12-31' });

  return (
    <div className="stack">
      <PageHeader title={sp.stage && isStatus(sp.stage) ? STAGE_LABEL[sp.stage] : 'Enquiries'}
                  subtitle={`${leads.length} enquir${leads.length === 1 ? 'y' : 'ies'}${sp.month ? ` received in ${sp.month}` : ''}`}
                  actions={<><a href={`/api/export?${exportQs}`} className="btn btn-ghost">Export CSV</a><Link href="/leads/new" className="btn btn-primary">+ New enquiry</Link></>} />
      {sp.deleted && <Flash>Enquiry deleted. You can restore it from Settings → Trash.</Flash>}

      <Chips base="/leads" param="scope" value={sp.stage ? '' : scope} keep={keep}
             options={[{ key: 'all', label: 'All' }, { key: 'open', label: 'Open (being sold)' }, { key: 'won', label: 'Confirmed' }, { key: 'lost', label: 'Lost' }]} />

      <Card>
        <form className="filters" method="get">
          <label className="field grow"><span className="field-label">Search</span>
            <input name="q" defaultValue={sp.q ?? ''} placeholder="Name, phone, destination, SRQ no, supplier…" /></label>
          <label className="field"><span className="field-label">Stage</span>
            <AutoSubmitSelect name="stage" defaultValue={sp.stage ?? ''}>
              <option value="">Any</option>
              {[...STAGES, 'lost' as const].map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
            </AutoSubmitSelect></label>
          <label className="field"><span className="field-label">Source</span>
            <AutoSubmitSelect name="source" defaultValue={sp.source ?? ''}>
              <option value="">Any</option>
              {LEAD_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
            </AutoSubmitSelect></label>
          <label className="field"><span className="field-label">Priority</span>
            <AutoSubmitSelect name="priority" defaultValue={sp.priority ?? ''}>
              <option value="">Any</option><option value="hot">Hot</option><option value="normal">Normal</option><option value="cold">Cold</option>
            </AutoSubmitSelect></label>
          <label className="field"><span className="field-label">Sort</span>
            <AutoSubmitSelect name="sort" defaultValue={sp.sort ?? 'recent'}>
              <option value="recent">Newest first</option><option value="travel">Travel date</option><option value="follow">Follow-up date</option>
            </AutoSubmitSelect></label>
          {sp.scope && <input type="hidden" name="scope" value={sp.scope} />}
          <button className="btn btn-primary" type="submit">Search</button>
        </form>

        {leads.length === 0 ? <Empty title="No enquiries match">Try clearing the filters, or <Link href="/leads/new">add a new enquiry</Link>.</Empty> : (
          <div className="table-wrap">
            <table className="leads-table">
              <thead><tr><th>Enquiry</th><th>Client</th><th>Trip</th><th>Stage</th><th className="num">Quote / received</th><th>Follow-up</th></tr></thead>
              <tbody>
                {leads.map((l) => (
                  <tr key={l.id}>
                    <td><Link href={`/leads/${l.id}`}>{l.lead_no}</Link><span className="sub">{fmtDate(l.created_at.slice(0, 10))}</span></td>
                    <td><PriorityDot p={l.priority} />{l.client_name}<span className="sub">{l.phone ?? l.email ?? '—'}{l.lead_source ? ` · ${l.lead_source}` : ''}</span></td>
                    <td><strong>{l.destination}</strong><span className="sub">{tripLine(l)}</span></td>
                    <td><StageBadge stage={l.stage} short /></td>
                    <td className="num">{l.quote_amount ? <Money value={l.quote_amount} /> : '—'}{Number(l.paid) > 0 && <span className="sub">rcvd <Money value={l.paid} /></span>}</td>
                    <td>{l.next_follow_up ? <span className={l.follow_up_overdue ? 'neg' : ''}>{fmtDate(l.next_follow_up)}</span> : <span className="muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
