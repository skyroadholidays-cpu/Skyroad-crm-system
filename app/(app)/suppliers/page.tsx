import Link from 'next/link';
import { requireUser } from '@/lib/session';
import * as C from '@/lib/crm';
import { fmtDateTime } from '@/lib/dates';
import { Card, Empty, Flash, PageHeader } from '@/components/ui';
import { SupplierForm } from '@/components/SupplierForm';

export const metadata = { title: 'Suppliers' };

export default async function SuppliersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireUser();
  const sp = await searchParams;
  const next = sp.next && sp.next.startsWith('/leads/') ? sp.next : undefined;
  const suppliers = await C.listSuppliers();
  return (
    <div className="stack">
      <PageHeader title="Suppliers" subtitle="DMCs, hotels and transport partners you ask for rates. Add each one once – their email & WhatsApp are used for every request." />
      {next && <Flash tone="warn">Add the supplier below – you’ll go straight back to the enquiry. <Link href={next}>Back without adding</Link></Flash>}
      <div className="two-col">
        <Card title="All suppliers">
          {suppliers.length === 0 ? <Empty title="No suppliers yet">Add your first supplier using the form.</Empty> : (
            <div className="table-wrap"><table>
              <thead><tr><th>Supplier</th><th>Covers</th><th className="num">Requests</th><th className="num">Quoted</th></tr></thead>
              <tbody>
                {suppliers.map((s) => (
                  <tr key={s.id} className={s.is_active ? '' : 'muted'}>
                    <td><Link href={`/suppliers/${s.id}`}>{s.name}</Link>{!s.is_active && <span className="badge" style={{ marginLeft: 6 }}>Hidden</span>}
                      <span className="sub">{[s.contact_person, s.email, s.whatsapp || s.phone].filter(Boolean).join(' · ') || '—'}</span></td>
                    <td>{s.destinations || '—'}<span className="sub">{s.services ?? ''}</span></td>
                    <td className="num">{s.requests}<span className="sub">{s.last_request_at ? fmtDateTime(s.last_request_at).split(',')[0] : ''}</span></td>
                    <td className="num">{s.quotes}{s.requests ? <span className="sub">{Math.round((s.quotes / s.requests) * 100)}%</span> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </Card>
        <Card title="Add a supplier">
          <SupplierForm next={next} />
        </Card>
      </div>
    </div>
  );
}
