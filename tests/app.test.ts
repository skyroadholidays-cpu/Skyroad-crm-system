// End-to-end tests of the CRM data layer against a real, freshly migrated
// PostgreSQL database. Run with:  npm test   (see README)
import assert from 'node:assert/strict';
import { setSql, friendlyError } from '../lib/db-core';
import type { Sql } from '../lib/sql-types';
import * as auth from '../lib/auth-core';
import * as C from '../lib/crm';
import { runReport, REPORTS, type ReportKey } from '../lib/reports';
import { reportToCsv } from '../lib/csv';
import { todayIST, addDays } from '../lib/dates';
import { parseEnquiry, durationLabel } from '../lib/quick-parse';
import * as T from '../lib/templates';

const ACTOR = 'Skyroadholidays';
let passed = 0;
const results: string[] = [];
async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed++;
    results.push(`  ✓ ${name}`);
  } catch (e) {
    results.push(`  ✗ ${name}`);
    console.log(results.join('\n'));
    console.error(e);
    process.exit(1);
  }
}
async function rejects(fn: () => Promise<unknown>, frag: string) {
  try {
    await fn();
  } catch (e) {
    const msg = friendlyError(e);
    assert.ok(msg.toLowerCase().includes(frag.toLowerCase()), `expected "${frag}" in "${msg}"`);
    return msg;
  }
  assert.fail(`expected rejection containing "${frag}"`);
}
const g = (o: Record<string, unknown>) => (k: string) => (o[k] === undefined || o[k] === null ? undefined : String(o[k]));
const today = todayIST();

async function main() {
  let sql: Sql;
  let end: () => void = () => {};
  if (process.env.PGMINI_SOCKET) {
    const { connect } = await import('./pg-mini');
    const c = await connect({ path: process.env.PGMINI_SOCKET, port: 0, user: process.env.PGUSER ?? 'postgres', database: process.env.PGDATABASE ?? 'crm_test' });
    sql = c.sql;
    end = c.end;
  } else {
    const url = process.env.TEST_DATABASE_URL;
    if (!url) throw new Error('Set TEST_DATABASE_URL to an EMPTY, freshly migrated test database (never your live one).');
    const postgres = (await import(process.env.PG_DRIVER ?? 'postgres')).default;
    const pg = postgres(url, { prepare: false, max: 4, onnotice: () => {} });
    sql = pg as unknown as Sql;
    end = () => void pg.end();
  }
  setSql(sql);
  const [{ n }] = await sql<{ n: number }>`select count(*)::int as n from crm.lead`;
  if (n > 0) throw new Error('Refusing to run: the test database already contains enquiries.');

  // ───────── quick add parser & templates
  await test('the quick-add box understands the Thailand example', () => {
    const r = parseEnquiry('new q\nThailand\n1 dec to 6 Dec\n2 adults\n2N Krabi, 3N Phuket', '2026-10-25');
    assert.deepEqual(r, { travel_start: '2026-12-01', travel_end: '2026-12-06', nights_plan: '2N Krabi, 3N Phuket', adults: 2, destination: 'Thailand', trip_type: 'international' });
    assert.equal(durationLabel(r.travel_start, r.travel_end), '5N / 6D');
  });
  await test('quick-add handles one-line enquiries, year roll-over, budgets and packages', () => {
    const r = parseEnquiry('New query Bali 28 Dec - 3 Jan, 2 adults 1 child (6 yrs), 4 star, budget 1.5L, with flights, land package. Name: Rahul Shah 9876543210', '2026-10-25');
    assert.equal(r.destination, 'Bali');
    assert.equal(r.travel_start, '2026-12-28');
    assert.equal(r.travel_end, '2027-01-03');
    assert.equal(r.children, 1);
    assert.equal(r.child_ages, '6 yrs');
    assert.equal(r.budget, '150000.00');
    assert.equal(r.package_type, 'land_package');
    assert.ok(r.inclusions?.includes('Flights') && r.inclusions.includes('Full sightseeing'));
    assert.equal(r.client_name, 'Rahul Shah');
    assert.equal(r.phone, '9876543210');
    // a date already past this year means next year; nights give the end date
    const v = parseEnquiry('Vietnam from 5 March, 3N Hanoi, 2N Da Nang, 2 adults, budget 80k pp', '2026-10-25');
    assert.deepEqual([v.destination, v.travel_start, v.travel_end, v.budget, v.budget_basis], ['Vietnam', '2027-03-05', '2027-03-10', '80000.00', 'per_person']);
    const k = parseEnquiry('Kashmir\n15/04/2027 to 20/04/2027\ncouple honeymoon\n3N Srinagar + 2N Gulmarg', '2026-10-25');
    assert.deepEqual([k.trip_type, k.adults, k.travel_end], ['domestic', 2, '2027-04-20']);
    assert.deepEqual(parseEnquiry('', today), {});
  });
  await test('quick-add reads the 6-line order exactly (name, city, dates, destination, travellers, package)', () => {
    const r = parseEnquiry('Rahul Shah 98765 43210\nMumbai\n1 Dec to 6 Dec\nThailand – 2N Krabi, 3N Phuket\n2 adults 1 child\nCustomised package', '2026-10-25');
    assert.deepEqual([r.client_name, r.phone, r.city, r.travel_start, r.travel_end, r.destination, r.nights_plan, r.adults, r.children, r.package_type],
      ['Rahul Shah', '9876543210', 'Mumbai', '2026-12-01', '2026-12-06', 'Thailand', '2N Krabi, 3N Phuket', 2, 1, 'land_package']);
    const k = parseEnquiry('Karan Mehta | Ahmedabad | Dec 20-24 | Dubai | 2+2 | visa', '2026-10-25');
    assert.deepEqual([k.client_name, k.city, k.travel_end, k.destination, k.adults, k.children, k.package_type], ['Karan Mehta', 'Ahmedabad', '2026-12-24', 'Dubai', 2, 2, 'visa_only']);
    const v = parseEnquiry('Nambi Somaiya\nValsad\n5 Dec\nKerala 2N Munnar 2N Alleppey\n9 adults\nTransfers – Urbania taxi\nPrefer Mercedes', '2026-10-25');
    assert.deepEqual([v.city, v.travel_end, v.destination, v.adults, v.package_type, v.requirements], ['Valsad', '2026-12-09', 'Kerala', 9, 'transfers', 'Prefer Mercedes']);
    const lab = parseEnquiry('Name: Pooja\nPax: 2A 1C\nDestination: Bali\nDates: flexible\nPackage: hotel only\nCity: Surat', '2026-10-25');
    assert.deepEqual([lab.client_name, lab.city, lab.flexible_dates, lab.destination, lab.adults, lab.children, lab.package_type], ['Pooja', 'Surat', true, 'Bali', 2, 1, 'hotel_only']);
    const m = parseEnquiry('Meera Iyer\nPune\n15/01/2027 to 18/01/2027\nGoa\n4\nhotel + flight', '2026-10-25');
    assert.deepEqual([m.adults, m.package_type, m.inclusions], [4, 'hotel_only', ['Hotel', 'Flights']]);
  });
  await test('standard supplier mail and WhatsApp links are filled from the enquiry', () => {
    const l = { lead_no: 'SRQ-00001', client_name: 'Asha Rao', destination: 'Thailand', travel_start: '2026-12-01', travel_end: '2026-12-06', adults: 2, children: 1, child_ages: '6',
      infants: 0, nights_plan: '2N Krabi, 3N Phuket', hotel_category: '4 Star', package_type: 'land_package', inclusions: ['Hotel', 'Full sightseeing'], requirements: null, quote_amount: '145000.00' };
    const m = T.supplierRequest(l, 'Somchai');
    assert.ok(m.subject.includes('Thailand') && m.subject.includes('SRQ-00001') && m.subject.includes('2 Adults, 1 Child'));
    for (const s of ['Dear Somchai,', '1 Dec 2026 – 6 Dec 2026 (5N / 6D)', '2N Krabi, 3N Phuket', '4 Star', 'Customised package', 'sales@skyroadholidays.com']) assert.ok(m.body.includes(s), s);
    assert.ok(T.clientQuote(l).includes('₹1,45,000'));
    assert.equal(T.digitsForWhatsApp('98765 43210'), '919876543210');
    assert.equal(T.digitsForWhatsApp('+66 81 234 5678'), '66812345678');
    assert.equal(T.digitsForWhatsApp('123'), null);
    assert.ok(T.whatsappLink('9876543210', 'Hi there').startsWith('https://wa.me/919876543210?text=Hi%20there'));
    assert.ok(T.gmailLink('a@b.com', 'S', 'B').includes('to=a%40b.com&su=S&body=B'));
  });

  await test('choosing a package ticks its inclusions and swaps them on change', async () => {
    const { inclusionsForPackage } = await import('../lib/constants');
    let inc = inclusionsForPackage(['Meals'], null, 'land_package');
    assert.deepEqual(inc, ['Meals', 'Hotel', 'Airport transfers', 'Full sightseeing']);
    inc = inclusionsForPackage(inc, 'land_package', 'hotel_only');
    assert.deepEqual(inc, ['Meals', 'Hotel'], 'hand-ticked Meals stays; the land-package extras go');
    assert.deepEqual(inclusionsForPackage(inc, 'hotel_only', 'transfers'), ['Meals', 'Inter-city transport']);
    assert.deepEqual(inclusionsForPackage([], null, 'flights_only'), ['Flights']);
    assert.deepEqual(inclusionsForPackage([], null, 'visa_only'), ['Visa']);
    assert.deepEqual(parseEnquiry('Goa transfers only 2 adults', '2026-10-25').inclusions, ['Inter-city transport', 'Airport transfers']);
    const r = await C.createLead(ACTOR, C.parseLeadInput(g({ client_name: 'Transfer Only', destination: 'Goa', package_type: 'transfers' })));
    assert.equal((await C.getLead(r.id))!.package_type, 'transfers');
  });

  // ───────── auth
  await test('first password, login, wrong password lockout', async () => {
    assert.equal(await auth.isPasswordSet(), false);
    await rejects(() => auth.setInitialPassword('short', 'short'), 'at least 8');
    await auth.setInitialPassword('skyroad crm pass', 'skyroad crm pass');
    await rejects(() => auth.setInitialPassword('another one!', 'another one!'), 'already been set');
    const token = await auth.login('skyroadholidays', 'skyroad crm pass', '1.1.1.1', 'test');
    assert.equal((await auth.validateSession(token))?.username, 'Skyroadholidays');
    for (let i = 0; i < 5; i++) await rejects(() => auth.login('Skyroadholidays', 'wrong', '2.2.2.2', 't'), 'incorrect');
    await rejects(() => auth.login('Skyroadholidays', 'skyroad crm pass', '2.2.2.2', 't'), 'too many');
    assert.ok(await auth.login('Skyroadholidays', 'skyroad crm pass', '3.3.3.3', 't'), 'other devices still work');
  });

  // ───────── suppliers
  let dmc = 0, dmc2 = 0, hotel = 0;
  await test('suppliers: add, validate, unique names', async () => {
    dmc = await C.saveSupplier(ACTOR, g({ name: 'Siam DMC', email: 'rates@siamdmc.example', whatsapp: '+66 81 234 5678', contact_person: 'Somchai', destinations: 'Thailand, Vietnam' }));
    dmc2 = await C.saveSupplier(ACTOR, g({ name: 'Andaman Holidays', email: 'ops@andaman.example', destinations: 'Thailand' }));
    hotel = await C.saveSupplier(ACTOR, g({ name: 'Bali Bliss', destinations: 'Bali' }));
    await rejects(() => C.saveSupplier(ACTOR, g({ name: 'siam dmc' })), 'already exists');
    await rejects(() => C.saveSupplier(ACTOR, g({ name: 'X', email: 'not-an-email' })), 'does not look right');
    await C.saveSupplier(ACTOR, g({ id: dmc, name: 'Siam DMC', email: 'rates@siamdmc.example', contact_person: 'Khun Somchai', destinations: 'Thailand, Vietnam' }));
    assert.equal((await C.getSupplier(dmc))?.contact_person, 'Khun Somchai');
  });

  // ───────── the full journey
  let lead = 0;
  await test('new enquiry saves with all details, once (no duplicates on resubmit)', async () => {
    const input = C.parseLeadInput(g({ client_name: 'Asha Rao', phone: '98765 43210', lead_source: 'Instagram', destination: 'Thailand', trip_type: 'international',
      travel_start: addDays(today, 40), travel_end: addDays(today, 45), adults: '2', children: '1', child_ages: '6', nights_plan: '2N Krabi, 3N Phuket',
      hotel_category: '4 Star', package_type: 'land_package', budget: '1,50,000', next_follow_up: addDays(today, 1) }),
      (k) => (k === 'inclusions' ? ['Hotel', 'Airport transfers', 'Full sightseeing', 'Hotel'] : []));
    const r = await C.createLead(ACTOR, input, 'idem-lead-1');
    const again = await C.createLead(ACTOR, input, 'idem-lead-1');
    assert.equal(again.id, r.id);
    assert.ok(again.duplicate);
    lead = r.id;
    const l = (await C.getLead(lead))!;
    assert.match(l.lead_no, /^SRQ-\d{5}$/);
    assert.equal(l.stage, 'new_query');
    assert.deepEqual(l.inclusions, ['Hotel', 'Airport transfers', 'Full sightseeing']);
    assert.equal(l.pax, 3);
    assert.equal(l.nights, 5);
    assert.equal(l.budget, '150000.00');
    assert.equal((await C.listActivity(lead)).length, 1);
  });
  await test('enquiry validation gives clear messages', async () => {
    assert.throws(() => C.parseLeadInput(g({ destination: 'Goa' })), /client name/);
    assert.throws(() => C.parseLeadInput(g({ client_name: 'A' })), /destination/);
    assert.throws(() => C.parseLeadInput(g({ client_name: 'A', destination: 'Goa', travel_start: '2026-12-06', travel_end: '2026-12-01' })), /cannot be before/);
    assert.throws(() => C.parseLeadInput(g({ client_name: 'A', destination: 'Goa', adults: '0' })), /at least one traveller/);
    assert.throws(() => C.parseLeadInput(g({ client_name: 'A', destination: 'Goa', email: 'x@' })), /email/);
    assert.throws(() => C.parseLeadInput(g({ client_name: 'A', destination: 'Goa', budget: 'abc' })), /Budget/);
    // and the database enforces the same rules if the app were bypassed
    await rejects(() => sql`insert into crm.lead (client_name, destination, travel_start, travel_end) values ('A', 'B', '2026-12-06', '2026-12-01')`, 'cannot be before');
  });
  await test('asking suppliers moves New query → Supplier mail sent (once per supplier)', async () => {
    await rejects(() => C.requestQuotes(ACTOR, lead, [], 'email'), 'at least one supplier');
    const added = await C.requestQuotes(ACTOR, lead, [dmc, dmc2], 'email');
    assert.equal(added, 2);
    assert.equal(await C.requestQuotes(ACTOR, lead, [dmc], 'whatsapp'), 0, 're-sending does not duplicate');
    const l = (await C.getLead(lead))!;
    assert.equal(l.stage, 'supplier_mailed');
    assert.equal(l.quotes_requested, 2);
    const acts = await C.listActivity(lead);
    assert.ok(acts.some((a) => a.kind === 'stage' && a.body.includes('Supplier mail sent (automatic')));
  });
  await test('a supplier quote moves to Quote received; selecting one sets cost and margin', async () => {
    const qs = await C.listQuotes(lead);
    const q1 = qs.find((q) => q.supplier_id === dmc)!, q2 = qs.find((q) => q.supplier_id === dmc2)!;
    await rejects(() => C.updateQuote(ACTOR, q1.id, g({ status: 'received' })), 'quoted amount');
    await C.updateQuote(ACTOR, q1.id, g({ status: 'received', amount: '1,18,000', currency: 'inr', notes: 'Aonang Villa + Kata Rocks' }));
    let l = (await C.getLead(lead))!;
    assert.equal(l.stage, 'quote_received');
    assert.equal(l.best_quote, '118000.00');
    await C.updateQuote(ACTOR, q2.id, g({ status: 'received', amount: '112000' }));
    await C.updateQuote(ACTOR, q2.id, g({ status: 'selected', amount: '112000' }));
    await C.updateQuote(ACTOR, q1.id, g({ status: 'selected', amount: '118000' }));
    const after = await C.listQuotes(lead);
    assert.equal(after.filter((q) => q.status === 'selected').length, 1, 'only one selected supplier');
    l = (await C.getLead(lead))!;
    assert.equal(l.selected_supplier, 'Siam DMC');
    assert.equal(l.supplier_cost, '118000.00');
    assert.equal(l.best_quote, '112000.00');
    await rejects(() => C.updateQuote(ACTOR, q1.id, g({ status: 'received', amount: '5', currency: 'RUPEES' })), '3-letter');
  });
  await test('sharing the quote → Quote shared, margin, and a follow-up in 2 days', async () => {
    await rejects(() => C.shareQuote(ACTOR, lead, g({ quote_amount: '' })), 'package price');
    await rejects(() => C.shareQuote(ACTOR, lead, g({ quote_amount: '145000', itinerary_url: 'canva.com/x' })), 'https://');
    await C.shareQuote(ACTOR, lead, g({ quote_amount: '1,45,000', itinerary_url: 'https://www.canva.com/design/ABC/view' }));
    const l = (await C.getLead(lead))!;
    assert.equal(l.stage, 'quote_shared');
    assert.equal(l.margin, '27000.00');
    assert.equal(l.next_follow_up, addDays(today, 2));
    assert.ok(l.quote_shared_at);
  });
  await test('a call after the quote → Follow-up; notes alone do not move the stage', async () => {
    await rejects(() => C.logInteraction(ACTOR, lead, g({ kind: 'call', body: '' })), 'short note');
    await C.logInteraction(ACTOR, lead, g({ kind: 'note', body: 'Prefers pool villa' }));
    assert.equal((await C.getLead(lead))!.stage, 'quote_shared');
    await C.logInteraction(ACTOR, lead, g({ kind: 'call', body: 'Discussing with family', next_follow_up: addDays(today, 3) }));
    const l = (await C.getLead(lead))!;
    assert.equal(l.stage, 'follow_up');
    assert.equal(l.next_follow_up, addDays(today, 3));
  });
  await test('confirming with an advance → Advance received, balance due worked out', async () => {
    await C.confirmBooking(ACTOR, lead, g({ booking_ref: 'SR-THA-101', advance_amount: '50,000', advance_date: today, advance_mode: 'UPI' }));
    const l = (await C.getLead(lead))!;
    assert.equal(l.stage, 'advance_received');
    assert.equal(l.booking_ref, 'SR-THA-101');
    assert.equal(l.paid, '50000.00');
    assert.equal(l.balance_due, '95000.00');
    assert.ok(l.confirmed_at);
    const acts = await C.listActivity(lead);
    assert.ok(acts.some((a) => a.body.includes('Booking confirmed (automatic') || a.body.startsWith('Booking confirmed')));
  });
  await test('final payment → Final payment received; deleting it steps back to Advance', async () => {
    await rejects(() => C.addPayment(ACTOR, lead, g({ kind: 'final', amount: '95000', date: addDays(today, 1) })), 'future');
    await rejects(() => C.addPayment(ACTOR, lead, g({ kind: 'final', amount: '0' })), 'more than zero');
    await C.addPayment(ACTOR, lead, g({ kind: 'final', amount: '95000', date: today, mode: 'Bank transfer' }), 'idem-pay-1');
    await C.addPayment(ACTOR, lead, g({ kind: 'final', amount: '95000', date: today }), 'idem-pay-1'); // double click
    let l = (await C.getLead(lead))!;
    assert.equal(l.paid, '145000.00');
    assert.equal(l.balance_due, '0.00');
    assert.equal(l.stage, 'final_payment_received');
    const final = (await C.listPayments(lead)).find((p) => p.kind === 'final')!;
    await C.deletePayment(ACTOR, final.id);
    l = (await C.getLead(lead))!;
    assert.equal(l.stage, 'advance_received');
    assert.equal(l.balance_due, '95000.00');
    // part payments that add up to the full price also count as fully paid
    await C.addPayment(ACTOR, lead, g({ kind: 'other', amount: '95000', date: today }));
    assert.equal((await C.getLead(lead))!.stage, 'final_payment_received');
  });
  await test('confirmed trips become Travelling and Completed by date automatically', async () => {
    const mk = async (start: number, end: number, name: string) => {
      const r = await C.createLead(ACTOR, C.parseLeadInput(g({ client_name: name, destination: 'Goa', travel_start: addDays(today, start), travel_end: addDays(today, end) })));
      await C.confirmBooking(ACTOR, r.id, g({ quote_amount: '40000' }));
      return r.id;
    };
    const now = await mk(-1, 2, 'Now Travelling');
    const done = await mk(-10, -5, 'Back Home');
    const later = await mk(10, 12, 'Later Trip');
    assert.equal((await C.getLead(now))!.stage, 'travelling');
    assert.equal((await C.getLead(done))!.stage, 'completed');
    assert.equal((await C.getLead(later))!.stage, 'booking_confirmed');
    // an unconfirmed enquiry never shows as travelling, whatever its dates
    const r = await C.createLead(ACTOR, C.parseLeadInput(g({ client_name: 'Unsold', destination: 'Goa', travel_start: addDays(today, -1) })));
    assert.equal((await C.getLead(r.id))!.stage, 'new_query');
    const d = await C.getDashboard(today);
    assert.ok(d.travelling.some((x) => x.id === now));
    assert.ok(d.departures.some((x) => x.id === later));
  });
  await test('lost needs a reason, blocks payments, and confirming reopens it', async () => {
    const r = await C.createLead(ACTOR, C.parseLeadInput(g({ client_name: 'Price Shopper', destination: 'Dubai', lead_source: 'Google' })));
    await rejects(() => C.setStage(ACTOR, r.id, 'lost', null, ''), 'why it was lost');
    await C.setStage(ACTOR, r.id, 'lost', null, 'Booked elsewhere – cheaper');
    let l = (await C.getLead(r.id))!;
    assert.equal(l.stage, 'lost');
    assert.ok(l.closed_at);
    await C.requestQuotes(ACTOR, r.id, [dmc], 'email');
    assert.equal((await C.getLead(r.id))!.stage, 'lost', 'automations never revive a lost enquiry');
    await rejects(() => C.addPayment(ACTOR, r.id, g({ kind: 'advance', amount: '1000' })), 'marked Lost');
    await C.confirmBooking(ACTOR, r.id, g({ quote_amount: '60000' }));
    l = (await C.getLead(r.id))!;
    assert.equal(l.stage, 'booking_confirmed');
    assert.equal(l.lost_reason, null);
    await rejects(() => C.setStage(ACTOR, r.id, 'not_a_stage'), 'valid stage');
  });
  await test('editing keeps the stage; booking refs are unique', async () => {
    const l = (await C.getLead(lead))!;
    await C.updateLead(ACTOR, lead, C.parseLeadInput(g({ ...l, adults: '3', inclusions: 'Hotel, Flights' })));
    const e = (await C.getLead(lead))!;
    assert.equal(e.adults, 3);
    assert.deepEqual(e.inclusions, ['Hotel', 'Flights']);
    assert.equal(e.stage, 'final_payment_received');
    const other = await C.createLead(ACTOR, C.parseLeadInput(g({ client_name: 'Dup Ref', destination: 'Bali' })));
    await rejects(() => C.confirmBooking(ACTOR, other.id, g({ booking_ref: 'sr-tha-101', quote_amount: '1000' })), 'booking reference is already used');
  });
  await test('follow-ups: overdue / today / upcoming / none buckets', async () => {
    const a = await C.createLead(ACTOR, C.parseLeadInput(g({ client_name: 'Overdue One', destination: 'Bali', next_follow_up: addDays(today, -2) })));
    const b = await C.createLead(ACTOR, C.parseLeadInput(g({ client_name: 'Today One', destination: 'Bali', next_follow_up: today })));
    const f = await C.followUps(today);
    assert.ok(f.overdue.some((x) => x.id === a.id));
    assert.ok(f.due.some((x) => x.id === b.id));
    await C.setFollowUp(ACTOR, a.id, addDays(today, 3), 'Send hotel options');
    const f2 = await C.followUps(today);
    assert.ok(f2.upcoming.some((x) => x.id === a.id));
    await C.setFollowUp(ACTOR, a.id, null, null);
    assert.ok((await C.followUps(today)).none.some((x) => x.id === a.id));
  });
  await test('delete is soft and restorable; permanent delete is blocked', async () => {
    const r = await C.createLead(ACTOR, C.parseLeadInput(g({ client_name: 'Oops', destination: 'Bali' })));
    await C.softDeleteLead(ACTOR, r.id);
    assert.ok(!(await C.listLeads({ q: 'Oops' })).length);
    assert.ok((await C.listDeletedLeads()).some((x) => x.id === r.id));
    await C.restoreLead(ACTOR, r.id);
    assert.ok((await C.listLeads({ q: 'Oops' })).length);
    await rejects(() => sql`delete from crm.lead where id = ${r.id}::int`, 'cannot be permanently deleted');
    const [{ n: audits }] = await sql<{ n: number }>`select count(*)::int as n from crm.audit_log where table_name = 'lead' and record_id = ${String(r.id)}::text and action in ('soft_delete','restore')`;
    assert.equal(audits, 2);
  });
  await test('lists, filters and search (including by supplier name)', async () => {
    assert.ok((await C.listLeads({ stage: 'lost' })).every((l) => l.stage === 'lost'));
    assert.ok((await C.listLeads({ scope: 'won' })).length >= 4);
    assert.ok((await C.listLeads({ scope: 'open' })).every((l) => ['new_query', 'supplier_mailed', 'quote_received', 'quote_shared', 'follow_up'].includes(l.stage)));
    assert.ok((await C.listLeads({ source: 'Instagram' })).some((l) => l.id === lead));
    assert.ok((await C.listLeads({ q: '98765' })).some((l) => l.id === lead));
    assert.ok((await C.listLeads({ q: 'Andaman Holidays' })).some((l) => l.id === lead));
    assert.equal((await C.listLeads({ q: '100%_' })).length, 0, 'wildcards are literal');
    const s = await C.search('siam');
    assert.ok(s.suppliers.some((x) => x.id === dmc));
    assert.ok(s.leads.some((x) => x.id === lead));
    assert.ok((await C.listQuotesForSupplier(dmc)).some((q) => q.lead_id === lead));
    assert.equal((await C.listSuppliers()).find((x) => x.id === hotel)?.requests, 0);
  });
  await test('dashboard counts match the enquiries', async () => {
    const d = await C.getDashboard(today);
    const all = await C.listLeads({}, 2000);
    const byStage = (s: string) => all.filter((l) => l.stage === s).length;
    for (const [stage, v] of Object.entries(d.stageCounts)) assert.equal(v.count, byStage(stage), stage);
    assert.equal(d.openCount, all.filter((l) => ['new_query', 'supplier_mailed', 'quote_received', 'quote_shared', 'follow_up'].includes(l.stage)).length);
    assert.equal(d.monthNew, all.length);
    assert.ok(d.monthConfirmed >= 5);
    assert.equal(d.monthly.length, 12);
    assert.ok(d.sources.some((s) => s.source === 'Instagram' && s.won === 1));
    assert.ok(d.followOverdue.every((l) => l.next_follow_up! < today));
  });
  await test('every report runs and exports to CSV', async () => {
    for (const k of Object.keys(REPORTS) as ReportKey[]) {
      const r = await runReport(k, addDays(today, -400), today, 'test');
      const csv = reportToCsv(r);
      assert.ok(csv.charCodeAt(0) === 0xfeff && csv.includes(r.title), k);
    }
    const funnel = await runReport('funnel', addDays(today, -30), today, 'this month');
    assert.equal(funnel.rows.length, 11);
    const suppliers = await runReport('suppliers', addDays(today, -30), today, 'this month');
    assert.ok(suppliers.rows.some((r) => r.supplier === 'Siam DMC' && r.selected === 1));
    const pay = await runReport('payments', today, today, 'x');
    assert.ok(pay.rows.every((r) => Number(r.balance_due) > 0));
    const backup = JSON.parse(await C.exportAll());
    assert.ok(backup.tables.lead.length > 5 && backup.tables.activity.length > 10);
  });

  console.log(results.join('\n'));
  console.log(`\n${passed} application tests passed`);
  end();
}

main().catch((e) => { console.error(e); process.exit(1); });
