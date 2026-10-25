// Small server-safe pieces for showing enquiries in lists.
import Link from 'next/link';
import type { LeadRow } from '@/lib/crm';
import { fmtDate } from '@/lib/dates';
import { durationLabel } from '@/lib/quick-parse';
import { clientFollowUp, paymentReminder, whatsappLink, digitsForWhatsApp } from '@/lib/templates';
import { StageBadge, Money, Empty } from './ui';

export function tripLine(l: Pick<LeadRow, 'travel_start' | 'travel_end' | 'pax' | 'adults' | 'children' | 'infants'>) {
  const dates = l.travel_start ? `${fmtDate(l.travel_start).replace(/ \d{4}$/, '')}${l.travel_end ? ` – ${fmtDate(l.travel_end)}` : ''}` : 'Dates TBC';
  const dur = durationLabel(l.travel_start, l.travel_end);
  const pax = `${l.adults}A${l.children ? ` ${l.children}C` : ''}${l.infants ? ` ${l.infants}I` : ''}`;
  return `${dates}${dur ? ` (${dur})` : ''} · ${pax}`;
}

export function PriorityDot({ p }: { p: string }) {
  return p === 'normal' ? null : <span className={`pdot p-${p}`} title={p === 'hot' ? 'Hot lead' : 'Cold lead'}>{p === 'hot' ? '🔥' : '❄'}</span>;
}

/** One enquiry as a compact list row. `extra` renders on the right. */
export function LeadLine({ l, extra, showStage = true }: { l: LeadRow; extra?: React.ReactNode; showStage?: boolean }) {
  return (
    <li className="lead-line">
      <div className="ll-main">
        <Link href={`/leads/${l.id}`} className="ll-title"><PriorityDot p={l.priority} />{l.client_name} · {l.destination}</Link>
        <span className="sub">{l.lead_no} · {tripLine(l)}</span>
      </div>
      <div className="ll-side">
        {showStage && <StageBadge stage={l.stage} short />}
        {extra}
      </div>
    </li>
  );
}

export function LeadList({ leads, empty, extra, showStage }: { leads: LeadRow[]; empty: string; extra?: (l: LeadRow) => React.ReactNode; showStage?: boolean }) {
  if (!leads.length) return <Empty title={empty} />;
  return <ul className="lead-lines">{leads.map((l) => <LeadLine key={l.id} l={l} extra={extra?.(l)} showStage={showStage} />)}</ul>;
}

export function WaFollowUp({ l, kind = 'follow' }: { l: LeadRow; kind?: 'follow' | 'payment' }) {
  if (!digitsForWhatsApp(l.phone)) return null;
  const msg = kind === 'payment' ? paymentReminder(l) : clientFollowUp(l);
  return <a className="btn btn-wa btn-sm" href={whatsappLink(l.phone, msg)} target="_blank" rel="noopener noreferrer">WhatsApp</a>;
}

export function BalancePill({ l }: { l: LeadRow }) {
  if (l.balance_due === null || Number(l.balance_due) <= 0) return null;
  return <span className="pill pill-due">Due <Money value={l.balance_due} /></span>;
}
