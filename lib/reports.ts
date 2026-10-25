// CRM reports. Each returns the same shape so the page, CSV export and print view share one renderer.
import { db } from './db-core';
import { fmtDate } from './dates';
import { STAGE_LABEL, STAGES, PACKAGE_LABEL, type Status } from './constants';

export interface Column { key: string; label: string; kind?: 'money' | 'int' | 'date' | 'pct' | 'text'; total?: boolean }
export interface Report { key: string; title: string; subtitle: string; columns: Column[]; rows: Record<string, any>[] }

export const REPORTS = {
  register: 'Enquiry register',
  funnel: 'Pipeline by stage',
  sources: 'Lead sources & conversion',
  destinations: 'Destinations',
  monthly: 'Monthly enquiries & bookings',
  lost: 'Lost enquiries & reasons',
  payments: 'Client balances due',
  suppliers: 'Supplier response',
} as const;
export type ReportKey = keyof typeof REPORTS;

export async function runReport(key: ReportKey, from: string, to: string, periodLabel: string): Promise<Report> {
  const sql = db();
  const sub = `Enquiries received ${periodLabel} (${fmtDate(from)} – ${fmtDate(to)})`;
  const inRange = { from, to };
  switch (key) {
    case 'funnel': {
      const rows = await sql<{ stage: string; leads: number; value: string }>`
        select stage, count(*)::int as leads, coalesce(sum(quote_amount), 0)::text as value
        from crm.v_lead where deleted_at is null and (created_at at time zone 'Asia/Kolkata')::date between ${inRange.from}::date and ${inRange.to}::date
        group by stage`;
      const by = new Map(rows.map((r) => [r.stage, r]));
      const total = rows.reduce((a, r) => a + r.leads, 0);
      return {
        key, title: REPORTS[key], subtitle: sub,
        columns: [{ key: 'stage', label: 'Stage' }, { key: 'leads', label: 'Enquiries', kind: 'int', total: true },
          { key: 'share', label: 'Share', kind: 'pct' }, { key: 'value', label: 'Quoted value', kind: 'money', total: true }],
        rows: [...STAGES, 'lost' as const].map((s) => {
          const r = by.get(s);
          return { stage: STAGE_LABEL[s as Status], leads: r?.leads ?? 0, share: total ? Math.round(((r?.leads ?? 0) / total) * 100) : 0, value: r?.value ?? '0.00' };
        }),
      };
    }
    case 'sources': {
      const rows = await sql`
        select coalesce(lead_source, 'Not set') as source, count(*)::int as leads,
               count(*) filter (where crm.stage_rank(stage) >= 6)::int as won, count(*) filter (where stage = 'lost')::int as lost,
               coalesce(sum(quote_amount) filter (where crm.stage_rank(stage) >= 6), 0)::text as won_value
        from crm.v_lead where deleted_at is null and (created_at at time zone 'Asia/Kolkata')::date between ${from}::date and ${to}::date
        group by 1 order by 2 desc`;
      return {
        key, title: REPORTS[key], subtitle: sub,
        columns: [{ key: 'source', label: 'Source' }, { key: 'leads', label: 'Enquiries', kind: 'int', total: true }, { key: 'won', label: 'Booked', kind: 'int', total: true },
          { key: 'lost', label: 'Lost', kind: 'int', total: true }, { key: 'conversion', label: 'Conversion', kind: 'pct' }, { key: 'won_value', label: 'Booked value', kind: 'money', total: true }],
        rows: rows.map((r) => ({ ...r, conversion: r.leads ? Math.round((r.won / r.leads) * 100) : 0 })),
      };
    }
    case 'destinations': {
      const rows = await sql`
        select initcap(destination) as destination, count(*)::int as leads, count(*) filter (where crm.stage_rank(stage) >= 6)::int as won,
               coalesce(sum(quote_amount) filter (where crm.stage_rank(stage) >= 6), 0)::text as won_value,
               coalesce(sum(margin) filter (where crm.stage_rank(stage) >= 6), 0)::text as margin
        from crm.v_lead where deleted_at is null and (created_at at time zone 'Asia/Kolkata')::date between ${from}::date and ${to}::date
        group by initcap(destination) order by 2 desc, 1`;
      return {
        key, title: REPORTS[key], subtitle: sub,
        columns: [{ key: 'destination', label: 'Destination' }, { key: 'leads', label: 'Enquiries', kind: 'int', total: true }, { key: 'won', label: 'Booked', kind: 'int', total: true },
          { key: 'conversion', label: 'Conversion', kind: 'pct' }, { key: 'won_value', label: 'Booked value', kind: 'money', total: true }, { key: 'margin', label: 'Margin (selected supplier)', kind: 'money', total: true }],
        rows: rows.map((r) => ({ ...r, conversion: r.leads ? Math.round((r.won / r.leads) * 100) : 0 })),
      };
    }
    case 'monthly': {
      const rows = await sql`
        with m as (select to_char(d, 'YYYY-MM') as month from generate_series(date_trunc('month', ${from}::date), date_trunc('month', ${to}::date), interval '1 month') d)
        select m.month,
          (select count(*) from crm.lead l where l.deleted_at is null and to_char(l.created_at at time zone 'Asia/Kolkata', 'YYYY-MM') = m.month)::int as enquiries,
          (select count(*) from crm.lead l where l.deleted_at is null and to_char(l.confirmed_at at time zone 'Asia/Kolkata', 'YYYY-MM') = m.month)::int as confirmed,
          (select coalesce(sum(quote_amount), 0) from crm.lead l where l.deleted_at is null and to_char(l.confirmed_at at time zone 'Asia/Kolkata', 'YYYY-MM') = m.month)::text as value,
          (select count(*) from crm.lead l where l.deleted_at is null and l.status = 'lost' and to_char(l.closed_at at time zone 'Asia/Kolkata', 'YYYY-MM') = m.month)::int as lost
        from m order by m.month limit 120`;
      return {
        key, title: REPORTS[key], subtitle: `${periodLabel} (${fmtDate(from)} – ${fmtDate(to)})`,
        columns: [{ key: 'month', label: 'Month' }, { key: 'enquiries', label: 'New enquiries', kind: 'int', total: true }, { key: 'confirmed', label: 'Bookings confirmed', kind: 'int', total: true },
          { key: 'lost', label: 'Lost', kind: 'int', total: true }, { key: 'value', label: 'Booked value', kind: 'money', total: true }],
        rows,
      };
    }
    case 'lost': {
      const rows = await sql`
        select lead_no, client_name, destination, coalesce(lead_source, '') as source, lost_reason, (closed_at at time zone 'Asia/Kolkata')::date::text as closed_on, quote_amount::text
        from crm.v_lead where deleted_at is null and stage = 'lost' and (created_at at time zone 'Asia/Kolkata')::date between ${from}::date and ${to}::date
        order by closed_at desc nulls last`;
      return {
        key, title: REPORTS[key], subtitle: sub,
        columns: [{ key: 'lead_no', label: 'Enquiry' }, { key: 'client_name', label: 'Client' }, { key: 'destination', label: 'Destination' }, { key: 'source', label: 'Source' },
          { key: 'lost_reason', label: 'Reason' }, { key: 'closed_on', label: 'Closed', kind: 'date' }, { key: 'quote_amount', label: 'Quoted', kind: 'money', total: true }],
        rows,
      };
    }
    case 'payments': {
      const rows = await sql`
        select lead_no, client_name, destination, booking_ref, travel_start::text, quote_amount::text, paid::text, balance_due::text, last_paid_on::text
        from crm.v_lead where deleted_at is null and crm.stage_rank(stage) >= 6 and balance_due > 0 order by travel_start nulls last`;
      return {
        key, title: REPORTS[key], subtitle: 'All confirmed bookings with money still to receive (not limited to the period)',
        columns: [{ key: 'lead_no', label: 'Enquiry' }, { key: 'client_name', label: 'Client' }, { key: 'destination', label: 'Destination' }, { key: 'booking_ref', label: 'Booking ref' },
          { key: 'travel_start', label: 'Travel', kind: 'date' }, { key: 'quote_amount', label: 'Package', kind: 'money', total: true }, { key: 'paid', label: 'Received', kind: 'money', total: true },
          { key: 'balance_due', label: 'Balance due', kind: 'money', total: true }, { key: 'last_paid_on', label: 'Last payment', kind: 'date' }],
        rows,
      };
    }
    case 'suppliers': {
      const rows = await sql`
        select s.name as supplier, count(q.id)::int as requests, count(q.id) filter (where q.status in ('received','selected'))::int as quoted,
               count(q.id) filter (where q.status = 'selected')::int as selected,
               round(avg(extract(epoch from (q.received_at - q.requested_at)) / 3600) filter (where q.received_at is not null))::int as avg_hours
        from crm.supplier s join crm.supplier_quote q on q.supplier_id = s.id join crm.lead l on l.id = q.lead_id
        where l.deleted_at is null and (q.requested_at at time zone 'Asia/Kolkata')::date between ${from}::date and ${to}::date
        group by s.name order by 2 desc`;
      return {
        key, title: REPORTS[key], subtitle: `Rate requests sent ${periodLabel}`,
        columns: [{ key: 'supplier', label: 'Supplier' }, { key: 'requests', label: 'Requests', kind: 'int', total: true }, { key: 'quoted', label: 'Quoted', kind: 'int', total: true },
          { key: 'response', label: 'Response rate', kind: 'pct' }, { key: 'selected', label: 'Selected', kind: 'int', total: true }, { key: 'avg_hours', label: 'Avg reply time (hrs)', kind: 'int' }],
        rows: rows.map((r) => ({ ...r, response: r.requests ? Math.round((r.quoted / r.requests) * 100) : 0, avg_hours: r.avg_hours ?? '' })),
      };
    }
    case 'register':
    default: {
      const rows = await sql`
        select lead_no, (created_at at time zone 'Asia/Kolkata')::date::text as received, client_name, phone, coalesce(lead_source, '') as source, destination,
               travel_start::text, travel_end::text, (adults + children + infants)::int as pax, nights_plan, package_type, hotel_category,
               stage, quote_amount::text, paid::text, balance_due::text, next_follow_up::text
        from crm.v_lead where deleted_at is null and (created_at at time zone 'Asia/Kolkata')::date between ${from}::date and ${to}::date
        order by created_at desc`;
      return {
        key: 'register', title: REPORTS.register, subtitle: sub,
        columns: [{ key: 'lead_no', label: 'Enquiry' }, { key: 'received', label: 'Received', kind: 'date' }, { key: 'client_name', label: 'Client' }, { key: 'phone', label: 'Phone' },
          { key: 'source', label: 'Source' }, { key: 'destination', label: 'Destination' }, { key: 'travel_start', label: 'From', kind: 'date' }, { key: 'travel_end', label: 'To', kind: 'date' },
          { key: 'pax', label: 'Pax', kind: 'int', total: true }, { key: 'nights_plan', label: 'Nights' }, { key: 'package', label: 'Package' }, { key: 'hotel_category', label: 'Hotel' },
          { key: 'stage_label', label: 'Stage' }, { key: 'quote_amount', label: 'Quoted', kind: 'money', total: true }, { key: 'paid', label: 'Received', kind: 'money', total: true },
          { key: 'balance_due', label: 'Balance', kind: 'money', total: true }, { key: 'next_follow_up', label: 'Follow-up', kind: 'date' }],
        rows: rows.map((r) => ({ ...r, stage_label: STAGE_LABEL[r.stage as Status], package: r.package_type ? (PACKAGE_LABEL[r.package_type] ?? r.package_type) : '' })),
      };
    }
  }
}
