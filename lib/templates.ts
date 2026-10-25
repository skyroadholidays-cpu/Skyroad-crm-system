// Standard messages, filled from the enquiry. Pure functions: used on pages
// (to build Gmail / WhatsApp links) and later by automations.
import { durationLabel } from './quick-parse';
import { PACKAGE_LABEL } from './constants';

export interface LeadForMessage {
  lead_no: string;
  client_name: string;
  destination: string;
  travel_start: string | null;
  travel_end: string | null;
  flexible_dates?: boolean | null;
  adults: number;
  children: number;
  child_ages: string | null;
  infants: number;
  nights_plan: string | null;
  hotel_category: string | null;
  package_type: string | null;
  inclusions: string[] | null;
  requirements: string | null;
  rooms?: number | null;
  meal_plan?: string | null;
  quote_amount?: string | null;
  itinerary_url?: string | null;
  balance_due?: string | null;
  booking_ref?: string | null;
}

export const BUSINESS = {
  name: 'Skyroad Holidays',
  signatory: 'Nambi Somaiya',
  email: 'sales@skyroadholidays.com',
  website: 'www.skyroadholidays.com',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function d(iso: string | null | undefined) {
  if (!iso) return '';
  const [y, m, day] = iso.slice(0, 10).split('-');
  return `${Number(day)} ${MONTHS[Number(m) - 1]} ${y}`;
}
export function datesText(l: Pick<LeadForMessage, 'travel_start' | 'travel_end' | 'flexible_dates'>) {
  if (!l.travel_start) return 'Dates to be confirmed';
  const range = l.travel_end ? `${d(l.travel_start)} – ${d(l.travel_end)} (${durationLabel(l.travel_start, l.travel_end)})` : `From ${d(l.travel_start)}`;
  return l.flexible_dates ? `${range} – dates flexible` : range;
}
export function paxText(l: Pick<LeadForMessage, 'adults' | 'children' | 'child_ages' | 'infants'>) {
  const parts = [`${l.adults} Adult${l.adults === 1 ? '' : 's'}`];
  if (l.children) parts.push(`${l.children} Child${l.children === 1 ? '' : 'ren'}${l.child_ages ? ` (age ${l.child_ages})` : ''}`);
  if (l.infants) parts.push(`${l.infants} Infant${l.infants === 1 ? '' : 's'}`);
  return parts.join(', ');
}
function rupees(v: string | null | undefined) {
  if (!v) return '';
  const [i, f] = Number(v).toFixed(2).split('.');
  const last3 = i.slice(-3), rest = i.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `₹${rest ? rest + ',' : ''}${last3}${f === '00' ? '' : '.' + f}`;
}
const firstName = (n: string) => n.trim().split(/\s+/)[0];

/** The standard rate request you send to a supplier / DMC. */
/** Your own standard supplier mail, saved once in Settings. {{placeholders}} are filled per enquiry. */
export interface MailTemplate { subject: string; body: string }

/** Starting point shown in Settings – the same mail the app sends without a saved template. */
export const DEFAULT_SUPPLIER_TEMPLATE: MailTemplate = {
  subject: '{{destination}} Package - {{days}} Days - {{client_name}}',
  body: [
    'Hi {{supplier_contact}},', '', 'Greetings from Skyroad Holidays. Kindly give us the quote for the below query.', '',
    'Travel dates: {{start_date}} to {{end_date}}', 'No of Pax: {{pax_short}}', 'No of Rooms: {{rooms}}',
    'Meal Plan: {{meal_plan}}', 'Hotel Category: {{hotel_category}}', 'Destination: {{route}}',
    '{{requirements}}', '', 'Kindly give us your best rates.', '', 'Regards,', '{{signatory}}', '{{business}}', '{{email}}',
  ].join('\n'),
};

export const TEMPLATE_VARS: { key: string; help: string }[] = [
  { key: 'supplier_contact', help: 'Contact person (or "Team")' },
  { key: 'supplier_name', help: 'Supplier company' },
  { key: 'ref', help: 'Enquiry no. e.g. SRQ-00004 (always keep it in the subject)' },
  { key: 'destination', help: 'Destination' },
  { key: 'dates', help: '1 Dec 2026 – 6 Dec 2026 (5N / 6D)' },
  { key: 'start_date', help: 'Travel start' },
  { key: 'end_date', help: 'Travel end' },
  { key: 'duration', help: '5N / 6D' },
  { key: 'pax', help: '2 Adults, 1 Child (age 6)' },
  { key: 'nights_plan', help: '2N Krabi, 3N Phuket' },
  { key: 'hotel_category', help: '4 Star' },
  { key: 'package', help: 'Customised package / Hotel only …' },
  { key: 'inclusions', help: 'Hotel, Airport transfers, …' },
  { key: 'requirements', help: 'Special requests' },
  { key: 'client_city', help: "Client's city" },
  { key: 'client_name', help: 'Client name (e.g. for "Mr Sourabh")' },
  { key: 'days', help: '07 (days, two digits)' },
  { key: 'nights', help: '06 (nights, two digits)' },
  { key: 'pax_short', help: '04 Adults + 02 kids (3,7 yrs)' },
  { key: 'rooms', help: 'Number of rooms, e.g. 02' },
  { key: 'meal_plan', help: 'MAP / CP / AP / EP' },
  { key: 'route', help: 'Nights plan, or the destination if none' },
  { key: 'signatory', help: BUSINESS.signatory },
  { key: 'business', help: BUSINESS.name },
  { key: 'email', help: BUSINESS.email },
];

export function templateValues(l: LeadForMessage & { city?: string | null }, supplier?: { contact_person?: string | null; name?: string | null }): Record<string, string> {
  return {
    supplier_contact: supplier?.contact_person?.trim() || 'Team',
    supplier_name: supplier?.name ?? '',
    ref: l.lead_no,
    destination: l.destination,
    dates: datesText(l),
    start_date: d(l.travel_start),
    end_date: d(l.travel_end),
    duration: durationLabel(l.travel_start, l.travel_end),
    pax: paxText(l),
    nights_plan: l.nights_plan ?? '',
    hotel_category: l.hotel_category ?? '',
    package: l.package_type ? PACKAGE_LABEL[l.package_type] ?? l.package_type : '',
    inclusions: (l.inclusions ?? []).join(', '),
    // special requests only: drop lines that repeat a field already in the mail, and "Notes:" labels
    requirements: (l.requirements ?? '').split(/\r?\n/).map((x) => x.trim())
      .filter((x) => x && !/^(hotel(\s*category)?|category|rooms?|no\.? of rooms|meal\s*plan|budget|lead\s*source|source)\s*[:\-–]/i.test(x))
      .map((x) => x.replace(/^(notes?|remarks?|special\s*requests?)\s*[:\-–]\s*/i, '')).join('\n'),
    client_city: l.city ?? '',
    client_name: l.client_name,
    days: nightsOf(l) === null ? '' : two(nightsOf(l)! + 1),
    nights: nightsOf(l) === null ? '' : two(nightsOf(l)!),
    pax_short: paxShort(l),
    rooms: l.rooms ? two(l.rooms) : '',
    meal_plan: l.meal_plan ?? '',
    // "2N Krabi, 3N Phuket" as is; a bare "5N" gets the destination in front ("Bali - 5N")
    route: l.nights_plan ? (/[A-Za-z]{3,}/.test(l.nights_plan.replace(/\b\d+\s*N\b/gi, '')) ? l.nights_plan : `${l.destination} - ${l.nights_plan}`) : l.destination,
    signatory: BUSINESS.signatory,
    business: BUSINESS.name,
    email: BUSINESS.email,
  };
}

const two = (n: number) => String(n).padStart(2, '0');
function nightsOf(l: Pick<LeadForMessage, 'travel_start' | 'travel_end'>): number | null {
  if (!l.travel_start || !l.travel_end) return null;
  return Math.round((Date.parse(`${l.travel_end}T00:00:00Z`) - Date.parse(`${l.travel_start}T00:00:00Z`)) / 86400000);
}
/** "04 Adults + 02 kids (3,7 yrs) + 01 infant" */
export function paxShort(l: Pick<LeadForMessage, 'adults' | 'children' | 'child_ages' | 'infants'>): string {
  const parts = [`${two(l.adults)} Adult${l.adults === 1 ? '' : 's'}`];
  if (l.children) parts.push(`${two(l.children)} kid${l.children === 1 ? '' : 's'}${l.child_ages ? ` (${l.child_ages.replace(/\s*(yrs?|years?)\s*$/i, '')} yrs)` : ''}`);
  if (l.infants) parts.push(`${two(l.infants)} infant${l.infants === 1 ? '' : 's'}`);
  return parts.join(' + ');
}

/** Fills {{name}} placeholders; lines whose only placeholder came out empty are dropped. */
export function renderTemplate(tpl: string, vals: Record<string, string>): string {
  const lines = tpl.replace(/\r/g, '').split('\n').flatMap((line) => {
    const keys = [...line.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)].map((m) => m[1]);
    const out = line.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (m, k) => (k in vals ? vals[k] : m));
    const allEmpty = keys.length > 0 && keys.every((k) => k in vals && !vals[k]);
    // drop "Label: {{x}}" or a bare "{{x}}" line when x is empty
    return allEmpty && (out.trim() === '' || /:\s*$/.test(out.trim())) ? [] : [out];
  });
  // no more than one blank line in a row
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function supplierRequest(l: LeadForMessage & { city?: string | null }, supplierContact?: string | null, custom?: MailTemplate | null, supplierName?: string | null) {
  const t = custom?.body?.trim() ? custom : DEFAULT_SUPPLIER_TEMPLATE;
  const vals = templateValues(l, { contact_person: supplierContact, name: supplierName });
  let subject = renderTemplate(t.subject?.trim() || DEFAULT_SUPPLIER_TEMPLATE.subject, vals).replace(/\s+-\s+(?=-|$)/g, ' ').trim();
  if (!subject.includes(l.lead_no)) subject += ` | ${l.lead_no}`; // keeps supplier replies traceable
  return { subject, body: renderTemplate(t.body, vals) };
}

/** WhatsApp to the client when you share the quote / itinerary. */
export function clientQuote(l: LeadForMessage) {
  const lines = [
    `Hi ${firstName(l.client_name)} 👋`,
    '',
    `Thank you for choosing ${BUSINESS.name}! Here is your ${l.destination} holiday plan:`,
    '',
    `📅 ${datesText(l)}`,
    `👨‍👩‍👧 ${paxText(l)}`,
  ];
  if (l.nights_plan) lines.push(`🏨 ${l.nights_plan}${l.hotel_category ? ` · ${l.hotel_category}` : ''}`);
  if (l.quote_amount) lines.push(`💰 Package cost: ${rupees(l.quote_amount)}`);
  if (l.itinerary_url) lines.push('', `Detailed itinerary: ${l.itinerary_url}`);
  lines.push('', 'Happy to customise anything – hotels, sightseeing or dates. Shall I go ahead and block this for you?', '', `– ${BUSINESS.signatory}, ${BUSINESS.name}`);
  return lines.join('\n');
}

export function clientFollowUp(l: LeadForMessage) {
  return [
    `Hi ${firstName(l.client_name)}, hope you're doing well!`,
    '',
    `Just checking in on your ${l.destination} trip${l.travel_start ? ` (${d(l.travel_start)})` : ''}. Did you get a chance to go through the itinerary?`,
    'Hotel rates and availability change quickly for these dates, so I would love to lock in the best price for you. Any changes you would like?',
    '',
    `– ${BUSINESS.signatory}, ${BUSINESS.name}`,
  ].join('\n');
}

export function paymentReminder(l: LeadForMessage) {
  return [
    `Hi ${firstName(l.client_name)},`,
    '',
    `A gentle reminder for your ${l.destination} trip${l.booking_ref ? ` (Ref ${l.booking_ref})` : ''}${l.travel_start ? ` starting ${d(l.travel_start)}` : ''}.`,
    l.balance_due ? `The balance amount is ${rupees(l.balance_due)}.` : 'The balance payment is now due.',
    'Please let me know once done so I can send your final vouchers.',
    '',
    `– ${BUSINESS.signatory}, ${BUSINESS.name}`,
  ].join('\n');
}

export function bookingConfirmation(l: LeadForMessage) {
  return [
    `Hi ${firstName(l.client_name)} 🎉`,
    '',
    `Your ${l.destination} holiday is confirmed${l.booking_ref ? ` – booking ref ${l.booking_ref}` : ''}!`,
    `📅 ${datesText(l)}`,
    `👨‍👩‍👧 ${paxText(l)}`,
    '',
    'I will share vouchers and the final itinerary before you travel. Thank you for trusting Skyroad Holidays!',
    '',
    `– ${BUSINESS.signatory}`,
  ].join('\n');
}

// ── link builders ──
export function digitsForWhatsApp(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let p = phone.replace(/\D/g, '');
  if (p.length === 10) p = '91' + p;           // Indian mobile without country code
  if (p.length === 11 && p.startsWith('0')) p = '91' + p.slice(1);
  return p.length >= 11 && p.length <= 15 ? p : null;
}
export function whatsappLink(phone: string | null | undefined, text: string) {
  const p = digitsForWhatsApp(phone);
  return `https://wa.me/${p ?? ''}?text=${encodeURIComponent(text)}`;
}
export function gmailLink(to: string | null | undefined, subject: string, body: string) {
  return `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to ?? '')}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
export function mailtoLink(to: string | null | undefined, subject: string, body: string) {
  return `mailto:${encodeURIComponent(to ?? '')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
