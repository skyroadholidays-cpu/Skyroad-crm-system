// The "Skyroad CRM" connector for Claude (Model Context Protocol tools).
// Claude uses these to create enquiries, prepare supplier mails, record what
// was sent and quoted, and attach itineraries. Every change is logged in the
// enquiry timeline as "Claude" and in the audit log.
import { createHash } from 'node:crypto';
import { UserError, friendlyError } from './db-core';
import * as C from './crm';
import { parseEnquiry, slotsFound, ORDER, SLOT_LABEL, ORDER_PLACEHOLDER, ORDER_TEMPLATE } from './quick-parse';
import { supplierRequest, TEMPLATE_VARS, datesText, paxText } from './templates';
import { getSupplierTemplate, saveSupplierTemplate } from './settings';
import { STAGE_LABEL, PACKAGE_LABEL, QUOTE_STATUS, isStatus } from './constants';
import { todayIST, addDays } from './dates';

const ACTOR = 'Claude';
type Args = Record<string, unknown>;
const str = (a: Args, k: string) => (typeof a[k] === 'string' ? (a[k] as string).trim() : typeof a[k] === 'number' ? String(a[k]) : '');

interface Tool { name: string; description: string; inputSchema: object; run: (a: Args) => Promise<unknown> }

async function lead(a: Args) {
  const ref = str(a, 'ref');
  if (!ref) throw new UserError('Give the enquiry number, e.g. SRQ-00004.');
  const l = await C.findLeadByRef(ref);
  if (!l) throw new UserError(`No enquiry ${ref} found.`);
  return l;
}

function summary(l: C.LeadRow) {
  return {
    ref: l.lead_no, stage: STAGE_LABEL[l.stage], client: l.client_name, phone: l.phone, email: l.email, city: l.city,
    destination: l.destination, nights_plan: l.nights_plan, dates: datesText(l), travel_start: l.travel_start, travel_end: l.travel_end,
    travellers: paxText(l), package: l.package_type ? PACKAGE_LABEL[l.package_type] : null, inclusions: l.inclusions,
    hotel_category: l.hotel_category, requirements: l.requirements, quote_amount: l.quote_amount, itinerary_url: l.itinerary_url,
    quote_shared_at: l.quote_shared_at, booking_ref: l.booking_ref, paid: l.paid, balance_due: l.balance_due,
    next_follow_up: l.next_follow_up, follow_up_note: l.follow_up_note,
  };
}

const refProp = { ref: { type: 'string', description: 'Enquiry number, e.g. SRQ-00004' } };

export const TOOLS: Tool[] = [
  {
    name: 'quick_add_form',
    description: 'Returns the 6-line quick-add form to show the user when they say "new q". They fill it in and send it back; then call create_enquiry with their text.',
    inputSchema: { type: 'object', properties: {} },
    run: async () => ({ form: ORDER_PLACEHOLDER, example: ORDER_TEMPLATE, lines: ORDER.map((k, i) => `${i + 1}. ${SLOT_LABEL[k]}`) }),
  },
  {
    name: 'create_enquiry',
    description: 'Creates a new enquiry in the Skyroad CRM from the user\'s filled-in 6-line quick-add text (name + mobile, city, dates, destination, travellers, package). Returns the SRQ number and anything missing. Safe to retry: the same text never creates two enquiries.',
    inputSchema: { type: 'object', properties: { text: { type: 'string', description: 'The filled-in quick-add text, exactly as the user wrote it' }, lead_source: { type: 'string', description: 'Optional: WhatsApp, Instagram, Referral…' } }, required: ['text'] },
    run: async (a) => {
      const text = str(a, 'text');
      if (!text) throw new UserError('Send the filled-in quick-add text.');
      const r = parseEnquiry(text, todayIST());
      const found = slotsFound(r);
      if (!r.client_name || !r.destination) {
        return { created: false, missing: ORDER.filter((k) => !found[k]).map((k) => SLOT_LABEL[k]), message: 'Need at least the client name and destination – ask the user to fill those lines.' };
      }
      const vals: Record<string, string | undefined> = {
        client_name: r.client_name, phone: r.phone, email: r.email, city: r.city, destination: r.destination, trip_type: r.trip_type,
        travel_start: r.travel_start, travel_end: r.travel_end, flexible_dates: r.flexible_dates ? 'true' : undefined,
        adults: r.adults !== undefined ? String(r.adults) : undefined, children: r.children !== undefined ? String(r.children) : undefined,
        child_ages: r.child_ages, infants: r.infants !== undefined ? String(r.infants) : undefined, nights_plan: r.nights_plan,
        hotel_category: r.hotel_category, package_type: r.package_type, inclusions: (r.inclusions ?? []).join(','), budget: r.budget,
        budget_basis: r.budget_basis, requirements: r.requirements, lead_source: str(a, 'lead_source') || r.lead_source,
        next_follow_up: addDays(todayIST(), 1), follow_up_note: 'Send supplier requests', notes: `Created by Claude from:\n${text}`,
      };
      const input = C.parseLeadInput((k) => vals[k]);
      const idem = 'mcp:' + createHash('sha256').update(text).digest('hex').slice(0, 40);
      const res = await C.createLead(ACTOR, input, idem);
      const l = (await C.getLead(res.id))!;
      return { created: !res.duplicate, already_existed: !!res.duplicate, enquiry: summary(l), missing: ORDER.filter((k) => !found[k]).map((k) => SLOT_LABEL[k]) };
    },
  },
  {
    name: 'get_enquiry',
    description: 'Full details of one enquiry: trip, stage, supplier requests and quotes, itinerary link, payments and recent timeline.',
    inputSchema: { type: 'object', properties: refProp, required: ['ref'] },
    run: async (a) => {
      const l = await lead(a);
      const [quotes, activity] = [await C.listQuotes(l.id), await C.listActivity(l.id)];
      return {
        enquiry: summary(l),
        suppliers: quotes.map((q) => ({ supplier: q.supplier_name, email: q.email, status: QUOTE_STATUS[q.status], amount: q.amount, currency: q.currency, requested_at: q.requested_at, notes: q.notes })),
        timeline: activity.slice(0, 15).map((x) => ({ at: x.at, kind: x.kind, text: x.body })),
      };
    },
  },
  {
    name: 'list_enquiries',
    description: 'Lists enquiries, optionally by stage (new_query, supplier_mailed, quote_received, quote_shared, follow_up, booking_confirmed, advance_received, final_payment_received, travelling, completed, lost) or search text.',
    inputSchema: { type: 'object', properties: { stage: { type: 'string' }, search: { type: 'string' }, limit: { type: 'number' } } },
    run: async (a) => {
      const stage = str(a, 'stage');
      const rows = await C.listLeads({ stage: isStatus(stage) ? stage : undefined, q: str(a, 'search') || undefined }, Math.min(Number(a.limit) || 30, 100));
      return rows.map((l) => ({ ref: l.lead_no, client: l.client_name, destination: l.destination, dates: datesText(l), travellers: paxText(l), stage: STAGE_LABEL[l.stage], next_follow_up: l.next_follow_up }));
    },
  },
  {
    name: 'find_suppliers',
    description: 'Suppliers who cover a destination (from each supplier\'s "destinations covered"). Pass ref to use that enquiry\'s destination and nights plan.',
    inputSchema: { type: 'object', properties: { ...refProp, destination: { type: 'string' } } },
    run: async (a) => {
      let dest = str(a, 'destination'), plan: string | null = null;
      if (str(a, 'ref')) { const l = await lead(a); dest = l.destination; plan = l.nights_plan; }
      if (!dest) throw new UserError('Give a destination or an enquiry number.');
      const list = await C.suppliersFor(dest, plan);
      return { destination: dest, suppliers: list.map((s) => ({ name: s.name, contact_person: s.contact_person, email: s.email, whatsapp: s.whatsapp, destinations: s.destinations })) };
    },
  },
  {
    name: 'add_supplier',
    description: 'Adds (or updates, if the name exists) a supplier with email, WhatsApp and the destinations they cover.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' }, contact_person: { type: 'string' }, email: { type: 'string' }, whatsapp: { type: 'string' }, phone: { type: 'string' }, destinations: { type: 'string', description: 'Comma list, e.g. "Thailand, Vietnam"' }, services: { type: 'string' }, notes: { type: 'string' } }, required: ['name'] },
    run: async (a) => {
      const existing = await C.findSupplier(str(a, 'name'));
      const same = existing && existing.name.toLowerCase() === str(a, 'name').toLowerCase() ? existing : null;
      const pick = (k: string) => str(a, k) || (same ? String((same as unknown as Record<string, unknown>)[k] ?? '') : '');
      const id = await C.saveSupplier(ACTOR, (k) => (k === 'id' ? (same ? String(same.id) : undefined) : pick(k) || undefined));
      return { saved: true, updated: !!same, supplier: await C.getSupplier(id) };
    },
  },
  {
    name: 'draft_supplier_requests',
    description: 'Builds the rate-request email for each supplier using the user\'s saved standard template. Returns to/subject/body per supplier. Create these as Gmail DRAFTS for the user to review – never send them. Do not change the CRM stage here; call mark_requests_sent only after the user has actually sent them.',
    inputSchema: { type: 'object', properties: { ...refProp, suppliers: { type: 'array', items: { type: 'string' }, description: 'Supplier names; leave out to use every supplier covering the destination' } }, required: ['ref'] },
    run: async (a) => {
      const l = await lead(a);
      const names = Array.isArray(a.suppliers) ? (a.suppliers as unknown[]).map(String).filter(Boolean) : [];
      const list: C.SupplierRow[] = [];
      if (names.length) {
        for (const n of names) { const sup = await C.findSupplier(n); if (!sup) throw new UserError(`No supplier called "${n}".`); list.push(sup); }
      } else list.push(...(await C.suppliersFor(l.destination, l.nights_plan)));
      if (!list.length) return { drafts: [], message: `No supplier covers ${l.destination} yet. Add one with add_supplier (include destinations).` };
      const tpl = await getSupplierTemplate();
      return {
        ref: l.lead_no, using_saved_template: !!tpl,
        drafts: list.map((s) => ({ supplier: s.name, to: s.email, whatsapp: s.whatsapp, ...supplierRequest({ ...l }, s.contact_person, tpl, s.name), missing_email: !s.email })),
      };
    },
  },
  {
    name: 'mark_requests_sent',
    description: 'Records that rate requests were SENT to these suppliers (e.g. you found them in Gmail Sent). Moves the enquiry to "Supplier mail sent".',
    inputSchema: { type: 'object', properties: { ...refProp, suppliers: { type: 'array', items: { type: 'string' } }, channel: { type: 'string', enum: ['email', 'whatsapp', 'phone', 'portal'] } }, required: ['ref', 'suppliers'] },
    run: async (a) => {
      const l = await lead(a);
      const names = Array.isArray(a.suppliers) ? (a.suppliers as unknown[]).map(String) : [];
      const ids: number[] = [];
      for (const n of names) { const s = await C.findSupplier(n); if (!s) throw new UserError(`No supplier called "${n}" – add it first.`); ids.push(s.id); }
      await C.requestQuotes(ACTOR, l.id, ids, str(a, 'channel') || 'email');
      return { ok: true, enquiry: summary((await C.getLead(l.id))!) };
    },
  },
  {
    name: 'record_supplier_quote',
    description: 'Saves a supplier\'s quoted price (from their reply). Moves the enquiry to "Quote received". Set selected=true for the option you will build the itinerary from.',
    inputSchema: { type: 'object', properties: { ...refProp, supplier: { type: 'string' }, amount: { type: 'number' }, currency: { type: 'string', description: 'INR by default' }, valid_until: { type: 'string', description: 'YYYY-MM-DD' }, notes: { type: 'string', description: 'Hotels, inclusions, conditions – short' }, selected: { type: 'boolean' }, declined: { type: 'boolean' } }, required: ['ref', 'supplier'] },
    run: async (a) => {
      const l = await lead(a);
      const s = await C.findSupplier(str(a, 'supplier'));
      if (!s) throw new UserError(`No supplier called "${str(a, 'supplier')}".`);
      let q = (await C.listQuotes(l.id)).find((x) => x.supplier_id === s.id);
      if (!q) { await C.requestQuotes(ACTOR, l.id, [s.id], 'email'); q = (await C.listQuotes(l.id)).find((x) => x.supplier_id === s.id)!; }
      const status = a.declined ? 'declined' : a.selected ? 'selected' : 'received';
      await C.updateQuote(ACTOR, q.id, (k) => ({ status, amount: a.amount !== undefined ? String(a.amount) : undefined, currency: str(a, 'currency') || 'INR', valid_until: str(a, 'valid_until') || undefined, notes: str(a, 'notes') || undefined } as Record<string, string | undefined>)[k]);
      return { ok: true, enquiry: summary((await C.getLead(l.id))!) };
    },
  },
  {
    name: 'set_itinerary',
    description: 'Attaches the finished itinerary link (e.g. the Canva design link) and sets a follow-up for today: "Send the itinerary to the client". Does not mark it as sent.',
    inputSchema: { type: 'object', properties: { ...refProp, url: { type: 'string' } }, required: ['ref', 'url'] },
    run: async (a) => { const l = await lead(a); await C.setItinerary(ACTOR, l.id, str(a, 'url')); return { ok: true, reminder: 'Follow-up set for today: send the itinerary to the client.' }; },
  },
  {
    name: 'mark_quote_shared',
    description: 'Records that the quote/itinerary was sent to the client, with the selling price. Moves to "Quote / itinerary shared" and sets a follow-up in 2 days.',
    inputSchema: { type: 'object', properties: { ...refProp, quote_amount: { type: 'number', description: 'Selling price in INR' }, itinerary_url: { type: 'string' } }, required: ['ref', 'quote_amount'] },
    run: async (a) => { const l = await lead(a); await C.shareQuote(ACTOR, l.id, (k) => ({ quote_amount: String(a.quote_amount ?? ''), itinerary_url: str(a, 'itinerary_url') || undefined } as Record<string, string | undefined>)[k]); return { ok: true, enquiry: summary((await C.getLead(l.id))!) }; },
  },
  {
    name: 'add_note',
    description: 'Adds a note, call, WhatsApp or email entry to the enquiry timeline.',
    inputSchema: { type: 'object', properties: { ...refProp, text: { type: 'string' }, kind: { type: 'string', enum: ['note', 'call', 'whatsapp', 'email', 'meeting'] } }, required: ['ref', 'text'] },
    run: async (a) => { const l = await lead(a); await C.logInteraction(ACTOR, l.id, (k) => ({ kind: str(a, 'kind') || 'note', body: str(a, 'text') } as Record<string, string>)[k]); return { ok: true }; },
  },
  {
    name: 'set_stage',
    description: 'Changes an enquiry\'s stage by hand (only when the user asks). For "lost" give a reason.',
    inputSchema: { type: 'object', properties: { ...refProp, stage: { type: 'string' }, reason: { type: 'string' } }, required: ['ref', 'stage'] },
    run: async (a) => { const l = await lead(a); await C.setStage(ACTOR, l.id, str(a, 'stage'), null, str(a, 'reason')); return { ok: true, enquiry: summary((await C.getLead(l.id))!) }; },
  },
  {
    name: 'pending_work',
    description: 'For the regular mail check: supplier requests still waiting for a reply (with supplier emails and the SRQ number to search Gmail for), itineraries ready but not yet sent to clients, and new enquiries with no supplier request yet.',
    inputSchema: { type: 'object', properties: {} },
    run: async () => {
      const w = await C.pendingWork();
      return {
        awaiting_supplier_replies: w.awaiting.map((x) => ({ ref: x.lead_no, client: x.client_name, destination: x.destination, supplier: x.supplier, supplier_email: x.email, requested_at: x.requested_at, gmail_search: `${x.lead_no}${x.email ? ` from:${x.email}` : ''}` })),
        itineraries_to_send: w.toSend.map((l) => ({ ref: l.lead_no, client: l.client_name, phone: l.phone, destination: l.destination, itinerary_url: l.itinerary_url })),
        new_enquiries_without_requests: w.newOnes.map((l) => ({ ref: l.lead_no, client: l.client_name, destination: l.destination, dates: datesText(l), gmail_search_sent: `in:sent ${l.lead_no}` })),
      };
    },
  },
  {
    name: 'supplier_template',
    description: 'Reads the user\'s standard supplier email template, or saves a new one when subject/body are given. Placeholders like {{destination}}, {{dates}}, {{pax}}, {{nights_plan}}, {{ref}} are filled per enquiry.',
    inputSchema: { type: 'object', properties: { subject: { type: 'string' }, body: { type: 'string' } } },
    run: async (a) => {
      if (str(a, 'body')) await saveSupplierTemplate(ACTOR, str(a, 'subject'), str(a, 'body'));
      return { template: await getSupplierTemplate(), placeholders: TEMPLATE_VARS };
    },
  },
];

// ───────────────────────────── JSON-RPC (MCP) ─────────────────────────────

export const PROTOCOL_VERSION = '2025-06-18';

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };

export async function handleRpc(msg: Rpc): Promise<object | null> {
  const id = msg.id ?? null;
  const reply = (result: object) => ({ jsonrpc: '2.0', id, result });
  const fail = (code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } });
  if (!msg || typeof msg.method !== 'string') return fail(-32600, 'Invalid request');
  if (msg.id === undefined) return null; // notifications (e.g. notifications/initialized) need no reply
  switch (msg.method) {
    case 'initialize': {
      const asked = typeof msg.params?.protocolVersion === 'string' ? (msg.params.protocolVersion as string) : PROTOCOL_VERSION;
      return reply({
        protocolVersion: asked,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'skyroad-crm', title: 'Skyroad CRM', version: '1.0.0' },
        instructions: 'Skyroad Holidays sales CRM. "new q" → show quick_add_form, then create_enquiry with the user\'s text. Supplier mails are only ever prepared as Gmail drafts for the user to review; call mark_requests_sent after they are sent. Record supplier replies with record_supplier_quote, attach itineraries with set_itinerary, and remind the user to send them.',
      });
    }
    case 'ping': return reply({});
    case 'tools/list': return reply({ tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    case 'tools/call': {
      const name = String(msg.params?.name ?? '');
      const tool = TOOLS.find((t) => t.name === name);
      if (!tool) return fail(-32602, `Unknown tool: ${name}`);
      try {
        const out = await tool.run((msg.params?.arguments as Args) ?? {});
        return reply({ content: [{ type: 'text', text: JSON.stringify(out, null, 1) }], isError: false });
      } catch (e) {
        return reply({ content: [{ type: 'text', text: friendlyError(e) }], isError: true });
      }
    }
    case 'resources/list': return reply({ resources: [] });
    case 'prompts/list': return reply({ prompts: [] });
    default: return fail(-32601, `Method not found: ${msg.method}`);
  }
}
