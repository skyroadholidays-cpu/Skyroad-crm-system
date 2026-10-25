// CRM data layer: enquiries (leads), suppliers, supplier quotes, client
// payments, the activity timeline and the automatic stage rules.
// House rules (see sql-types.ts): every value is cast, dates/money come back as text.
import { db, withTx, inSeries, UserError } from './db-core';
import type { Sql } from './sql-types';
import { parseAmount, parsePositiveAmount, inr } from './money';
import { isIsoDate, todayIST, addDays } from './dates';
import {
  STAGE_LABEL, isStatus, stageRank, INCLUSIONS, PACKAGE_LABEL, PAYMENT_KINDS, QUOTE_STATUS, CHANNELS, LOGGABLE,
  type Status, type QuoteStatus,
} from './constants';

export type Getter = (key: string) => string | undefined;

// ───────────────────────────── types ─────────────────────────────

export interface LeadRow {
  id: number; lead_no: string; status: Status; stage: Status; priority: 'hot' | 'normal' | 'cold';
  client_name: string; phone: string | null; email: string | null; city: string | null; lead_source: string | null;
  destination: string; trip_type: string | null; travel_start: string | null; travel_end: string | null; flexible_dates: boolean;
  adults: number; children: number; child_ages: string | null; infants: number; pax: number; nights: number | null;
  nights_plan: string | null; hotel_category: string | null; package_type: string | null; inclusions: string[];
  budget: string | null; budget_basis: 'total' | 'per_person'; requirements: string | null; rooms: number | null; meal_plan: string | null;
  quote_amount: string | null; itinerary_url: string | null; quote_shared_at: string | null;
  booking_ref: string | null; confirmed_at: string | null; next_follow_up: string | null; follow_up_note: string | null;
  lost_reason: string | null; closed_at: string | null; notes: string | null;
  created_at: string; updated_at: string; created_by: string | null; updated_by: string | null; deleted_at: string | null;
  paid: string; advance_paid: string; last_paid_on: string | null; balance_due: string | null;
  quotes_requested: number; quotes_received: number; best_quote: string | null; supplier_cost: string | null;
  selected_supplier: string | null; margin: string | null; last_activity_at: string | null; follow_up_overdue: boolean;
}

// One place that lists the columns with the casts both drivers need.
const LEAD_COLS = (a: string) => `
  ${a}.id, ${a}.lead_no, ${a}.status, ${a}.stage, ${a}.priority, ${a}.client_name, ${a}.phone, ${a}.email, ${a}.city, ${a}.lead_source,
  ${a}.destination, ${a}.trip_type, ${a}.travel_start::text, ${a}.travel_end::text, ${a}.flexible_dates,
  ${a}.adults, ${a}.children, ${a}.child_ages, ${a}.infants, ${a}.pax::int, ${a}.nights::int,
  ${a}.nights_plan, ${a}.hotel_category, ${a}.package_type, to_jsonb(${a}.inclusions) as inclusions,
  ${a}.budget::text, ${a}.budget_basis, ${a}.requirements, ${a}.rooms, ${a}.meal_plan, ${a}.quote_amount::text, ${a}.itinerary_url, ${a}.quote_shared_at::text,
  ${a}.booking_ref, ${a}.confirmed_at::text, ${a}.next_follow_up::text, ${a}.follow_up_note, ${a}.lost_reason, ${a}.closed_at::text, ${a}.notes,
  ${a}.created_at::text, ${a}.updated_at::text, ${a}.created_by, ${a}.updated_by, ${a}.deleted_at::text,
  ${a}.paid::text, ${a}.advance_paid::text, ${a}.last_paid_on::text, ${a}.balance_due::text,
  ${a}.quotes_requested::int, ${a}.quotes_received::int, ${a}.best_quote::text, ${a}.supplier_cost::text, ${a}.selected_supplier,
  ${a}.margin::text, ${a}.last_activity_at::text, ${a}.follow_up_overdue`;

/** Runs a query with the lead column list spliced in (column list is a constant, never user input). */
async function selectLeads(sql: Sql, where: string, params: unknown[], tail = ''): Promise<LeadRow[]> {
  const text = `select ${LEAD_COLS('l')} from crm.v_lead l where ${where} ${tail}`;
  // "$n" placeholders may repeat; each occurrence becomes its own bound value
  const parts = text.split(/\$\d+/);
  const values = [...text.matchAll(/\$(\d+)/g)].map((m) => params[Number(m[1]) - 1]);
  const strings = Object.assign([...parts], { raw: [...parts] }) as unknown as TemplateStringsArray;
  return sql<LeadRow>(strings, ...values);
}

// ───────────────────────────── helpers ─────────────────────────────

const text = (v: string | undefined, max = 2000) => {
  const s = (v ?? '').trim();
  return s ? s.slice(0, max) : null;
};
const intIn = (v: string | undefined, def: number, label: string) => {
  const s = (v ?? '').trim();
  if (!s) return def;
  if (!/^\d{1,3}$/.test(s)) throw new UserError(`${label} must be a whole number.`);
  return Number(s);
};
const dateOrNull = (v: string | undefined, label: string) => {
  const s = (v ?? '').trim();
  if (!s) return null;
  if (!isIsoDate(s)) throw new UserError(`${label} is not a valid date.`);
  return s;
};

async function log(tx: Sql, leadId: number, kind: string, body: string, actor: string | null, meta?: object) {
  await tx`insert into crm.activity (lead_id, kind, body, actor, meta)
           values (${leadId}::int, ${kind}::text, ${body}::text, ${actor}::text, ${meta ? JSON.stringify(meta) : null}::text::jsonb)`;
}

/**
 * Moves a lead forward to `to` if it is currently at an earlier stage.
 * Never moves backwards and never touches lost leads. Returns true if moved.
 */
async function advance(tx: Sql, leadId: number, to: Status, actor: string, why: string): Promise<boolean> {
  const [l] = await tx<{ status: Status }>`select status from crm.lead where id = ${leadId}::int for update`;
  if (!l || l.status === 'lost' || stageRank(l.status) >= stageRank(to)) return false;
  await tx`update crm.lead set status = ${to}::text, updated_by = ${actor}::text,
             confirmed_at = case when crm.stage_rank(${to}::text) >= 6 then coalesce(confirmed_at, now()) else confirmed_at end
           where id = ${leadId}::int`;
  await log(tx, leadId, 'stage', `Stage → ${STAGE_LABEL[to]} (automatic: ${why})`, actor, { from: l.status, to, auto: true });
  return true;
}

// ───────────────────────────── leads ─────────────────────────────

export interface LeadInput {
  client_name: string; phone: string | null; email: string | null; city: string | null; lead_source: string | null;
  priority: 'hot' | 'normal' | 'cold';
  destination: string; trip_type: string | null; travel_start: string | null; travel_end: string | null; flexible_dates: boolean;
  adults: number; children: number; child_ages: string | null; infants: number;
  nights_plan: string | null; hotel_category: string | null; package_type: string | null; inclusions: string[];
  budget: string | null; budget_basis: 'total' | 'per_person'; requirements: string | null;
  rooms: number | null; meal_plan: string | null;
  next_follow_up: string | null; follow_up_note: string | null; notes: string | null;
}

export function parseLeadInput(get: Getter, getAll: (k: string) => string[] = () => []): LeadInput {
  const client_name = text(get('client_name'), 120);
  if (!client_name) throw new UserError('Enter the client name.');
  const destination = text(get('destination'), 120);
  if (!destination) throw new UserError('Enter the destination.');
  const email = text(get('email'), 200);
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new UserError('That email address does not look right.');
  const phone = text(get('phone'), 30);
  if (phone && phone.replace(/\D/g, '').length < 8) throw new UserError('That phone number looks too short.');
  const travel_start = dateOrNull(get('travel_start'), 'Travel start');
  const travel_end = dateOrNull(get('travel_end'), 'Travel end');
  if (travel_start && travel_end && travel_end < travel_start) throw new UserError('Travel end date cannot be before the start date.');
  if (travel_end && !travel_start) throw new UserError('Add the travel start date too.');
  const adults = intIn(get('adults'), 2, 'Adults');
  const children = intIn(get('children'), 0, 'Children');
  const infants = intIn(get('infants'), 0, 'Infants');
  if (adults + children + infants === 0) throw new UserError('Add at least one traveller.');
  const trip = get('trip_type');
  const pkg = get('package_type');
  const priority = get('priority');
  let budget: string | null = null;
  const b = (get('budget') ?? '').trim();
  if (b) {
    budget = parseAmount(b);
    if (budget === null) throw new UserError('Budget is not a valid amount.');
  }
  // inclusions arrive either as repeated checkboxes or one comma list
  const raw = getAll('inclusions').length ? getAll('inclusions') : (get('inclusions') ?? '').split(',');
  const inclusions = [...new Set(raw.map((s) => s.trim()).filter(Boolean))].slice(0, 30).map((s) => s.slice(0, 60));
  return {
    client_name, phone, email, city: text(get('city'), 80), lead_source: text(get('lead_source'), 60),
    priority: priority === 'hot' || priority === 'cold' ? priority : 'normal',
    destination, trip_type: trip === 'domestic' || trip === 'international' ? trip : null,
    travel_start, travel_end, flexible_dates: get('flexible_dates') === 'on' || get('flexible_dates') === 'true',
    adults, children, child_ages: children ? text(get('child_ages'), 80) : null, infants,
    nights_plan: text(get('nights_plan'), 300), hotel_category: text(get('hotel_category'), 60),
    package_type: pkg && pkg in PACKAGE_LABEL ? pkg : null, inclusions,
    budget, budget_basis: get('budget_basis') === 'per_person' ? 'per_person' : 'total',
    requirements: text(get('requirements'), 2000),
    rooms: (get('rooms') ?? '').trim() ? (intIn(get('rooms'), 0, 'Rooms') || null) : null,
    meal_plan: text(get('meal_plan'), 40),
    next_follow_up: dateOrNull(get('next_follow_up'), 'Follow-up date'), follow_up_note: text(get('follow_up_note'), 300),
    notes: text(get('notes'), 4000),
  };
}

export async function createLead(actor: string, i: LeadInput, idem?: string | null): Promise<{ id: number; lead_no: string; duplicate?: boolean }> {
  if (idem) {
    const [dup] = await db()<{ id: number; lead_no: string }>`select id, lead_no from crm.lead where idempotency_key = ${idem}::text`;
    if (dup) return { ...dup, duplicate: true };
  }
  return withTx(actor, async (tx) => {
    const [r] = await tx<{ id: number; lead_no: string }>`
      insert into crm.lead (client_name, phone, email, city, lead_source, priority, destination, trip_type, travel_start, travel_end,
        flexible_dates, adults, children, child_ages, infants, nights_plan, hotel_category, package_type, inclusions,
        budget, budget_basis, requirements, rooms, meal_plan, next_follow_up, follow_up_note, notes, idempotency_key, created_by, updated_by)
      values (${i.client_name}::text, ${i.phone}::text, ${i.email}::text, ${i.city}::text, ${i.lead_source}::text, ${i.priority}::text,
        ${i.destination}::text, ${i.trip_type}::text, ${i.travel_start}::date, ${i.travel_end}::date, ${i.flexible_dates}::boolean,
        ${i.adults}::int, ${i.children}::int, ${i.child_ages}::text, ${i.infants}::int, ${i.nights_plan}::text, ${i.hotel_category}::text,
        ${i.package_type}::text, string_to_array(${i.inclusions.join('\u001f')}::text, chr(31)),
        ${i.budget}::numeric, ${i.budget_basis}::text, ${i.requirements}::text, ${i.rooms}::int, ${i.meal_plan}::text, ${i.next_follow_up}::date, ${i.follow_up_note}::text,
        ${i.notes}::text, ${idem ?? null}::text, ${actor}::text, ${actor}::text)
      returning id, lead_no`;
    await log(tx, r.id, 'stage', `Enquiry created – ${i.destination}`, actor, { to: 'new_query' });
    return r;
  });
}

export async function updateLead(actor: string, id: number, i: LeadInput): Promise<void> {
  await withTx(actor, async (tx) => {
    const rows = await tx`
      update crm.lead set client_name = ${i.client_name}::text, phone = ${i.phone}::text, email = ${i.email}::text, city = ${i.city}::text,
        lead_source = ${i.lead_source}::text, priority = ${i.priority}::text, destination = ${i.destination}::text, trip_type = ${i.trip_type}::text,
        travel_start = ${i.travel_start}::date, travel_end = ${i.travel_end}::date, flexible_dates = ${i.flexible_dates}::boolean,
        adults = ${i.adults}::int, children = ${i.children}::int, child_ages = ${i.child_ages}::text, infants = ${i.infants}::int,
        nights_plan = ${i.nights_plan}::text, hotel_category = ${i.hotel_category}::text, package_type = ${i.package_type}::text,
        inclusions = string_to_array(${i.inclusions.join('\u001f')}::text, chr(31)),
        budget = ${i.budget}::numeric, budget_basis = ${i.budget_basis}::text, requirements = ${i.requirements}::text,
        rooms = ${i.rooms}::int, meal_plan = ${i.meal_plan}::text,
        next_follow_up = ${i.next_follow_up}::date, follow_up_note = ${i.follow_up_note}::text, notes = ${i.notes}::text,
        updated_by = ${actor}::text
      where id = ${id}::int and deleted_at is null returning id`;
    if (!rows.length) throw new UserError('This enquiry no longer exists.');
    await log(tx, id, 'system', 'Enquiry details edited', actor);
  });
}

export async function getLead(id: number): Promise<LeadRow | null> {
  const [l] = await selectLeads(db(), 'l.id = $1::int', [id]);
  return l ?? null;
}

export interface LeadFilter {
  stage?: string; q?: string; source?: string; priority?: string; scope?: 'open' | 'won' | 'lost' | 'all'; month?: string;
  sort?: 'recent' | 'travel' | 'follow';
}

export async function listLeads(f: LeadFilter = {}, limit = 300): Promise<LeadRow[]> {
  const where: string[] = ['l.deleted_at is null'];
  const params: unknown[] = [];
  const p = (v: unknown, cast: string) => { params.push(v); return `$${params.length}::${cast}`; };
  if (f.stage && isStatus(f.stage)) where.push(`l.stage = ${p(f.stage, 'text')}`);
  if (f.scope === 'open') where.push(`crm.stage_rank(l.stage) between 1 and 5`);
  if (f.scope === 'won') where.push(`crm.stage_rank(l.stage) >= 6`);
  if (f.scope === 'lost') where.push(`l.stage = 'lost'`);
  if (f.source) where.push(`l.lead_source = ${p(f.source, 'text')}`);
  if (f.priority) where.push(`l.priority = ${p(f.priority, 'text')}`);
  if (f.month && /^\d{4}-\d{2}$/.test(f.month)) where.push(`to_char(l.created_at at time zone 'Asia/Kolkata', 'YYYY-MM') = ${p(f.month, 'text')}`);
  if (f.q?.trim()) {
    const like = p(`%${f.q.trim().replace(/[%_\\]/g, (c) => '\\' + c)}%`, 'text');
    where.push(`(l.lead_no ilike ${like} or l.client_name ilike ${like} or l.destination ilike ${like} or l.phone ilike ${like}
      or l.email ilike ${like} or l.booking_ref ilike ${like} or l.nights_plan ilike ${like} or l.city ilike ${like}
      or exists (select 1 from crm.supplier_quote sq join crm.supplier s on s.id = sq.supplier_id where sq.lead_id = l.id and s.name ilike ${like}))`);
  }
  const order = f.sort === 'travel' ? 'l.travel_start asc nulls last, l.id desc'
    : f.sort === 'follow' ? 'l.next_follow_up asc nulls last, l.id desc'
    : 'l.created_at desc, l.id desc';
  return selectLeads(db(), where.join(' and '), params, `order by ${order} limit ${Math.min(Math.max(limit, 1), 2000)}`);
}

/** Manual stage change from the lead page or pipeline. */
export async function setStage(actor: string, id: number, to: string, note?: string | null, lostReason?: string | null): Promise<void> {
  if (!isStatus(to)) throw new UserError('Choose a valid stage.');
  if (to === 'lost' && !lostReason?.trim()) throw new UserError('Say why it was lost (e.g. price, dates changed, booked elsewhere).');
  await withTx(actor, async (tx) => {
    const [l] = await tx<{ status: Status }>`select status from crm.lead where id = ${id}::int and deleted_at is null for update`;
    if (!l) throw new UserError('This enquiry no longer exists.');
    if (l.status === to) return;
    await tx`update crm.lead set status = ${to}::text, updated_by = ${actor}::text,
               lost_reason = case when ${to}::text = 'lost' then ${lostReason?.trim() ?? null}::text else null end,
               closed_at = case when ${to}::text in ('lost', 'completed') then now() else null end,
               confirmed_at = case when crm.stage_rank(${to}::text) >= 6 then coalesce(confirmed_at, now()) else confirmed_at end,
               quote_shared_at = case when crm.stage_rank(${to}::text) >= 4 then coalesce(quote_shared_at, now()) else quote_shared_at end
             where id = ${id}::int`;
    const body = `Stage → ${STAGE_LABEL[to]}${to === 'lost' ? ` – ${lostReason!.trim()}` : ''}${note?.trim() ? ` · ${note.trim()}` : ''}`;
    await log(tx, id, 'stage', body, actor, { from: l.status, to });
  });
}

export async function softDeleteLead(actor: string, id: number) {
  await withTx(actor, async (tx) => {
    const rows = await tx`update crm.lead set deleted_at = now(), deleted_by = ${actor}::text where id = ${id}::int and deleted_at is null returning id`;
    if (!rows.length) throw new UserError('Already deleted.');
  });
}
export async function restoreLead(actor: string, id: number) {
  await withTx(actor, async (tx) => {
    const rows = await tx`update crm.lead set deleted_at = null, deleted_by = null where id = ${id}::int and deleted_at is not null returning id`;
    if (!rows.length) throw new UserError('Nothing to restore.');
    await log(tx, id, 'system', 'Enquiry restored', actor);
  });
}
/** Removes an enquiry for good. Only works on enquiries already in the Trash. */
export async function purgeLead(actor: string, id: number) {
  await withTx(actor, async (tx) => {
    const rows = await tx<{ lead_no: string }>`delete from crm.lead where id = ${id}::int and deleted_at is not null returning lead_no`;
    if (!rows.length) throw new UserError('Move the enquiry to Trash first (Delete), then use Delete forever.');
  });
}
export async function listDeletedLeads(limit = 50) {
  return db()<{ id: number; lead_no: string; client_name: string; destination: string; deleted_at: string; deleted_by: string | null }>`
    select id, lead_no, client_name, destination, deleted_at::text, deleted_by from crm.lead where deleted_at is not null
    order by deleted_at desc limit ${limit}::int`;
}

// ───────────────────────────── activity & follow-ups ─────────────────────────────

export interface ActivityRow { id: string; lead_id: number; kind: string; body: string; at: string; actor: string | null; meta: any }

export async function listActivity(leadId: number) {
  return db()<ActivityRow>`select id::text, lead_id, kind, body, at::text, actor, meta from crm.activity where lead_id = ${leadId}::int order by at desc, id desc`;
}

export async function recentActivity(limit = 12) {
  return db()<ActivityRow & { lead_no: string; client_name: string; destination: string }>`
    select a.id::text, a.lead_id, a.kind, a.body, a.at::text, a.actor, a.meta, l.lead_no, l.client_name, l.destination
    from crm.activity a join crm.lead l on l.id = a.lead_id where l.deleted_at is null
    order by a.at desc, a.id desc limit ${limit}::int`;
}

/**
 * Logs a call / WhatsApp / email / meeting / note and optionally sets the
 * next follow-up. Talking to the client after the quote went out moves the
 * lead to "Follow-up" automatically.
 */
export async function logInteraction(actor: string, leadId: number, get: Getter): Promise<void> {
  const kind = get('kind') ?? 'note';
  if (!(LOGGABLE as readonly string[]).includes(kind)) throw new UserError('Choose what happened.');
  const body = text(get('body'), 4000);
  if (!body) throw new UserError('Write a short note about it.');
  const next = dateOrNull(get('next_follow_up'), 'Next follow-up');
  const clear = get('clear_follow_up') === 'on';
  await withTx(actor, async (tx) => {
    const [l] = await tx<{ status: Status }>`select status from crm.lead where id = ${leadId}::int and deleted_at is null for update`;
    if (!l) throw new UserError('This enquiry no longer exists.');
    await log(tx, leadId, kind, body, actor);
    if (next || clear) {
      await tx`update crm.lead set next_follow_up = ${next}::date, follow_up_note = ${next ? text(get('follow_up_note'), 300) : null}::text,
                 updated_by = ${actor}::text where id = ${leadId}::int`;
    }
    if (kind !== 'note' && l.status === 'quote_shared') await advance(tx, leadId, 'follow_up', actor, `${kind} with client after quote`);
  });
}

export async function setFollowUp(actor: string, leadId: number, date: string | null, note: string | null) {
  if (date && !isIsoDate(date)) throw new UserError('Choose a valid follow-up date.');
  await withTx(actor, async (tx) => {
    const rows = await tx`update crm.lead set next_follow_up = ${date}::date, follow_up_note = ${date ? note : null}::text, updated_by = ${actor}::text
                          where id = ${leadId}::int and deleted_at is null returning id`;
    if (!rows.length) throw new UserError('This enquiry no longer exists.');
    await log(tx, leadId, 'follow_up', date ? `Follow-up set for ${date}${note ? ` – ${note}` : ''}` : 'Follow-up cleared', actor);
  });
}

// ───────────────────────────── suppliers ─────────────────────────────

export interface SupplierRow {
  id: number; name: string; contact_person: string | null; email: string | null; phone: string | null; whatsapp: string | null;
  destinations: string | null; services: string | null; notes: string | null; is_active: boolean;
  requests: number; quotes: number; selected: number; last_request_at: string | null;
}

export async function listSuppliers(includeInactive = true): Promise<SupplierRow[]> {
  return db()<SupplierRow>`
    select s.id, s.name, s.contact_person, s.email, s.phone, s.whatsapp, s.destinations, s.services, s.notes, s.is_active,
           count(q.id)::int as requests,
           count(q.id) filter (where q.status in ('received','selected'))::int as quotes,
           count(q.id) filter (where q.status = 'selected')::int as selected,
           max(q.requested_at)::text as last_request_at
    from crm.supplier s left join crm.supplier_quote q on q.supplier_id = s.id
    where ${includeInactive}::boolean or s.is_active
    group by s.id order by s.is_active desc, lower(s.name)`;
}

export async function getSupplier(id: number) {
  const [s] = (await listSuppliers()).filter((x) => x.id === id);
  return s ?? null;
}

export async function saveSupplier(actor: string, get: Getter): Promise<number> {
  const name = text(get('name'), 120);
  if (!name) throw new UserError('Enter the supplier name.');
  const email = text(get('email'), 200);
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new UserError('That email address does not look right.');
  const id = Number(get('id') ?? 0);
  const v = {
    name, email, contact_person: text(get('contact_person'), 80), phone: text(get('phone'), 30), whatsapp: text(get('whatsapp'), 30),
    destinations: text(get('destinations'), 300), services: text(get('services'), 300), notes: text(get('notes'), 2000),
  };
  return withTx(actor, async (tx) => {
    if (id) {
      const rows = await tx<{ id: number }>`
        update crm.supplier set name = ${v.name}::text, email = ${v.email}::text, contact_person = ${v.contact_person}::text,
          phone = ${v.phone}::text, whatsapp = ${v.whatsapp}::text, destinations = ${v.destinations}::text,
          services = ${v.services}::text, notes = ${v.notes}::text
        where id = ${id}::int returning id`;
      if (!rows.length) throw new UserError('Supplier not found.');
      return id;
    }
    const [r] = await tx<{ id: number }>`
      insert into crm.supplier (name, email, contact_person, phone, whatsapp, destinations, services, notes)
      values (${v.name}::text, ${v.email}::text, ${v.contact_person}::text, ${v.phone}::text, ${v.whatsapp}::text,
              ${v.destinations}::text, ${v.services}::text, ${v.notes}::text) returning id`;
    return r.id;
  });
}

/** Deletes a supplier for good. Suppliers already used on enquiries are kept (hide them instead) so that history stays complete. */
export async function deleteSupplier(actor: string, id: number) {
  await withTx(actor, async (tx) => {
    const [s] = await tx<{ name: string; n: number }>`
      select s.name, (select count(*)::int from crm.supplier_quote q where q.supplier_id = s.id) as n from crm.supplier s where s.id = ${id}::int`;
    if (!s) throw new UserError('Supplier not found.');
    if (s.n > 0) throw new UserError(`${s.name} is on ${s.n} enquir${s.n === 1 ? 'y' : 'ies'}, so deleting would erase that quote history. Use “Hide supplier” instead – hidden suppliers get no new requests.`);
    await tx`delete from crm.supplier where id = ${id}::int`;
  });
}
export async function setSupplierActive(actor: string, id: number, active: boolean) {
  await withTx(actor, (tx) => tx`update crm.supplier set is_active = ${active}::boolean where id = ${id}::int`);
}

// ───────────────────────────── supplier quotes ─────────────────────────────

export interface QuoteRow {
  id: number; lead_id: number; supplier_id: number; supplier_name: string; contact_person: string | null; email: string | null;
  phone: string | null; whatsapp: string | null; channel: string; requested_at: string; status: QuoteStatus; amount: string | null;
  currency: string; received_at: string | null; valid_until: string | null; notes: string | null;
}

export async function listQuotes(leadId: number): Promise<QuoteRow[]> {
  return db()<QuoteRow>`
    select q.id, q.lead_id, q.supplier_id, s.name as supplier_name, s.contact_person, s.email, s.phone, s.whatsapp, q.channel,
           q.requested_at::text, q.status, q.amount::text, q.currency, q.received_at::text, q.valid_until::text, q.notes
    from crm.supplier_quote q join crm.supplier s on s.id = q.supplier_id
    where q.lead_id = ${leadId}::int order by (q.status = 'selected') desc, q.amount asc nulls last, q.requested_at`;
}

export async function listQuotesForSupplier(supplierId: number) {
  return db()<QuoteRow & { lead_no: string; client_name: string; destination: string; travel_start: string | null }>`
    select q.id, q.lead_id, q.supplier_id, s.name as supplier_name, s.contact_person, s.email, s.phone, s.whatsapp, q.channel,
           q.requested_at::text, q.status, q.amount::text, q.currency, q.received_at::text, q.valid_until::text, q.notes,
           l.lead_no, l.client_name, l.destination, l.travel_start::text
    from crm.supplier_quote q join crm.supplier s on s.id = q.supplier_id join crm.lead l on l.id = q.lead_id
    where q.supplier_id = ${supplierId}::int and l.deleted_at is null order by q.requested_at desc`;
}

/** Records that you asked one or more suppliers for rates. New query → Supplier mail sent. */
export async function requestQuotes(actor: string, leadId: number, supplierIds: number[], channel: string): Promise<number> {
  const ids = [...new Set(supplierIds.filter((n) => Number.isInteger(n) && n > 0))];
  if (!ids.length) throw new UserError('Choose at least one supplier.');
  if (!(channel in CHANNELS)) throw new UserError('Choose how you sent it.');
  return withTx(actor, async (tx) => {
    const [l] = await tx`select id from crm.lead where id = ${leadId}::int and deleted_at is null`;
    if (!l) throw new UserError('This enquiry no longer exists.');
    let added = 0;
    for (const sid of ids) {
      const [s] = await tx<{ name: string }>`select name from crm.supplier where id = ${sid}::int`;
      if (!s) throw new UserError('One of the suppliers no longer exists.');
      const rows = await tx`insert into crm.supplier_quote (lead_id, supplier_id, channel) values (${leadId}::int, ${sid}::int, ${channel}::text)
                            on conflict (lead_id, supplier_id) do update set requested_at = now(), channel = excluded.channel,
                              status = case when crm.supplier_quote.status = 'declined' then 'requested' else crm.supplier_quote.status end
                            returning (xmax = 0) as inserted`;
      if (rows[0]?.inserted) added++;
      await log(tx, leadId, 'supplier', `Rate request sent to ${s.name} by ${CHANNELS[channel as keyof typeof CHANNELS]}`, actor, { supplier_id: sid });
    }
    await advance(tx, leadId, 'supplier_mailed', actor, 'supplier request sent');
    return added;
  });
}

/** Saves a supplier's reply. Any received quote moves the lead to "Quote received". */
export async function updateQuote(actor: string, quoteId: number, get: Getter): Promise<void> {
  const status = get('status') as QuoteStatus;
  if (!(status in QUOTE_STATUS)) throw new UserError('Choose the quote status.');
  let amount: string | null = null;
  const a = (get('amount') ?? '').trim();
  if (a) {
    amount = parsePositiveAmount(a);
    if (!amount) throw new UserError('Enter the quoted amount (more than zero).');
  }
  if ((status === 'received' || status === 'selected') && !amount) throw new UserError('Enter the quoted amount.');
  const currency = ((get('currency') ?? 'INR').trim().toUpperCase() || 'INR');
  if (!/^[A-Z]{3}$/.test(currency)) throw new UserError('Currency must be a 3-letter code, e.g. INR, USD, THB.');
  const valid_until = dateOrNull(get('valid_until'), 'Valid until');
  await withTx(actor, async (tx) => {
    const [q] = await tx<{ lead_id: number; supplier: string; status: string }>`
      select q.lead_id, s.name as supplier, q.status from crm.supplier_quote q join crm.supplier s on s.id = q.supplier_id
      where q.id = ${quoteId}::int for update of q`;
    if (!q) throw new UserError('That supplier row no longer exists.');
    if (status === 'selected') {
      await tx`update crm.supplier_quote set status = 'received' where lead_id = ${q.lead_id}::int and status = 'selected' and id <> ${quoteId}::int`;
    }
    await tx`update crm.supplier_quote set status = ${status}::text, amount = ${amount}::numeric, currency = ${currency}::text,
               valid_until = ${valid_until}::date, notes = ${text(get('notes'), 1000)}::text,
               received_at = case when ${status}::text in ('received','selected') then coalesce(received_at, now()) else received_at end
             where id = ${quoteId}::int`;
    if (status !== q.status || amount) {
      const what = status === 'declined' ? 'declined / no reply' : status === 'selected' ? 'selected' : status === 'received' ? 'quote received' : 'awaiting quote';
      await log(tx, q.lead_id, 'quote', `${q.supplier}: ${what}${amount ? ` – ${currency === 'INR' ? inr(amount) : `${currency} ${Number(amount).toLocaleString('en-IN')}`}` : ''}`, actor, { quote_id: quoteId });
    }
    if (status === 'received' || status === 'selected') await advance(tx, q.lead_id, 'quote_received', actor, `quote from ${q.supplier}`);
  });
}

export async function removeQuote(actor: string, quoteId: number) {
  await withTx(actor, async (tx) => {
    const [q] = await tx<{ lead_id: number; supplier: string }>`
      delete from crm.supplier_quote q using crm.supplier s where q.id = ${quoteId}::int and s.id = q.supplier_id
      returning q.lead_id, s.name as supplier`;
    if (!q) throw new UserError('Already removed.');
    await log(tx, q.lead_id, 'supplier', `${q.supplier} removed from this enquiry`, actor);
  });
}

// ───────────────────────────── quote to client & confirmation ─────────────────────────────

/** "Share quote / itinerary": saves the price and link, moves to Quote shared, sets a follow-up. */
export async function shareQuote(actor: string, leadId: number, get: Getter): Promise<void> {
  const amount = parsePositiveAmount((get('quote_amount') ?? '').trim());
  if (!amount) throw new UserError('Enter the package price you quoted the client.');
  const url = text(get('itinerary_url'), 500);
  if (url && !/^https?:\/\//i.test(url)) throw new UserError('The itinerary link should start with https://');
  const follow = dateOrNull(get('next_follow_up'), 'Follow-up date') ?? addDays(todayIST(), 2);
  await withTx(actor, async (tx) => {
    const rows = await tx`update crm.lead set quote_amount = ${amount}::numeric, itinerary_url = coalesce(${url}::text, itinerary_url),
               quote_shared_at = now(), next_follow_up = ${follow}::date, follow_up_note = 'Check on quote', updated_by = ${actor}::text
             where id = ${leadId}::int and deleted_at is null returning id`;
    if (!rows.length) throw new UserError('This enquiry no longer exists.');
    await log(tx, leadId, 'quote', `Quote shared with client – ${inr(amount)}${url ? ' (itinerary link attached)' : ''}`, actor, { amount, url });
    await advance(tx, leadId, 'quote_shared', actor, 'quote shared with client');
  });
}

/** Client said yes. Optionally records the advance in the same step. */
export async function confirmBooking(actor: string, leadId: number, get: Getter): Promise<void> {
  const ref = text(get('booking_ref'), 40);
  const amtRaw = (get('quote_amount') ?? '').trim();
  const finalAmount = amtRaw ? parsePositiveAmount(amtRaw) : null;
  if (amtRaw && !finalAmount) throw new UserError('Final package price is not a valid amount.');
  await withTx(actor, async (tx) => {
    const [l] = await tx<{ status: Status; quote_amount: string | null }>`select status, quote_amount::text from crm.lead where id = ${leadId}::int and deleted_at is null for update`;
    if (!l) throw new UserError('This enquiry no longer exists.');
    if (!finalAmount && !l.quote_amount) throw new UserError('Enter the final package price.');
    await tx`update crm.lead set booking_ref = coalesce(${ref}::text, booking_ref), quote_amount = coalesce(${finalAmount}::numeric, quote_amount),
               confirmed_at = coalesce(confirmed_at, now()), lost_reason = null, closed_at = null, updated_by = ${actor}::text,
               status = case when status = 'lost' then 'booking_confirmed' else status end
             where id = ${leadId}::int`;
    await log(tx, leadId, 'stage', `Booking confirmed${ref ? ` – ref ${ref}` : ''}${finalAmount ? ` – ${inr(finalAmount)}` : ''}`, actor);
    await advance(tx, leadId, 'booking_confirmed', actor, 'client confirmed');
    if ((get('advance_amount') ?? '').trim()) await addPaymentTx(tx, actor, leadId, { ...paymentFrom(get, 'advance_'), kind: 'advance' });
  });
}

// ───────────────────────────── payments ─────────────────────────────

export interface PaymentRow { id: number; lead_id: number; kind: keyof typeof PAYMENT_KINDS; amount: string; paid_on: string; mode: string | null; reference: string | null; notes: string | null; created_at: string }

export async function listPayments(leadId: number): Promise<PaymentRow[]> {
  return db()<PaymentRow>`select id, lead_id, kind, amount::text, paid_on::text, mode, reference, notes, created_at::text
                          from crm.lead_payment where lead_id = ${leadId}::int and deleted_at is null order by paid_on, id`;
}

interface PaymentInput { kind: string; amount: string; paid_on: string; mode: string | null; reference: string | null; notes: string | null }
function paymentFrom(get: Getter, prefix = ''): PaymentInput {
  const amount = parsePositiveAmount((get(prefix + 'amount') ?? '').trim());
  if (!amount) throw new UserError('Enter the amount received (more than zero).');
  const paid_on = (get(prefix + 'date') ?? '').trim() || todayIST();
  if (!isIsoDate(paid_on)) throw new UserError('Payment date is not valid.');
  if (paid_on > todayIST()) throw new UserError('Payment date cannot be in the future.');
  return { kind: get(prefix + 'kind') ?? 'other', amount, paid_on, mode: text(get(prefix + 'mode'), 40), reference: text(get(prefix + 'reference'), 80), notes: text(get(prefix + 'notes'), 500) };
}

async function addPaymentTx(tx: Sql, actor: string, leadId: number, p: PaymentInput, idem?: string | null) {
  if (!(p.kind in PAYMENT_KINDS)) throw new UserError('Choose advance or final payment.');
  await tx`insert into crm.lead_payment (lead_id, kind, amount, paid_on, mode, reference, notes, idempotency_key)
           values (${leadId}::int, ${p.kind}::text, ${p.amount}::numeric, ${p.paid_on}::date, ${p.mode}::text, ${p.reference}::text, ${p.notes}::text, ${idem ?? null}::text)`;
  await log(tx, leadId, 'payment', `${PAYMENT_KINDS[p.kind as keyof typeof PAYMENT_KINDS]} received – ${inr(p.amount)}${p.mode ? ` by ${p.mode}` : ''}`, actor, { amount: p.amount });
  await syncPaymentStage(tx, leadId, actor);
}

/**
 * Keeps the payment stages honest: a final payment (or being fully paid)
 * → Final payment received; any payment → Advance received. If payments are
 * deleted the stage steps back to match. Travelling / completed are by date.
 */
async function syncPaymentStage(tx: Sql, leadId: number, actor: string) {
  const [l] = await tx<{ status: Status; quote_amount: string | null; paid: string; has_final: boolean; n: number }>`
    select l.status, l.quote_amount::text, coalesce(sum(p.amount), 0)::text as paid,
           coalesce(bool_or(p.kind = 'final'), false) as has_final, count(p.id)::int as n
    from crm.lead l left join crm.lead_payment p on p.lead_id = l.id and p.deleted_at is null
    where l.id = ${leadId}::int group by l.id`;
  if (!l || l.status === 'lost' || l.status === 'completed') return;
  const fully = l.quote_amount !== null && Number(l.paid) >= Number(l.quote_amount) - 0.005 && l.n > 0;
  const target: Status | null = l.has_final || fully ? 'final_payment_received' : l.n > 0 ? 'advance_received' : null;
  if (target && stageRank(l.status) < stageRank(target)) {
    await advance(tx, leadId, target, actor, fully && !l.has_final ? 'fully paid' : 'payment recorded');
  } else if (['advance_received', 'final_payment_received', 'travelling'].includes(l.status)) {
    const back: Status = target ?? 'booking_confirmed';
    if (stageRank(back) < stageRank(l.status) && l.status !== 'travelling') {
      await tx`update crm.lead set status = ${back}::text, updated_by = ${actor}::text where id = ${leadId}::int`;
      await log(tx, leadId, 'stage', `Stage → ${STAGE_LABEL[back]} (automatic: payment removed)`, actor, { from: l.status, to: back, auto: true });
    }
  }
}

export async function addPayment(actor: string, leadId: number, get: Getter, idem?: string | null) {
  if (idem) {
    const [dup] = await db()`select 1 from crm.lead_payment where idempotency_key = ${idem}::text`;
    if (dup) return;
  }
  const p = paymentFrom(get);
  await withTx(actor, async (tx) => {
    const [l] = await tx<{ status: Status }>`select status from crm.lead where id = ${leadId}::int and deleted_at is null for update`;
    if (!l) throw new UserError('This enquiry no longer exists.');
    if (l.status === 'lost') throw new UserError('This enquiry is marked Lost – confirm the booking first, then record the payment.');
    if (stageRank(l.status) < 6) await advance(tx, leadId, 'booking_confirmed', actor, 'payment received');
    await addPaymentTx(tx, actor, leadId, p, idem);
  });
}

export async function deletePayment(actor: string, paymentId: number) {
  await withTx(actor, async (tx) => {
    const [p] = await tx<{ lead_id: number; amount: string }>`
      update crm.lead_payment set deleted_at = now() where id = ${paymentId}::int and deleted_at is null returning lead_id, amount::text`;
    if (!p) throw new UserError('Already deleted.');
    await log(tx, p.lead_id, 'payment', `Payment of ${inr(p.amount)} deleted`, actor);
    await syncPaymentStage(tx, p.lead_id, actor);
  });
}

// ───────────────────────────── dashboard ─────────────────────────────

export interface Dashboard {
  stageCounts: Record<string, { count: number; value: string }>;
  openCount: number; openValue: string;
  monthNew: number; monthConfirmed: number; monthConfirmedValue: string; monthLost: number;
  conversion: number | null;
  toCollect: string; toCollectCount: number;
  followToday: LeadRow[]; followOverdue: LeadRow[];
  awaitingSupplier: (LeadRow & { waiting_since: string })[];
  departures: LeadRow[]; travelling: LeadRow[];
  sources: { source: string; leads: number; won: number }[];
  monthly: { month: string; enquiries: number; confirmed: number; value: string }[];
}

export async function getDashboard(today = todayIST()): Promise<Dashboard> {
  const sql = db();
  const monthStart = today.slice(0, 8) + '01';
  const [stages, month, collect, sources, monthly] = await inSeries(
    () => sql<{ stage: string; count: number; value: string }>`
      select stage, count(*)::int as count, coalesce(sum(coalesce(quote_amount, case when budget_basis = 'total' then budget else budget * greatest(adults + children, 1) end)), 0)::text as value
      from crm.v_lead where deleted_at is null group by stage`,
    () => sql<{ new_n: number; won_n: number; won_value: string; lost_n: number; decided: number }>`
      select count(*) filter (where (created_at at time zone 'Asia/Kolkata')::date >= ${monthStart}::date)::int as new_n,
             count(*) filter (where (confirmed_at at time zone 'Asia/Kolkata')::date >= ${monthStart}::date)::int as won_n,
             coalesce(sum(quote_amount) filter (where (confirmed_at at time zone 'Asia/Kolkata')::date >= ${monthStart}::date), 0)::text as won_value,
             count(*) filter (where stage = 'lost' and (closed_at at time zone 'Asia/Kolkata')::date >= ${monthStart}::date)::int as lost_n,
             count(*) filter (where (created_at at time zone 'Asia/Kolkata')::date >= (${today}::date - 90) and (crm.stage_rank(stage) >= 6 or stage = 'lost'))::int as decided
      from crm.v_lead where deleted_at is null`,
    () => sql<{ amount: string; n: number }>`
      select coalesce(sum(balance_due) filter (where balance_due > 0), 0)::text as amount, count(*) filter (where balance_due > 0)::int as n
      from crm.v_lead where deleted_at is null and crm.stage_rank(stage) >= 6`,
    () => sql<{ source: string; leads: number; won: number }>`
      select coalesce(lead_source, 'Not set') as source, count(*)::int as leads, count(*) filter (where crm.stage_rank(stage) >= 6)::int as won
      from crm.v_lead where deleted_at is null and (created_at at time zone 'Asia/Kolkata')::date >= (${today}::date - 365)
      group by 1 order by 2 desc limit 8`,
    () => sql<{ month: string; enquiries: number; confirmed: number; value: string }>`
      with m as (select to_char(d, 'YYYY-MM') as month from generate_series(date_trunc('month', ${today}::date) - interval '11 months', date_trunc('month', ${today}::date), interval '1 month') d)
      select m.month,
             (select count(*) from crm.lead l where l.deleted_at is null and to_char(l.created_at at time zone 'Asia/Kolkata', 'YYYY-MM') = m.month)::int as enquiries,
             (select count(*) from crm.lead l where l.deleted_at is null and to_char(l.confirmed_at at time zone 'Asia/Kolkata', 'YYYY-MM') = m.month)::int as confirmed,
             (select coalesce(sum(quote_amount), 0) from crm.lead l where l.deleted_at is null and to_char(l.confirmed_at at time zone 'Asia/Kolkata', 'YYYY-MM') = m.month)::text as value
      from m order by m.month`,
  );
  const [followToday, followOverdue, departures, travelling, awaiting] = await inSeries(
    () => selectLeads(sql, `l.deleted_at is null and l.stage <> 'lost' and l.stage <> 'completed' and l.next_follow_up = $1::date`, [today], 'order by l.priority = \'hot\' desc, l.id'),
    () => selectLeads(sql, `l.deleted_at is null and l.stage <> 'lost' and l.stage <> 'completed' and l.next_follow_up < $1::date`, [today], 'order by l.next_follow_up, l.id limit 20'),
    () => selectLeads(sql, `l.deleted_at is null and crm.stage_rank(l.stage) between 6 and 8 and l.travel_start between $1::date and ($1::date + 30)`, [today], 'order by l.travel_start limit 12'),
    () => selectLeads(sql, `l.deleted_at is null and l.stage = 'travelling'`, [], 'order by l.travel_end'),
    () => selectLeads(sql, `l.deleted_at is null and crm.stage_rank(l.stage) between 1 and 3 and exists (select 1 from crm.supplier_quote q where q.lead_id = l.id and q.status = 'requested' and q.requested_at < now() - interval '24 hours')`, [], 'order by l.id limit 12'),
  );
  const stageCounts: Dashboard['stageCounts'] = {};
  for (const s of stages) stageCounts[s.stage] = { count: s.count, value: s.value };
  const open = stages.filter((s) => stageRank(s.stage as Status) >= 1 && stageRank(s.stage as Status) <= 5);
  const sum = (vals: string[]) => (vals.reduce((a, v) => a + Math.round(Number(v) * 100), 0) / 100).toFixed(2);
  const m = month[0];
  const [{ won90 }] = await sql<{ won90: number }>`
    select count(*) filter (where crm.stage_rank(stage) >= 6)::int as won90 from crm.v_lead
    where deleted_at is null and (created_at at time zone 'Asia/Kolkata')::date >= (${today}::date - 90)`;
  return {
    stageCounts,
    openCount: open.reduce((a, s) => a + s.count, 0),
    openValue: sum(open.map((s) => s.value)),
    monthNew: m.new_n, monthConfirmed: m.won_n, monthConfirmedValue: m.won_value, monthLost: m.lost_n,
    conversion: m.decided ? Math.round((won90 / m.decided) * 100) : null,
    toCollect: collect[0].amount, toCollectCount: collect[0].n,
    followToday, followOverdue, departures, travelling,
    awaitingSupplier: awaiting.map((l) => ({ ...l, waiting_since: l.created_at })),
    sources, monthly,
  };
}

/** Follow-ups page buckets. */
export async function followUps(today = todayIST()) {
  const sql = db();
  const base = `l.deleted_at is null and l.stage not in ('lost', 'completed')`;
  const [overdue, due, upcoming, none] = await inSeries(
    () => selectLeads(sql, `${base} and l.next_follow_up < $1::date`, [today], 'order by l.next_follow_up, l.id'),
    () => selectLeads(sql, `${base} and l.next_follow_up = $1::date`, [today], 'order by l.priority = \'hot\' desc, l.id'),
    () => selectLeads(sql, `${base} and l.next_follow_up between ($1::date + 1) and ($1::date + 7)`, [today], 'order by l.next_follow_up, l.id'),
    () => selectLeads(sql, `${base} and l.next_follow_up is null and crm.stage_rank(l.stage) between 1 and 5`, [], 'order by l.created_at desc limit 50'),
  );
  return { overdue, due, upcoming, none };
}

// ───────────────────────────── search ─────────────────────────────

export async function search(q: string) {
  const s = q.trim();
  if (!s) return { leads: [] as LeadRow[], suppliers: [] as SupplierRow[] };
  const like = `%${s.replace(/[%_\\]/g, (c) => '\\' + c)}%`;
  const [leads, suppliers] = await inSeries(
    () => listLeads({ q: s, scope: 'all' }, 50),
    () => db()<SupplierRow>`select s.id, s.name, s.contact_person, s.email, s.phone, s.whatsapp, s.destinations, s.services, s.notes, s.is_active,
                       0 as requests, 0 as quotes, 0 as selected, null as last_request_at
                     from crm.supplier s where s.name ilike ${like}::text or s.email ilike ${like}::text or s.destinations ilike ${like}::text
                       or s.contact_person ilike ${like}::text or s.phone ilike ${like}::text order by s.name limit 20`,
  );
  return { leads, suppliers };
}

// ───────────────────────────── backup ─────────────────────────────

export async function exportAll(): Promise<string> {
  const sql = db();
  const tables: Record<string, unknown> = {};
  for (const [t, order] of [['lead', 'id'], ['supplier', 'id'], ['supplier_quote', 'id'], ['lead_payment', 'id'], ['activity', 'id'], ['audit_log', 'id']] as const) {
    const parts = [`select coalesce(json_agg(x order by x.${order}), '[]')::text as d from crm.${t} x`];
    const strings = Object.assign([...parts], { raw: [...parts] }) as unknown as TemplateStringsArray;
    const [r] = await sql<{ d: string }>(strings);
    tables[t] = JSON.parse(r.d);
  }
  return JSON.stringify({ app: 'skyroad-crm', format: 1, exported_at: new Date().toISOString(), tables }, null, 1);
}

export const ALLOWED_INCLUSIONS = INCLUSIONS;

// ───────────────────────────── for the Claude connector ─────────────────────────────

/** Finds an enquiry by "SRQ-00004", "srq 4", "4" or its internal id. */
export async function findLeadByRef(ref: string | number): Promise<LeadRow | null> {
  const s = String(ref).trim();
  const m = s.match(/^(?:srq)?[\s-]*0*(\d{1,9})$/i);
  if (!m) return null;
  const n = Number(m[1]);
  const no = 'SRQ-' + String(n).padStart(5, '0');
  const [l] = await selectLeads(db(), `l.deleted_at is null and (l.lead_no = $1::text ${/^\d+$/.test(s) ? 'or l.id = $2::int' : ''})`, /^\d+$/.test(s) ? [no, n] : [no], 'order by (l.lead_no = $1::text) desc limit 1');
  return l ?? null;
}

/** Active suppliers whose "destinations covered" mention the destination (or any of its nights-plan places). */
export async function suppliersFor(destination: string, nightsPlan?: string | null): Promise<SupplierRow[]> {
  const words = `${destination} ${nightsPlan ?? ''}`.toLowerCase().replace(/\d+\s*n\b/g, ' ').split(/[^a-z]+/).filter((w) => w.length > 2);
  const all = await listSuppliers(false);
  return all.filter((s) => s.destinations && words.some((w) => s.destinations!.toLowerCase().includes(w)));
}

export async function findSupplier(nameOrId: string | number): Promise<SupplierRow | null> {
  const all = await listSuppliers(true);
  const s = String(nameOrId).trim().toLowerCase();
  return all.find((x) => String(x.id) === s) ?? all.find((x) => x.name.toLowerCase() === s)
    ?? all.find((x) => x.name.toLowerCase().includes(s)) ?? all.find((x) => !!x.email && x.email.toLowerCase() === s) ?? null;
}

/** Saves the itinerary link and sets a "send it to the client" follow-up for today. */
export async function setItinerary(actor: string, leadId: number, url: string): Promise<void> {
  if (!/^https?:\/\//i.test(url)) throw new UserError('The itinerary link should start with https://');
  await withTx(actor, async (tx) => {
    const rows = await tx`update crm.lead set itinerary_url = ${url.slice(0, 500)}::text, next_follow_up = ${todayIST()}::date,
                            follow_up_note = 'Send the itinerary to the client', updated_by = ${actor}::text
                          where id = ${leadId}::int and deleted_at is null returning id`;
    if (!rows.length) throw new UserError('This enquiry no longer exists.');
    await log(tx, leadId, 'quote', 'Itinerary ready – send it to the client', actor, { url });
  });
}

/** What the mail checker needs: requests waiting for replies, and itineraries waiting to go to clients. */
export async function pendingWork() {
  const awaiting = await db()<{ lead_id: number; lead_no: string; client_name: string; destination: string; stage: string; supplier_id: number; supplier: string; email: string | null; requested_at: string }>`
    select l.id as lead_id, l.lead_no, l.client_name, l.destination, l.stage, s.id as supplier_id, s.name as supplier, s.email, q.requested_at::text
    from crm.supplier_quote q join crm.supplier s on s.id = q.supplier_id join crm.v_lead l on l.id = q.lead_id
    where q.status = 'requested' and l.deleted_at is null and l.stage not in ('lost', 'completed')
    order by q.requested_at`;
  const toSend = await selectLeads(db(), `l.deleted_at is null and l.itinerary_url is not null and l.quote_shared_at is null and crm.stage_rank(l.stage) between 1 and 3`, [], 'order by l.updated_at');
  const newOnes = await selectLeads(db(), `l.deleted_at is null and l.stage = 'new_query'`, [], 'order by l.created_at');
  return { awaiting, toSend, newOnes };
}
