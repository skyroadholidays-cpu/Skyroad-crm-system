import Link from 'next/link';
import { requireUser } from '@/lib/session';
import * as C from '@/lib/crm';
import { todayIST, fmtDate, fmtDateTime } from '@/lib/dates';
import { inr } from '@/lib/money';
import { STAGES, STAGE_LABEL, STAGE_HELP, ACTIVITY_LABEL } from '@/lib/constants';
import { Card, CountCard, Empty, Flash, Icon, PageHeader } from '@/components/ui';
import { LeadList, WaFollowUp, BalancePill } from '@/components/LeadBits';
import { CountChart } from '@/components/CountChart';
import { AutoRefresh } from '@/components/client';

export const metadata = { title: 'Dashboard' };

export default async function Dashboard({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireUser();
  const sp = await searchParams;
  const today = todayIST();
  const [d, recent] = await Promise.all([C.getDashboard(today), C.recentActivity(10)]);
  const count = (s: string) => d.stageCounts[s]?.count ?? 0;
  const total = Object.values(d.stageCounts).reduce((a, s) => a + s.count, 0);

  return (
    <div className="stack">
      <AutoRefresh />
      <PageHeader title="Dashboard" subtitle={`Skyroad Holidays sales pipeline · ${fmtDate(today)}`}
                  actions={<><Link href="/pipeline" className="btn btn-ghost">Open pipeline</Link><Link href="/leads/new" className="btn btn-primary">+ New enquiry</Link></>} />
      {sp.welcome && <Flash>Welcome! Start by adding your suppliers (Suppliers → Add), then add your first enquiry.</Flash>}

      {(d.followOverdue.length > 0 || d.awaitingSupplier.length > 0 || d.departures.some((l) => Number(l.balance_due) > 0)) && (
        <div className="alerts">
          {d.followOverdue.length > 0 && (
            <div className="alert-row red">{Icon.alert}<span><strong>{d.followOverdue.length}</strong> follow-up{d.followOverdue.length > 1 ? 's' : ''} overdue</span><Link href="/follow-ups">Open</Link></div>
          )}
          {d.awaitingSupplier.length > 0 && (
            <div className="alert-row amber">{Icon.alert}<span><strong>{d.awaitingSupplier.length}</strong> enquir{d.awaitingSupplier.length > 1 ? 'ies' : 'y'} waiting over 24 hrs for a supplier quote</span><Link href="/leads?stage=supplier_mailed">Chase</Link></div>
          )}
          {d.departures.filter((l) => Number(l.balance_due) > 0).length > 0 && (
            <div className="alert-row blue">{Icon.alert}<span><strong>{d.departures.filter((l) => Number(l.balance_due) > 0).length}</strong> trip{d.departures.filter((l) => Number(l.balance_due) > 0).length > 1 ? 's' : ''} in the next 30 days with balance still due</span><Link href="/reports?r=payments">See</Link></div>
          )}
        </div>
      )}

      <div className="stats">
        <CountCard label="Open enquiries" value={d.openCount} hint={Number(d.openValue) > 0 ? `≈ ${inr(d.openValue)} in play` : 'Not yet confirmed'} href="/leads?scope=open" tone="cash" />
        <CountCard label="New this month" value={d.monthNew} hint={`${d.monthLost} lost this month`} href={`/leads?month=${today.slice(0, 7)}`} tone="in" />
        <CountCard label="Confirmed this month" value={d.monthConfirmed} hint={inr(d.monthConfirmedValue)} href="/leads?scope=won" tone="net" />
        <CountCard label="Conversion (90 days)" value={d.conversion === null ? '—' : `${d.conversion}%`} hint="Booked ÷ decided enquiries" href="/reports?r=sources&period=fy" tone="due" />
        <CountCard label="Client balances due" value={<span className="money">{inr(d.toCollect)}</span>} hint={`${d.toCollectCount} confirmed booking${d.toCollectCount === 1 ? '' : 's'}`} href="/reports?r=payments" tone="pay" />
      </div>

      <Card title="Enquiry status" actions={<span className="muted small">{total} enquir{total === 1 ? 'y' : 'ies'} in total · click a stage to see them</span>}>
        <div className="stage-grid">
          {STAGES.map((s, i) => (
            <Link key={s} href={`/leads?stage=${s}`} className={`stage-card st-${s}${count(s) ? '' : ' zero'}`} title={STAGE_HELP[s]}>
              <span className="sc-num">{i + 1}</span>
              <span className="sc-label">{STAGE_LABEL[s]}</span>
              <strong className="sc-count">{count(s)}</strong>
            </Link>
          ))}
          <Link href="/leads?stage=lost" className={`stage-card st-lost${count('lost') ? '' : ' zero'}`}>
            <span className="sc-num">✕</span><span className="sc-label">{STAGE_LABEL.lost}</span><strong className="sc-count">{count('lost')}</strong>
          </Link>
        </div>
      </Card>

      <div className="two-col">
        <Card title="Follow-ups due" actions={<Link href="/follow-ups" className="btn btn-link small">All follow-ups</Link>}>
          {d.followOverdue.length + d.followToday.length === 0 ? <Empty title="Nothing due today 🎉" /> : (
            <LeadList leads={[...d.followOverdue, ...d.followToday]} empty=""
                      extra={(l) => <>{l.follow_up_overdue ? <span className="pill pill-over">{fmtDate(l.next_follow_up).replace(/ \d{4}$/, '')}</span> : <span className="pill">Today</span>}<WaFollowUp l={l} /></>} />
          )}
        </Card>
        <Card title="Waiting for supplier quotes" actions={<span className="muted small">requested over 24 hrs ago</span>}>
          <LeadList leads={d.awaitingSupplier} empty="No supplier is keeping you waiting"
                    extra={(l) => <span className="pill">{l.quotes_received}/{l.quotes_requested} quoted</span>} />
        </Card>
      </div>

      <div className="two-col">
        <Card title="Departing in the next 30 days">
          <LeadList leads={d.departures} empty="No confirmed departures in the next 30 days"
                    extra={(l) => <><BalancePill l={l} />{Number(l.balance_due) > 0 && <WaFollowUp l={l} kind="payment" />}</>} />
        </Card>
        <Card title="Travelling now">
          <LeadList leads={d.travelling} empty="Nobody is travelling right now" showStage={false}
                    extra={(l) => <span className="pill">Back {fmtDate(l.travel_end).replace(/ \d{4}$/, '')}</span>} />
        </Card>
      </div>

      <div className="two-col">
        <Card title="Enquiries vs bookings – last 12 months">
          <CountChart data={d.monthly} />
        </Card>
        <Card title="Where enquiries come from" actions={<span className="muted small">last 12 months</span>}>
          {d.sources.length === 0 ? <Empty title="No enquiries yet" /> : (
            <table><tbody>
              {d.sources.map((s) => (
                <tr key={s.source}>
                  <td>{s.source}</td>
                  <td className="num">{s.leads} enquir{s.leads === 1 ? 'y' : 'ies'}</td>
                  <td className="num">{s.won} booked</td>
                  <td className="num muted">{s.leads ? Math.round((s.won / s.leads) * 100) : 0}%</td>
                </tr>
              ))}
            </tbody></table>
          )}
        </Card>
      </div>

      <Card title="Recent activity">
        {recent.length === 0 ? <Empty title="No activity yet" /> : (
          <ul className="timeline compact">
            {recent.map((a) => (
              <li key={a.id} className={`tl-${a.kind}`}>
                <span className="tl-kind">{ACTIVITY_LABEL[a.kind] ?? a.kind}</span>
                <div><Link href={`/leads/${a.lead_id}`}>{a.client_name} · {a.destination}</Link> — {a.body}
                  <span className="sub">{fmtDateTime(a.at)}</span></div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
