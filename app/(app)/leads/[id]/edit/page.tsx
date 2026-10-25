import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/session';
import * as C from '@/lib/crm';
import { todayIST } from '@/lib/dates';
import { LeadForm } from '@/components/LeadForm';
import { Card, PageHeader } from '@/components/ui';
import { updateLeadAction } from '@/app/actions';

export const metadata = { title: 'Edit enquiry' };

export default async function EditLeadPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const l = await C.getLead(Number(id));
  if (!l || l.deleted_at) notFound();
  return (
    <div className="stack" style={{ maxWidth: 920 }}>
      <PageHeader title={`Edit ${l.lead_no}`} subtitle={`${l.client_name} · ${l.destination}`}
                  actions={<Link href={`/leads/${l.id}`} className="btn btn-ghost">Cancel</Link>} />
      <Card>
        <LeadForm action={updateLeadAction} mode="edit" today={todayIST()} values={{ ...l }} />
      </Card>
    </div>
  );
}
