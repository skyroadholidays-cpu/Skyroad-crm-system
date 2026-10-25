// Turns a quick enquiry note into form fields, e.g.
//
//   new q
//   Thailand
//   1 dec to 6 Dec
//   2 adults
//   2N Krabi, 3N Phuket
//
// Pure function (no server code) so the form can use it in the browser and
// tests can check it directly. It only fills what it recognises; anything it
// is unsure about is left for you.
import { PACKAGE_INCLUSIONS } from './constants';

export interface ParsedEnquiry {
  client_name?: string;
  phone?: string;
  email?: string;
  destination?: string;
  trip_type?: 'domestic' | 'international';
  travel_start?: string;
  travel_end?: string;
  adults?: number;
  children?: number;
  child_ages?: string;
  infants?: number;
  nights_plan?: string;
  hotel_category?: string;
  package_type?: 'land_package' | 'hotel_only' | 'transfers' | 'flights_only' | 'visa_only';
  inclusions?: string[];
  budget?: string;
  budget_basis?: 'total' | 'per_person';
  lead_source?: string;
  requirements?: string;
  city?: string;
  flexible_dates?: boolean;
  rooms?: number;
  meal_plan?: string;
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
};
const monthOf = (s: string | undefined) => (s ? MONTHS[s.toLowerCase().replace(/\.$/, '')] : undefined);

const DOMESTIC = ['india', 'goa', 'kerala', 'kashmir', 'srinagar', 'gulmarg', 'pahalgam', 'manali', 'shimla', 'himachal', 'andaman', 'port blair', 'havelock',
  'rajasthan', 'jaipur', 'udaipur', 'jaisalmer', 'jodhpur', 'ladakh', 'leh', 'sikkim', 'gangtok', 'darjeeling', 'ooty', 'coorg', 'munnar', 'alleppey',
  'uttarakhand', 'rishikesh', 'nainital', 'mussoorie', 'meghalaya', 'shillong', 'kaziranga', 'gujarat', 'kutch', 'varanasi', 'agra', 'delhi', 'mumbai',
  'lakshadweep', 'pondicherry', 'puducherry', 'hampi', 'mysore', 'kodaikanal', 'north east', 'arunachal', 'spiti', 'dharamshala', 'char dham', 'kedarnath',
  'tirupati', 'amritsar', 'chikmagalur', 'wayanad', 'mahabaleshwar', 'lonavala', 'auli', 'dalhousie', 'kasol', 'odisha', 'puri'];
const INTERNATIONAL = ['thailand', 'phuket', 'krabi', 'bangkok', 'pattaya', 'koh samui', 'bali', 'indonesia', 'dubai', 'uae', 'abu dhabi', 'singapore',
  'malaysia', 'kuala lumpur', 'langkawi', 'vietnam', 'hanoi', 'ho chi minh', 'da nang', 'maldives', 'sri lanka', 'nepal', 'bhutan', 'europe', 'switzerland',
  'paris', 'france', 'italy', 'london', 'uk', 'turkey', 'istanbul', 'japan', 'tokyo', 'korea', 'seoul', 'australia', 'new zealand', 'mauritius', 'seychelles',
  'egypt', 'usa', 'america', 'canada', 'georgia', 'azerbaijan', 'baku', 'kazakhstan', 'almaty', 'uzbekistan', 'hong kong', 'macau', 'china', 'cambodia',
  'philippines', 'greece', 'spain', 'kenya', 'south africa', 'oman', 'qatar', 'doha', 'saudi', 'jordan', 'israel', 'russia', 'iceland', 'norway', 'finland',
  'scandinavia', 'cruise', 'phi phi', 'vienna', 'germany', 'amsterdam', 'netherlands', 'prague', 'scotland', 'ireland', 'laos', 'myanmar', 'mongolia'];

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
function valid(y: number, m: number, d: number) {
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
function addDays(s: string, n: number) {
  const d = new Date(`${s}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const fullYear = (y: string | undefined) => (y ? (y.length === 2 ? 2000 + Number(y) : Number(y)) : undefined);

/** Builds start/end, choosing the next future occurrence when no year is given. */
function makeRange(today: string, d1: number, m1: number | undefined, y1: number | undefined, d2: number, m2: number | undefined, y2: number | undefined) {
  const sm = m1 ?? m2, em = m2 ?? m1;
  if (!sm || !em) return null;
  const ty = Number(today.slice(0, 4));
  let sy = y1 ?? (y2 && sm > em ? y2 - 1 : y2) ?? ty;
  if (!y1 && !y2 && iso(sy, sm, d1) < today) sy += 1;
  let ey = y2 ?? sy;
  if (!y2 && (em < sm || (em === sm && d2 < d1))) ey = sy + 1;
  if (!valid(sy, sm, d1) || !valid(ey, em, d2)) return null;
  const start = iso(sy, sm, d1), end = iso(ey, em, d2);
  return end >= start ? { start, end } : null;
}

function parseDates(text: string, today: string): { start?: string; end?: string; matched?: string } {
  const sep = String.raw`\s*(?:to|till|until|-|–|—|~)\s*`;
  const ord = String.raw`(?:st|nd|rd|th)?`;
  const mon = String.raw`([A-Za-z]{3,9}\.?)`;
  // 1 dec to 6 dec | 1-6 Dec | 28 Dec 2026 to 3 Jan 2027 | 1st Dec - 6th Dec
  for (const m of text.matchAll(new RegExp(String.raw`\b(\d{1,2})${ord}(?:\s*${mon})?(?:\s*,?\s*(\d{4}))?${sep}(\d{1,2})${ord}\s*${mon}(?:\s*,?\s*(\d{2,4}))?`, 'gi'))) {
    if (!monthOf(m[5]) || (m[2] && !monthOf(m[2]))) continue;
    const r = makeRange(today, Number(m[1]), monthOf(m[2]), fullYear(m[3]), Number(m[4]), monthOf(m[5]), fullYear(m[6]));
    if (r) return { ...r, matched: m[0] };
  }
  // Dec 1 to Dec 6 | Dec 1-6
  for (const m of text.matchAll(new RegExp(String.raw`\b${mon}\s*(\d{1,2})${ord}(?:\s*,?\s*(\d{4}))?${sep}(?:${mon}\s*)?(\d{1,2})${ord}(?:\s*,?\s*(\d{4}))?`, 'gi'))) {
    if (!monthOf(m[1]) || (m[4] && !monthOf(m[4]))) continue;
    const r = makeRange(today, Number(m[2]), monthOf(m[1]), fullYear(m[3]), Number(m[5]), monthOf(m[4]) ?? monthOf(m[1]), fullYear(m[6]));
    if (r) return { ...r, matched: m[0] };
  }
  // 01/12/2026 to 06/12/2026 | 1.12 - 6.12   (day first, Indian style)
  const m = text.match(new RegExp(String.raw`\b(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?${sep}(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?`));
  if (m) {
    const r = makeRange(today, Number(m[1]), Number(m[2]), fullYear(m[3]), Number(m[4]), Number(m[5]), fullYear(m[6]) ?? fullYear(m[3]));
    if (r) return { ...r, matched: m[0] };
  }
  // single date: "from 1 Dec", "1 Dec 2026", "dep 1st dec"
  for (const s of text.matchAll(new RegExp(String.raw`\b(\d{1,2})${ord}\s*${mon}(?:\s*,?\s*(\d{4}))?`, 'gi'))) {
    if (!monthOf(s[2])) continue;
    const r = makeRange(today, Number(s[1]), monthOf(s[2]), fullYear(s[3]), Number(s[1]), monthOf(s[2]), fullYear(s[3]));
    if (r) return { start: r.start, matched: s[0] };
  }
  for (const s of text.matchAll(new RegExp(String.raw`\b${mon}\s*(\d{1,2})${ord}\b(?:\s*,?\s*(\d{4}))?`, 'gi'))) {
    if (!monthOf(s[1])) continue;
    const r = makeRange(today, Number(s[2]), monthOf(s[1]), fullYear(s[3]), Number(s[2]), monthOf(s[1]), fullYear(s[3]));
    if (r) return { start: r.start, matched: s[0] };
  }
  return {};
}

function words(n: string) {
  const w: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  return /^\d+$/.test(n) ? Number(n) : w[n.toLowerCase()];
}

/**
 * Reads an enquiry. When it is written in the fixed order – one item per line –
 *   1 Name (+ phone)   2 City   3 Dates   4 Destination (+ nights)   5 Travellers   6 Package
 * each line is read as exactly that item. Lines may also carry labels in any
 * order ("City: Mumbai"). Anything else falls back to best-guess reading.
 */
export function parseEnquiry(input: string, today: string): ParsedEnquiry {
  return parseOrdered(input, today) ?? parseFree(input, today);
}

export const ORDER = ['name', 'city', 'dates', 'destination', 'pax', 'package'] as const;
export type Slot = (typeof ORDER)[number];
export const SLOT_LABEL: Record<Slot, string> = { name: 'Name', city: 'City', dates: 'Dates', destination: 'Destination', pax: 'Travellers', package: 'Package' };
export const ORDER_TEMPLATE = 'Rahul Shah 98765 43210\nMumbai\n1 Dec to 6 Dec\nThailand – 2N Krabi, 3N Phuket\n2 adults 1 child\nCustomised package, 2 rooms, MAP';
/** Placeholder for the quick-add box: the order, with an example for each line. */
export const ORDER_PLACEHOLDER = [
  '1. Name + mobile   →  Rahul Shah 98765 43210',
  '2. City            →  Mumbai',
  '3. Dates           →  1 Dec to 6 Dec',
  '4. Destination     →  Thailand – 2N Krabi, 3N Phuket',
  '5. Travellers      →  2 adults 1 child',
  '6. Package         →  Customised package, 2 rooms, MAP',
  '   (extra lines → special requests, e.g. Pickup & drop at Cochin airport)',
].join('\n');

const HEADER_LINE = /^(new\s*(q|query|enquiry|inquiry|lead)|enquiry|inquiry|query|lead)\b[\s:.\-!]*$/i;
const LABELS: [Slot, RegExp][] = [
  ['name', /^(name(?:\s*(?:\+|&|and|\/)\s*(?:mobile|phone|number|contact|no\.?))?|client|guest|customer)(?:\s*\([^)]*\))?\s*[:\-–]\s*/i],
  ['city', /^(city|from city|from|location|based in)(?:\s*\([^)]*\))?\s*[:\-–]\s*/i],
  ['dates', /^(dates?|travel dates?|when|travel)(?:\s*\([^)]*\))?\s*[:\-–]\s*/i],
  ['destination', /^(destination|dest|place|trip|to|going to)(?:\s*\([^)]*\))?\s*[:\-–]\s*/i],
  ['pax', /^(pax|no\.? of pax|travell?ers|people|persons|guests|members)(?:\s*\([^)]*\))?\s*[:\-–]\s*/i],
  ['package', /^(package|service|services|type|need|needs|booking)(?:\s*\([^)]*\))?\s*[:\-–]\s*/i],
];
/** "1. ", "2) " at the start of a line (the numbered quick form). */
const LINE_NUMBER = /^\d{1,2}\s*[.)]\s+/;
/** Optional labelled lines of the quick form that are read elsewhere (never a main slot, never a special request). */
const EXTRA_LABEL = /^(hotel(?:\s*category)?|category|star|rooms?|no\.? of rooms|meal\s*plan|meals?|budget|lead\s*source|source)\s*[:\-–]/i;
const NOTE_LABEL = /^(notes?|remarks?|special\s*requests?|requirements?)\s*[:\-–]\s*/i;
const NO_DATES = /\b(tbc|tba|flexible|not decided|not fixed|any ?time|open)\b/i;

/** "2 rooms", "MAP", "breakfast", "half board" … anywhere in the text. */
export function parseRoomsMeal(text: string): { rooms?: number; meal_plan?: string } {
  const out: { rooms?: number; meal_plan?: string } = {};
  const r = text.match(/\b(\d{1,3})\s*(?:rooms?|rms?|dbl rooms?|double rooms?)\b/i) ?? text.match(/\brooms?\s*[:\-–]?\s*(\d{1,3})\b/i);
  if (r) out.rooms = Number(r[1]);
  if (/\bMAPAI\b/.test(text)) out.meal_plan = 'MAPAI';
  else if (/\bAPAI\b/.test(text)) out.meal_plan = 'APAI';
  else if (/\bMAP\b/i.test(text) || /half[\s-]?board|breakfast\s*(?:\+|and|&)\s*dinner/i.test(text)) out.meal_plan = 'MAP';
  else if (/\bAI\b/.test(text) || /all[\s-]?inclusive/i.test(text)) out.meal_plan = 'AI';
  else if (/\bAP\b/.test(text) || /full[\s-]?board|all meals/i.test(text)) out.meal_plan = 'AP';
  else if (/\bCP\b/i.test(text) || /\bwith breakfast|breakfast only|\bbb\b/i.test(text)) out.meal_plan = 'CP';
  else if (/\bEP\b/i.test(text) || /room only/i.test(text)) out.meal_plan = 'EP';
  return out;
}
const ROOMS_MEAL_ONLY = /^(?:\s*(?:\d{1,3}\s*(?:rooms?|rms?)|rooms?\s*[:\-–]?\s*\d{1,3}|meal\s*plan\s*[:\-–]?|map|cp|ep|ap|ai|apai|mapai|half board|full board|all inclusive|breakfast(?:\s*(?:\+|and|&)\s*dinner)?)\s*[,;/+&-]?)+\s*$/i;

function isDateLine(line: string, today: string) {
  return !!parseDates(line, today).start || NO_DATES.test(line);
}

/** "2 adults 1 child", "2+1", "2A 1C 1I", "4 pax", "couple", "4" */
export function parsePax(line: string): { adults?: number; children?: number; infants?: number; child_ages?: string } {
  const l = line.toLowerCase().trim();
  const out: { adults?: number; children?: number; infants?: number; child_ages?: string } = {};
  const num = String.raw`(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten)`;
  const ad = l.match(new RegExp(`${num}\\s*(?:adults?|adlts?|a\\b|pax|people|persons?|ppl|guests?|travell?ers?|members?)`));
  const ch = l.match(new RegExp(`${num}\\s*(?:child(?:ren)?|kids?|cnb|cwb|chd|c\\b)(?:\\s*\\(([^)]*)\\))?`));
  const inf = l.match(new RegExp(`${num}\\s*(?:infants?|babies|baby|i\\b)`));
  if (ad) out.adults = words(ad[1]);
  if (ch) { out.children = words(ch[1]); if (ch[2]) out.child_ages = ch[2].trim(); }
  if (inf) out.infants = words(inf[1]);
  if (out.adults === undefined) {
    const plus = l.match(/^(\d{1,3})\s*\+\s*(\d{1,3})(?:\s*\+\s*(\d{1,3}))?/);
    if (plus) { out.adults = Number(plus[1]); out.children = Number(plus[2]); if (plus[3]) out.infants = Number(plus[3]); }
    else if (/^\d{1,3}$/.test(l)) out.adults = Number(l);
    else if (/\b(couple|honeymoon)\b/.test(l)) out.adults = 2;
    else { const fam = l.match(/family of (\d{1,2})/); if (fam) out.adults = Number(fam[1]); }
  }
  return out;
}

/** "Customised package", "hotel only", "hotel + flight", "transfers", "visa" */
export function parsePackage(line: string): { package_type?: ParsedEnquiry['package_type']; inclusions: string[] } {
  const l = line.toLowerCase();
  const found: { at: number; type: NonNullable<ParsedEnquiry['package_type']> }[] = [];
  const add = (re: RegExp, type: NonNullable<ParsedEnquiry['package_type']>) => { const m = re.exec(l); if (m) found.push({ at: m.index, type }); };
  add(/custom|package|land|tour|sightseeing|full/, 'land_package');
  add(/hotel|stay|room|resort/, 'hotel_only');
  add(/transfer|cab|taxi|car|innova|tempo|coach|bus/, 'transfers');
  add(/flight|air|ticket/, 'flights_only');
  add(/visa/, 'visa_only');
  found.sort((a, b) => a.at - b.at);
  const inc = new Set<string>();
  for (const f of found) for (const x of PACKAGE_INCLUSIONS[f.type] ?? []) inc.add(x);
  if (/insurance/.test(l)) inc.add('Travel insurance');
  if (/meal|breakfast/.test(l)) inc.add('Meals');
  return { package_type: found[0]?.type, inclusions: [...inc] };
}

function parseOrdered(input: string, today: string): ParsedEnquiry | null {
  const lines = input.replace(/\r/g, '').split(/\n|\s*\|\s*/).map((l) => l.trim().replace(LINE_NUMBER, '').trim())
    // drop empty labelled lines such as "Budget:" left blank
    .filter((l) => l && !HEADER_LINE.test(l) && !/^[A-Za-z .+&/()]{2,40}[:\-–]\s*$/.test(l));
  if (lines.length < 3) return null;
  const labelled = lines.filter((l) => LABELS.some(([, re]) => re.test(l))).length;
  if (labelled < 2 && !(lines.length >= 4 && isDateLine(lines[2], today))) return null;

  const slot: Partial<Record<Slot, string>> = {};
  const free: string[] = [];
  const notes: string[] = [];
  for (const line of lines) {
    if (EXTRA_LABEL.test(line)) continue; // read below from the whole text
    if (NOTE_LABEL.test(line)) { notes.push(line.replace(NOTE_LABEL, '').trim()); continue; }
    const lab = LABELS.find(([k, re]) => re.test(line) && !slot[k]);
    if (lab) slot[lab[0]] = line.replace(lab[1], '').trim();
    else free.push(line);
  }
  const extra: string[] = [];
  for (const line of free) {
    const next = ORDER.find((k) => slot[k] === undefined);
    if (next) slot[next] = line; else extra.push(line);
  }

  const out: ParsedEnquiry = {};
  // 1 name (+ phone / email)
  if (slot.name) {
    let n = slot.name;
    const email = n.match(/[^\s@,;]+@[^\s@,;]+\.[A-Za-z]{2,}/);
    if (email) { out.email = email[0]; n = n.replace(email[0], ' '); }
    const phone = n.match(/\+?\d[\d\s-]{8,15}\d/);
    if (phone && phone[0].replace(/\D/g, '').length >= 10) { out.phone = phone[0].replace(/[\s-]/g, ''); n = n.replace(phone[0], ' '); }
    n = n.replace(/^(mr|mrs|ms|dr)\.?\s+/i, (m) => m).replace(/[,;:\-–|]+\s*$/, '').replace(/\s+/g, ' ').trim();
    if (n) out.client_name = n.slice(0, 120);
  }
  // 2 city
  if (slot.city) out.city = slot.city.replace(/[,;.]+$/, '').trim().slice(0, 80);
  // 3 dates
  if (slot.dates) {
    const d = parseDates(slot.dates, today);
    if (d.start) out.travel_start = d.start;
    if (d.end) out.travel_end = d.end;
    if (/flexible|tbc|tba|not fixed|not decided/i.test(slot.dates)) out.flexible_dates = true;
  }
  // 4 destination (+ nights plan)
  if (slot.destination) {
    const t = slot.destination;
    const legRe = /(\d{1,2})\s*(?:n|nts?|nights?)\b\s*(?:in\s+|at\s+)?([A-Za-z][A-Za-z .'()/-]*?)(?=\s*(?:,|\+|&|\/(?=\s*\d)|\band\b|$|\d{1,2}\s*(?:n|nts?|nights?)\b))/gi;
    const legs = [...t.matchAll(legRe)].map((m) => ({ n: Number(m[1]), place: m[2].trim().replace(/\b\w/g, (c) => c.toUpperCase()), at: m.index ?? 0 }))
      .filter((x) => x.place && !/^(stay|d|days?)$/i.test(x.place));
    if (legs.length) out.nights_plan = legs.map((x) => `${x.n}N ${x.place}`).join(', ');
    // "Bali - 5N" (total nights, no places): keep "Bali" as the destination
    const head = (legs.length ? t.slice(0, legs[0].at) : t.replace(/\s*[-–,(]?\s*\d{1,2}\s*(?:n|nts?|nights?)\b\)?\s*$/i, '')).replace(/[\s,;:\-–(]+$/, '').trim();
    out.destination = (head || legs.map((x) => x.place).join(' + ')).slice(0, 120);
    const total = legs.reduce((a, x) => a + x.n, 0);
    if (out.travel_start && !out.travel_end && total) out.travel_end = addDays(out.travel_start, total);
    const dd = `${out.destination} ${out.nights_plan ?? ''}`;
    const has = (list: string[]) => list.some((w) => new RegExp(`\\b${w}\\b`, 'i').test(dd));
    if (has(DOMESTIC)) out.trip_type = 'domestic';
    else if (has(INTERNATIONAL)) out.trip_type = 'international';
  }
  // 5 travellers
  if (slot.pax) Object.assign(out, parsePax(slot.pax));
  // 6 package
  if (slot.package) {
    const p = parsePackage(slot.package);
    if (p.package_type) out.package_type = p.package_type;
    if (p.inclusions.length) out.inclusions = p.inclusions;
  }
  // extras from anywhere: hotel stars, budget; leftover lines → special requests
  const all = lines.join('\n');
  const free2 = parseFree(all, today);
  if (free2.hotel_category) out.hotel_category = free2.hotel_category;
  if (free2.budget) { out.budget = free2.budget; out.budget_basis = free2.budget_basis; }
  if (free2.lead_source) out.lead_source = free2.lead_source;
  Object.assign(out, parseRoomsMeal(all));
  const req = [...extra.filter((x) => !ROOMS_MEAL_ONLY.test(x)), ...notes.filter(Boolean)];
  if (req.length) out.requirements = req.join('\n').slice(0, 2000);
  return out;
}

/** Which of the six key items a reading found – used to show "missing" after Fill. */
export function slotsFound(r: ParsedEnquiry): Record<Slot, boolean> {
  return { name: !!r.client_name, city: !!r.city, dates: !!r.travel_start || !!r.flexible_dates, destination: !!r.destination,
    pax: r.adults !== undefined || r.children !== undefined, package: !!r.package_type };
}

function parseFree(input: string, today: string): ParsedEnquiry {
  const out: ParsedEnquiry = {};
  const text = input.replace(/\r/g, '').trim();
  if (!text) return out;
  const lower = text.toLowerCase();
  const used: string[] = [];

  // contact details
  const email = text.match(/[^\s@,;]+@[^\s@,;]+\.[A-Za-z]{2,}/);
  if (email) { out.email = email[0]; used.push(email[0]); }
  const phone = text.match(/(?:\+?\d[\d\s-]{8,15}\d)/);
  if (phone && phone[0].replace(/\D/g, '').length >= 10 && phone[0].replace(/\D/g, '').length <= 13) { out.phone = phone[0].replace(/[\s-]/g, ''); used.push(phone[0]); }
  const name = text.match(/\b(?:name|client|guest|customer|mr\.?|mrs\.?|ms\.?|dr\.?)\s*[:\-]?\s+([A-Za-z][A-Za-z.' ]{1,60}?)(?=\s*(?:[,\n|]|\+?\d|$))/i);
  if (name) { out.client_name = name[1].trim(); used.push(name[0]); }

  // dates
  const dates = parseDates(text, today);
  if (dates.start) out.travel_start = dates.start;
  if (dates.end) out.travel_end = dates.end;
  if (dates.matched) used.push(dates.matched);

  // nights split: "2N Krabi, 3N Phuket"  /  "2 nights Krabi + 3 nights Phuket"
  const legs: { n: number; place: string }[] = [];
  const legRe = /(\d{1,2})\s*(?:n|nts?|nights?)\b\s*(?:in\s+|at\s+)?([A-Za-z][A-Za-z .'()/-]*?)(?=\s*(?:,|\+|&|\/(?=\s*\d)|\band\b|\n|$|\d{1,2}\s*(?:n|nts?|nights?)\b))/gi;
  for (const m of text.matchAll(legRe)) {
    const place = m[2].trim().replace(/\s+/g, ' ');
    if (!place || /^(stay|d|days?)$/i.test(place)) continue;
    legs.push({ n: Number(m[1]), place: place.replace(/\b\w/g, (c) => c.toUpperCase()) });
    used.push(m[0]);
  }
  if (legs.length) out.nights_plan = legs.map((l) => `${l.n}N ${l.place}`).join(', ');
  const totalNights = legs.reduce((s, l) => s + l.n, 0) || Number(text.match(/\b(\d{1,2})\s*n\s*\/\s*\d{1,2}\s*d\b/i)?.[1] ?? text.match(/\b(\d{1,2})\s*nights?\b(?!\s*[A-Za-z])/i)?.[1] ?? 0);
  if (out.travel_start && !out.travel_end && totalNights > 0) out.travel_end = addDays(out.travel_start, totalNights);

  // travellers
  const num = String.raw`(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten)`;
  const ad = lower.match(new RegExp(`${num}\\s*(?:adults?|adlts?|pax|people|persons?|ppl|guests?|travell?ers?)\\b`));
  if (ad) { out.adults = words(ad[1]); used.push(ad[0]); }
  else if (/\b(couple|honeymoon|2a\b)/.test(lower)) out.adults = 2;
  const ch = lower.match(new RegExp(`${num}\\s*(?:child(?:ren)?|kids?|cnb|cwb|chd)\\b(?:\\s*\\(([^)]*)\\))?`));
  if (ch) { out.children = words(ch[1]); if (ch[2]) out.child_ages = ch[2].trim(); used.push(ch[0]); }
  const inf = lower.match(new RegExp(`${num}\\s*(?:infants?|babies|baby)\\b`));
  if (inf) { out.infants = words(inf[1]); used.push(inf[0]); }
  if (!out.child_ages) {
    const ages = text.match(/\b(?:child(?:ren)?|kids?)\s*(?:age[sd]?)?\s*[:\-]?\s*((?:\d{1,2}\s*(?:yrs?|years?)?\s*(?:,|&|and)?\s*)+)/i);
    if (ages && /\d/.test(ages[1]) && out.children) out.child_ages = ages[1].trim().replace(/[,&\s]+$/, '');
  }

  // hotel category
  const stars = text.match(/\b[2-7]\s*(?:\*|star|⭐|str)(?:\s*(?:deluxe|dlx|premium|superior))?(?:\s*(?:,|\/|&|and|or)\s*[2-7]\s*(?:\*|star|⭐|str)(?:\s*(?:deluxe|dlx|premium|superior))?)*/i);
  if (stars) out.hotel_category = stars[0].replace(/\s*(?:\*|⭐|str|star)/gi, ' star').replace(/\s+/g, ' ').replace(/^(\d) star$/i, '$1 Star').trim();
  else if (/\bluxury|boutique|premium\b/i.test(text)) out.hotel_category = 'Luxury / boutique';
  else if (/\bbudget hotel|economy\b/i.test(text)) out.hotel_category = 'Budget';

  // budget: "budget 1.5L", "budget ₹80,000 pp", "1.2 lakh"
  const bud = text.match(/\bbudget\s*(?:is|of|around|approx\.?|:|-)?\s*(?:rs\.?|inr|₹)?\s*([\d,]+(?:\.\d+)?)\s*(k|l|lakhs?|lacs?|lac)?\b(\s*(?:pp|per person|per pax|\/person|each))?/i);
  if (bud) {
    let v = Number(bud[1].replace(/,/g, ''));
    const unit = (bud[2] ?? '').toLowerCase();
    if (unit === 'k') v *= 1000;
    else if (unit.startsWith('l')) v *= 100000;
    if (v > 0) { out.budget = v.toFixed(2); out.budget_basis = bud[3] ? 'per_person' : 'total'; }
  }

  // package & inclusions
  const inc = new Set<string>();
  if (/land\s*package|land\s*only|tour\s*package|full\s*sightseeing|with\s*sightseeing/i.test(text)) out.package_type = 'land_package';
  else if (/hotel\s*only|only\s*hotel|stay\s*only/i.test(text)) out.package_type = 'hotel_only';
  else if (/transfers?\s*only|only\s*transfers?/i.test(text)) out.package_type = 'transfers';
  else if (/flights?\s*only|only\s*(?:air\s*)?tickets?/i.test(text)) out.package_type = 'flights_only';
  else if (/visa\s*only|only\s*visa/i.test(text)) out.package_type = 'visa_only';
  if (/\b(with|incl\.?|including|\+)\s*(?:air|flights?|airfare|tickets?)|flights?\s*(?:included|needed|required|also)\b/i.test(text)) inc.add('Flights');
  for (const x of (out.package_type && PACKAGE_INCLUSIONS[out.package_type]) || []) inc.add(x);
  if (/\bvisa\b/i.test(text) && out.package_type !== 'visa_only') inc.add('Visa');
  if (/insurance/i.test(text)) inc.add('Travel insurance');
  if (/\bcruise\b/i.test(text)) inc.add('Cruise');
  if (/\b(breakfast|meals?|half board|full board|all inclusive)\b/i.test(text)) inc.add('Meals');
  if (/\btransfers?\b/i.test(text)) inc.add('Airport transfers');
  if (/\bforex\b/i.test(text)) inc.add('Forex');
  if (inc.size) out.inclusions = [...inc];

  Object.assign(out, parseRoomsMeal(text));

  // lead source
  const src = text.match(/\b(?:source|via|from)\s*[:\-]?\s*(whatsapp|instagram|insta|facebook|fb|website|google|referral|reference|repeat)/i);
  if (src) {
    const s = src[1].toLowerCase();
    out.lead_source = s === 'insta' ? 'Instagram' : s === 'fb' ? 'Facebook' : s === 'reference' ? 'Referral' : s === 'repeat' ? 'Repeat client' : s[0].toUpperCase() + s.slice(1);
  }

  // destination: first short line that is only words and was not used above
  const skip = /^(new\s*(q|query|enquiry|inquiry|lead)|enquiry|inquiry|query|lead|hi|hello|dear)\b[\s:.\-!]*$/i;
  const lines = text.split(/\n|\|/).map((l) => l.trim()).filter(Boolean);
  for (const raw of lines) {
    let line = raw.replace(/^(?:new\s*(?:q|query|enquiry|inquiry|lead)|destination|dest|place|trip)\s*[:\-]?\s*/i, '').trim();
    if (!line || skip.test(raw)) continue;
    if (used.some((u) => u && line.includes(u.trim()))) continue;
    if (/\d/.test(line) || line.length > 40) continue;
    if (/\b(adults?|child|kids?|infant|budget|star|hotel|package|flight|visa|nights?|days?|name|phone|mail|source)\b/i.test(line)) continue;
    out.destination = line.replace(/\b\w/g, (c) => c.toUpperCase());
    break;
  }
  if (!out.destination) {
    let best: { i: number; w: string } | null = null;
    for (const w of [...INTERNATIONAL, ...DOMESTIC]) {
      if (w === 'cruise' || w === 'india') continue;
      const m = new RegExp(`\\b${w}\\b`, 'i').exec(text);
      if (m && (!best || m.index < best.i)) best = { i: m.index, w: m[0] };
    }
    if (best) out.destination = best.w.replace(/\b\w/g, (c) => c.toUpperCase());
  }
  if (!out.destination && legs.length) out.destination = legs.map((l) => l.place).join(' + ');

  const d = (out.destination ?? '') + ' ' + (out.nights_plan ?? '');
  const has = (list: string[]) => list.some((w) => new RegExp(`\\b${w}\\b`, 'i').test(d));
  if (has(DOMESTIC)) out.trip_type = 'domestic';
  else if (has(INTERNATIONAL)) out.trip_type = 'international';

  return out;
}

/** "2026-12-01".."2026-12-06" → "5N / 6D" */
export function durationLabel(start?: string | null, end?: string | null): string {
  if (!start || !end) return '';
  const n = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000);
  return n >= 0 ? `${n}N / ${n + 1}D` : '';
}
