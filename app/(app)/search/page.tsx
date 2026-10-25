import Link from 'next/link';
import { requireUser } from '@/lib/session';
import * as C from '@/lib/crm';
import { Card, Empty, PageHeader } from '@/components/ui';
import { LeadList } from '@/components/LeadBits';

export const metadata = { title: 'Search' };

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireUser();
  const { q = '' } = await searchParams;
  const r = await C.search(q);
  return (
    <div className="stack">
      <PageHeader title="Search" subtitle={q ? `Results for “${q}”` : 'Type in the search box at the top.'} />
      <form method="get" className="row"><input name="q" defaultValue={q} placeholder="Client, phone, destination, SRQ no, supplier…" style={{ maxWidth: 420 }} /><button className="btn btn-primary">Search</button></form>
      {q && (
        <>
          <Card title={`Enquiries (${r.leads.length})`}><LeadList leads={r.leads} empty="No enquiries found" /></Card>
          <Card title={`Suppliers (${r.suppliers.length})`}>
            {r.suppliers.length === 0 ? <Empty title="No suppliers found" /> : (
              <ul className="lead-lines">{r.suppliers.map((s) => (
                <li key={s.id} className="lead-line"><div className="ll-main"><Link href={`/suppliers/${s.id}`} className="ll-title">{s.name}</Link><span className="sub">{[s.destinations, s.email].filter(Boolean).join(' · ')}</span></div></li>
              ))}</ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
