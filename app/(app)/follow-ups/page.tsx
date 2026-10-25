import Link from 'next/link';
import { requireUser } from '@/lib/session';
import * as C from '@/lib/crm';
import { fmtDate, todayIST, addDays } from '@/lib/dates';
import { Card, PageHeader } from '@/components/ui';
import { LeadList, WaFollowUp } from '@/components/LeadBits';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { AutoRefresh } from '@/components/client';
import { setFollowUpAction } from '@/app/actions';

export const metadata = { title: 'Follow-ups' };

function Snooze({ l, today }: { l: C.LeadRow; today: string }) {
  return (
    <ActionForm action={setFollowUpAction} className="row nowrap snooze">
      <input type="hidden" name="id" value={l.id} />
      <input type="hidden" name="follow_up_note" value={l.follow_up_note ?? ''} />
      <input type="date" name="next_follow_up" defaultValue={addDays(today, 2)} aria-label="Next follow-up" />
      <SubmitButton className="btn btn-ghost btn-sm" pendingText="…">Done → next</SubmitButton>
    </ActionForm>
  );
}

export default async function FollowUpsPage() {
  await requireUser();
  const today = todayIST();
  const f = await C.followUps(today);
  const extra = (l: C.LeadRow) => (
    <>
      {l.follow_up_note && <span className="small muted fu-note">{l.follow_up_note}</span>}
      <WaFollowUp l={l} kind={Number(l.balance_due) > 0 && l.stage !== 'follow_up' && l.stage !== 'quote_shared' ? 'payment' : 'follow'} />
      <Snooze l={l} today={today} />
    </>
  );
  return (
    <div className="stack">
      <AutoRefresh />
      <PageHeader title="Follow-ups" subtitle={`Who to chase today · ${fmtDate(today)}`} actions={<Link href="/leads/new" className="btn btn-primary">+ New enquiry</Link>} />
      <Card title={<>Overdue <span className="kcount">{f.overdue.length}</span></>} className={f.overdue.length ? 'card-alert' : ''}>
        <LeadList leads={f.overdue} empty="Nothing overdue 👍" extra={(l) => <><span className="pill pill-over">{fmtDate(l.next_follow_up).replace(/ \d{4}$/, '')}</span>{extra(l)}</>} />
      </Card>
      <Card title={<>Today <span className="kcount">{f.due.length}</span></>}>
        <LeadList leads={f.due} empty="Nothing scheduled for today" extra={extra} />
      </Card>
      <Card title={<>Next 7 days <span className="kcount">{f.upcoming.length}</span></>}>
        <LeadList leads={f.upcoming} empty="Nothing in the next 7 days" extra={(l) => <><span className="pill">{fmtDate(l.next_follow_up).replace(/ \d{4}$/, '')}</span>{extra(l)}</>} />
      </Card>
      <Card title={<>Open enquiries with no follow-up set <span className="kcount">{f.none.length}</span></>} actions={<span className="muted small">set a date so nothing slips</span>}>
        <LeadList leads={f.none} empty="Every open enquiry has a follow-up date" extra={(l) => <Snooze l={l} today={today} />} />
      </Card>
    </div>
  );
}
