// Shared CRM vocabulary (safe to import from client components).

export const STAGES = [
  'new_query', 'supplier_mailed', 'quote_received', 'quote_shared', 'follow_up',
  'booking_confirmed', 'advance_received', 'final_payment_received', 'travelling', 'completed',
] as const;
export type Stage = (typeof STAGES)[number];
export type Status = Stage | 'lost';
export const ALL_STATUSES: Status[] = [...STAGES, 'lost'];

export const STAGE_LABEL: Record<Status, string> = {
  new_query: 'New query',
  supplier_mailed: 'Supplier mail sent',
  quote_received: 'Quote received',
  quote_shared: 'Quote / itinerary shared',
  follow_up: 'Follow-up',
  booking_confirmed: 'Booking confirmed',
  advance_received: 'Advance received',
  final_payment_received: 'Final payment received',
  travelling: 'Travelling',
  completed: 'Travel completed',
  lost: 'Lost / not converted',
};

export const STAGE_SHORT: Record<Status, string> = {
  new_query: 'New', supplier_mailed: 'Supplier mailed', quote_received: 'Quote in', quote_shared: 'Quote shared',
  follow_up: 'Follow-up', booking_confirmed: 'Confirmed', advance_received: 'Advance', final_payment_received: 'Fully paid',
  travelling: 'Travelling', completed: 'Completed', lost: 'Lost',
};

export const STAGE_HELP: Record<Status, string> = {
  new_query: 'Enquiry received – nothing sent yet.',
  supplier_mailed: 'Rates requested from one or more suppliers.',
  quote_received: 'At least one supplier has quoted.',
  quote_shared: 'Your quote / itinerary has gone to the client.',
  follow_up: 'You are chasing the client for a decision.',
  booking_confirmed: 'Client said yes.',
  advance_received: 'Advance payment received.',
  final_payment_received: 'Fully paid.',
  travelling: 'On the trip now (automatic from travel dates).',
  completed: 'Back home (automatic after the travel end date).',
  lost: 'Did not go ahead.',
};

export const stageRank = (s: Status): number => (s === 'lost' ? 0 : STAGES.indexOf(s) + 1);
export const isStatus = (s: unknown): s is Status => typeof s === 'string' && (ALL_STATUSES as string[]).includes(s);

/** Stages a lead is still being sold in (before confirmation). */
export const OPEN_STAGES: Stage[] = ['new_query', 'supplier_mailed', 'quote_received', 'quote_shared', 'follow_up'];
/** Stages after the client said yes. */
export const WON_STAGES: Stage[] = ['booking_confirmed', 'advance_received', 'final_payment_received', 'travelling', 'completed'];

export const LEAD_SOURCES = ['WhatsApp', 'Instagram', 'Facebook', 'Website', 'Google', 'Referral', 'Repeat client', 'Walk-in', 'Phone call', 'Email', 'Corporate', 'Other'];
export const HOTEL_CATEGORIES = ['3 Star', '4 Star', '5 Star', 'Luxury / boutique', 'Budget', 'Mixed'];
export const PRIORITIES = [{ key: 'hot', label: 'Hot' }, { key: 'normal', label: 'Normal' }, { key: 'cold', label: 'Cold' }] as const;

export const PACKAGE_TYPES = {
  land_package: 'Tour / Land package (hotel + transfers + full sightseeing)',
  hotel_only: 'Hotel only',
  custom: 'Customised package',
  flights_only: 'Flights only',
  visa_only: 'Visa only',
} as const;
export type PackageType = keyof typeof PACKAGE_TYPES;

export const INCLUSIONS = ['Flights', 'Hotel', 'Airport transfers', 'Full sightseeing', 'Meals', 'Visa', 'Travel insurance', 'Forex', 'Cruise', 'Guide', 'Inter-city transport', 'Activities / tickets'];

export const PAYMENT_KINDS = { advance: 'Advance', final: 'Final payment', other: 'Other / part payment' } as const;
export const PAYMENT_MODES = ['UPI', 'Bank transfer', 'Cash', 'Card', 'Cheque', 'Other'];

export const QUOTE_STATUS = { requested: 'Awaiting quote', received: 'Quote received', declined: 'Declined / no reply', selected: 'Selected' } as const;
export type QuoteStatus = keyof typeof QUOTE_STATUS;
export const CHANNELS = { email: 'Email', whatsapp: 'WhatsApp', phone: 'Phone', portal: 'B2B portal' } as const;

export const ACTIVITY_LABEL: Record<string, string> = {
  note: 'Note', call: 'Call', whatsapp: 'WhatsApp', email: 'Email', meeting: 'Meeting', stage: 'Stage',
  supplier: 'Supplier', quote: 'Quote', payment: 'Payment', follow_up: 'Follow-up', system: 'System',
};
/** Interactions you can log by hand from the lead page. */
export const LOGGABLE = ['call', 'whatsapp', 'email', 'meeting', 'note'] as const;
