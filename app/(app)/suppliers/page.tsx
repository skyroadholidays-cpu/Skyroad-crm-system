import Link from 'next/link';
import { requireUser } from '@/lib/session';
import * as C from '@/lib/crm';
import { fmtDateTime } from '@/lib/dates';
import { Card, Empty, Flash, PageHeader } from '@/components/ui';
import { SupplierForm } from '@/components/SupplierForm';
import { AutoSubmitSelect } from '@/components/client';

/** "Bali, Indonesia" → ["Bali", "Indonesia"] */
function places(destinations: string | null): string[] {
  return (destinations ?? '').split(/[,;/]+/).map((x) => x.trim()).filter(Boolean);
}

export const metadata = { title: 'Suppliers' };

export default async function SuppliersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireUser();
  const sp = await searchParams;
  const next = sp.next && sp.next.startsWith('/leads/') ? sp.next : undefined;
  const all = await C.listSuppliers();
  // country / destination filter options, with how many suppliers cover each
  const counts = new Map<string, { label: string; n: number }>();
  for (const s of all) for (const p of new Set(places(s.destinations).map((x) => x.toLowerCase()))) {
    const label = places(s.destinations).find((x) => x.toLowerCase() === p)!;
    const c = counts.get(p); if (c) c.n++; else counts.set(p, { label, n: 1 });
  }
  const options = [...counts.entries()].sort((a, b) => a[1].label.localeCompare(b[1].label));
  const country = (sp.country ?? '').trim().toLowerCase();
  const q = (sp.q ?? '').trim().toLowerCase();
  const suppliers = all.filter((s) =>
    (!country || places(s.destinations).some((x) => x.toLowerCase() === country)) &&
    (!q || [s.name, s.contact_person, s.email, s.destinations, s.services, s.notes].some((v) => (v ?? '').toLowerCase().includes(q))));
  const filtered = !!(country || q);
  return (
    <div className="stack">
      <PageHeader title="Suppliers" subtitle="DMCs, hotels and transport partners you ask for rates. Add each one once – their email & WhatsApp are used for every request." />
      {sp.deleted && <Flash>Supplier deleted.</Flash>}
      {next && <Flash tone="warn">Add the supplier below – you’ll go straight back to the enquiry. <Link href={next}>Back without adding</Link></Flash>}
      <div className="two-col">
        <Card title={filtered ? `Suppliers (${suppliers.length} of ${all.length})` : `All suppliers (${all.length})`}>
          {all.length > 0 && (
            <form className="filters" method="get">
              <label className="field"><span className="field-label">Country / destination</span>
                <AutoSubmitSelect name="country" defaultValue={country}>
                  <option value="">All</option>
                  {options.map(([key, o]) => <option key={key} value={key}>{o.label} ({o.n})</option>)}
                </AutoSubmitSelect></label>
              <label className="field grow"><span className="field-label">Search</span>
                <input name="q" defaultValue={sp.q ?? ''} placeholder="Name, email, contact…" /></label>
              {next && <input type="hidden" name="next" value={next} />}
              <button className="btn btn-primary" type="submit">Search</button>
              {filtered && <Link className="btn btn-ghost" href={next ? `/suppliers?next=${encodeURIComponent(next)}` : '/suppliers'}>Clear</Link>}
            </form>
          )}
          {all.length === 0 ? <Empty title="No suppliers yet">Add your first supplier using the form.</Empty>
          : suppliers.length === 0 ? <Empty title="No suppliers match">Try another country, or clear the filter.</Empty> : (
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
