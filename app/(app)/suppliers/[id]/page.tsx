import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/session';
import * as C from '@/lib/crm';
import { fmtDate, fmtDateTime } from '@/lib/dates';
import { inr } from '@/lib/money';
import { QUOTE_STATUS } from '@/lib/constants';
import { Card, Empty, Flash, PageHeader } from '@/components/ui';
import { SupplierForm } from '@/components/SupplierForm';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { toggleSupplierAction } from '@/app/actions';

export const metadata = { title: 'Supplier' };

export default async function SupplierPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  if (!/^\d{1,9}$/.test(id)) notFound();
  const s = await C.getSupplier(Number(id));
  if (!s) notFound();
  const quotes = await C.listQuotesForSupplier(s.id);
  return (
    <div className="stack">
      <PageHeader title={s.name} subtitle={`${s.requests} rate request${s.requests === 1 ? '' : 's'} · ${s.quotes} quoted · ${s.selected} selected`}
                  actions={<>
                    <Link href="/suppliers" className="btn btn-ghost">All suppliers</Link>
                    <ActionForm action={toggleSupplierAction}>
                      <input type="hidden" name="id" value={s.id} /><input type="hidden" name="active" value={String(!s.is_active)} />
                      <SubmitButton className="btn btn-ghost">{s.is_active ? 'Hide supplier' : 'Show again'}</SubmitButton>
                    </ActionForm>
                  </>} />
      {sp.saved && <Flash>Supplier added.</Flash>}
      <div className="two-col">
        <Card title="Details"><SupplierForm s={s} /></Card>
        <Card title="Enquiries sent to this supplier">
          {quotes.length === 0 ? <Empty title="No requests yet" /> : (
            <div className="table-wrap"><table>
              <thead><tr><th>Enquiry</th><th>Asked</th><th>Status</th><th className="num">Quote</th></tr></thead>
              <tbody>
                {quotes.map((q) => (
                  <tr key={q.id}>
                    <td><Link href={`/leads/${q.lead_id}`}>{q.client_name} · {q.destination}</Link><span className="sub">{q.lead_no}{q.travel_start ? ` · ${fmtDate(q.travel_start)}` : ''}</span></td>
                    <td>{fmtDateTime(q.requested_at).split(',')[0]}</td>
                    <td><span className={`status ${q.status === 'selected' ? 's-done' : q.status === 'received' ? 's-partial' : q.status === 'declined' ? 's-overdue' : 's-pending'}`}>{QUOTE_STATUS[q.status]}</span></td>
                    <td className="num">{q.amount ? (q.currency === 'INR' ? inr(q.amount) : `${q.currency} ${Number(q.amount).toLocaleString('en-IN')}`) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </Card>
      </div>
    </div>
  );
}
