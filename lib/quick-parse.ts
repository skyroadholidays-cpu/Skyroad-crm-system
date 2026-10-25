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
  package_type?: 'land_package' | 'hotel_only' | 'custom' | 'flights_only' | 'visa_only';
  inclusions?: string[];
  budget?: string;
  budget_basis?: 'total' | 'per_person';
  lead_source?: string;
  requirements?: string;
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

export function parseEnquiry(input: string, today: string): ParsedEnquiry {
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
  const legRe = /(\d{1,2})\s*(?:n|nts?|nights?)\b\s*(?:in\s+|at\s+)?([A-Za-z][A-Za-z .'()-]*?)(?=\s*(?:,|\+|&|\/|\band\b|\n|$|\d{1,2}\s*(?:n|nts?|nights?)\b))/gi;
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
  const star = text.match(/\b([2-5])\s*(?:\*|star|⭐|str)/i);
  if (star) out.hotel_category = `${star[1]} Star`;
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
  else if (/flights?\s*only|only\s*(?:air\s*)?tickets?/i.test(text)) out.package_type = 'flights_only';
  else if (/visa\s*only|only\s*visa/i.test(text)) out.package_type = 'visa_only';
  if (/\b(with|incl\.?|including|\+)\s*(?:air|flights?|airfare|tickets?)|flights?\s*(?:included|needed|required|also)\b/i.test(text)) inc.add('Flights');
  if (out.package_type === 'land_package') { inc.add('Hotel'); inc.add('Airport transfers'); inc.add('Full sightseeing'); }
  if (/\bvisa\b/i.test(text) && out.package_type !== 'visa_only') inc.add('Visa');
  if (/insurance/i.test(text)) inc.add('Travel insurance');
  if (/\bcruise\b/i.test(text)) inc.add('Cruise');
  if (/\b(breakfast|meals?|half board|full board|all inclusive)\b/i.test(text)) inc.add('Meals');
  if (/\btransfers?\b/i.test(text)) inc.add('Airport transfers');
  if (/\bforex\b/i.test(text)) inc.add('Forex');
  if (inc.size) out.inclusions = [...inc];

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
