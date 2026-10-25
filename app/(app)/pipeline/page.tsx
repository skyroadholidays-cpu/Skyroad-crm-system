import Link from 'next/link';
import { requireUser } from '@/lib/session';
import * as C from '@/lib/crm';
import { fmtDate } from '@/lib/dates';
import { STAGES, STAGE_LABEL, STAGE_SHORT, stageRank, type Stage } from '@/lib/constants';
import { Money, PageHeader } from '@/components/ui';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { AutoRefresh } from '@/components/client';
import { PriorityDot, tripLine } from '@/components/LeadBits';
import { setStageAction } from '@/app/actions';

export const metadata = { title: 'Pipeline' };

// Stages you move by hand; payments / travel dates move the rest automatically.
const MANUAL_NEXT: Partial<Record<Stage, Stage>> = {
  new_query: 'supplier_mailed', supplier_mailed: 'quote_received', quote_received: 'quote_shared',
  quote_shared: 'follow_up', follow_up: 'booking_confirmed', booking_confirmed: 'advance_received', advance_received: 'final_payment_received',
};

export default async function PipelinePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireUser();
  const sp = await searchParams;
  const leads = (await C.listLeads({ q: sp.q }, 1000)).filter((l) => l.stage !== 'lost');
  const byStage = new Map<string, C.LeadRow[]>(STAGES.map((s) => [s, []]));
  for (const l of leads) byStage.get(l.stage)?.push(l);
  // completed column: keep it short
  byStage.set('completed', (byStage.get('completed') ?? []).slice(0, 15));

  return (
    <div className="stack">
      <AutoRefresh seconds={30} />
      <PageHeader title="Pipeline" subtitle="Every live enquiry by stage. Payments and travel dates move cards automatically."
                  actions={<>
                    <form className="row" method="get"><input name="q" defaultValue={sp.q ?? ''} placeholder="Filter…" style={{ width: 160 }} /></form>
                    <Link href="/leads/new" className="btn btn-primary">+ New enquiry</Link>
                  </>} />
      <div className="kanban">
        {STAGES.map((s) => {
          const items = byStage.get(s) ?? [];
          const next = MANUAL_NEXT[s];
          return (
            <section key={s} className={`kcol st-${s}`}>
              <header><span>{STAGE_LABEL[s]}</span><span className="kcount">{items.length}</span></header>
              <div className="kcards">
                {items.length === 0 && <p className="muted small kempty">—</p>}
                {items.map((l) => (
                  <article key={l.id} className="kcard">
                    <Link href={`/leads/${l.id}`} className="kc-title"><PriorityDot p={l.priority} />{l.client_name}</Link>
                    <div className="kc-dest">{l.destination}{l.nights_plan ? <span className="muted"> · {l.nights_plan}</span> : null}</div>
                    <div className="kc-meta">{tripLine(l)}</div>
                    <div className="kc-foot">
                      {l.quote_amount ? <Money value={l.quote_amount} /> : <span className="muted small">{l.lead_no}</span>}
                      {l.next_follow_up && stageRank(l.stage) <= 8 && (
                        <span className={`pill${l.follow_up_overdue ? ' pill-over' : ''}`}>↻ {fmtDate(l.next_follow_up).replace(/ \d{4}$/, '')}</span>
                      )}
                      {stageRank(l.stage) >= 6 && Number(l.balance_due) > 0 && <span className="pill pill-due">Due <Money value={l.balance_due} /></span>}
                    </div>
                    {next && (
                      <ActionForm action={setStageAction} className="kc-move">
                        <input type="hidden" name="id" value={l.id} />
                        <input type="hidden" name="stage" value={next} />
                        <input type="hidden" name="next" value="/pipeline" />
                        <SubmitButton className="btn btn-link small" pendingText="Moving…">{`Move to ${STAGE_SHORT[next]} →`}</SubmitButton>
                      </ActionForm>
                    )}
                  </article>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
