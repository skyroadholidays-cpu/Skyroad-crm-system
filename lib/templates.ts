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
export function supplierRequest(l: LeadForMessage, supplierContact?: string | null) {
  const pkg = l.package_type ? PACKAGE_LABEL[l.package_type] ?? l.package_type : 'Package as per itinerary';
  const lines = [
    `Dear ${supplierContact?.trim() || 'Team'},`,
    '',
    `Greetings from ${BUSINESS.name}!`,
    '',
    'Please share your best rates for the below enquiry:',
    '',
    `Destination: ${l.destination}`,
    `Travel dates: ${datesText(l)}`,
    `Travellers: ${paxText(l)}`,
  ];
  if (l.nights_plan) lines.push(`Itinerary / nights: ${l.nights_plan}`);
  lines.push(`Hotel category: ${l.hotel_category || 'Please suggest 3★ / 4★ / 5★ options'}`);
  lines.push(`Package type: ${pkg}`);
  if (l.inclusions?.length) lines.push(`Inclusions required: ${l.inclusions.join(', ')}`);
  if (l.requirements) lines.push(`Special requests: ${l.requirements}`);
  lines.push(
    '',
    'Kindly include:',
    '• Hotel options with room category and meal plan',
    '• Per-person and total cost, with inclusions & exclusions',
    '• Transfers and sightseeing details (SIC / private)',
    '• Quote validity and cancellation policy',
    '',
    `Our reference: ${l.lead_no}`,
    '',
    'Looking forward to your quick response.',
    '',
    'Warm regards,',
    BUSINESS.signatory,
    BUSINESS.name,
    BUSINESS.email,
  );
  const short = l.travel_start ? `${d(l.travel_start).replace(/ \d{4}$/, '')}${l.travel_end ? `–${d(l.travel_end)}` : ''}` : 'Dates TBC';
  return {
    subject: `Rate request – ${l.destination} | ${short} | ${paxText(l)} | ${l.lead_no}`,
    body: lines.join('\n'),
  };
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
