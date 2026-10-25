import { randomUUID } from 'node:crypto';
import { requireUser } from '@/lib/session';
import { todayIST, addDays } from '@/lib/dates';
import { LeadForm } from '@/components/LeadForm';
import { Card, Flash, PageHeader } from '@/components/ui';
import { createLeadAction } from '@/app/actions';

export const metadata = { title: 'New enquiry' };

export default async function NewLeadPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireUser();
  const sp = await searchParams;
  const today = todayIST();
  const idem = randomUUID();
  return (
    <div className="stack" style={{ maxWidth: 920 }}>
      <PageHeader title="New enquiry" subtitle="Paste the client's message to fill the form in one go, or type it in." />
      {sp.saved && <Flash>Saved {sp.saved}. Add the next one below.</Flash>}
      <Card>
        <LeadForm key={idem} action={createLeadAction} mode="create" today={today} idem={idem}
                  values={{ next_follow_up: addDays(today, 1), adults: 2, lead_source: sp.source ?? null }} />
      </Card>
    </div>
  );
}
