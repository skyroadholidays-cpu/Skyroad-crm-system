import type { Sql, DbError } from './sql-types';

let current: Sql | null = null;

export function setSql(sql: Sql) {
  current = sql;
}

export function db(): Sql {
  if (!current) throw new Error('Database client not initialised – ensureDb() in server code.');
  return current;
}

/** Runs fn in a database transaction, tagging every audit-log row with the actor. */
export async function withTx<T>(actor: string, fn: (tx: Sql) => Promise<T>): Promise<T> {
  return db().begin(async (tx) => {
    await tx`select set_config('crm.actor', ${actor}::text, true)`;
    return fn(tx);
  });
}

/**
 * Runs database steps one after another. Supabase's connection pooler can
 * stall when one request sends many queries at the same moment, so pages
 * never fire them in parallel.
 */
export async function inSeries<T extends (() => Promise<unknown>)[]>(...steps: T): Promise<{ [K in keyof T]: Awaited<ReturnType<T[K]>> }> {
  const out: unknown[] = [];
  for (const step of steps) out.push(await step());
  return out as { [K in keyof T]: Awaited<ReturnType<T[K]>> };
}

/** A user-facing error: its message is safe to show on screen. */
export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserError';
  }
}

const CONSTRAINT_MESSAGES: Record<string, string> = {
  lead_dates: 'Travel end date cannot be before the start date.',
  lead_pax: 'Add at least one traveller.',
  lead_client_name_check: 'Client name is required (up to 120 characters).',
  lead_destination_check: 'Destination is required (up to 120 characters).',
  lead_booking_ref_uq: 'That booking reference is already used on another enquiry.',
  lead_quote_amount_check: 'Quote amount must be greater than zero.',
  lead_budget_check: 'Budget must be zero or more.',
  supplier_name_uq: 'A supplier with that name already exists.',
  supplier_name_check: 'Supplier name is required (up to 120 characters).',
  supplier_email_check: 'That supplier email address does not look right.',
  supplier_quote_uq: 'This supplier is already on this enquiry – update their row instead.',
  supplier_quote_one_selected: 'Another supplier is already selected for this enquiry.',
  supplier_quote_received: 'Enter the quoted amount.',
  supplier_quote_amount_check: 'Quote amount must be greater than zero.',
  lead_payment_amount_check: 'Amount must be greater than zero.',
  lead_package_type_check: 'This package type is not enabled in the database yet – run db/migrations/002_package_transfers.sql in the Supabase SQL Editor.',
  lead_lead_no_key: 'That enquiry number is already taken – run db/migrations/003_srq_numbers.sql in the Supabase SQL Editor, then save again.',
};

/** Converts database errors into messages that make sense to the user. */
export function friendlyError(e: unknown): string {
  if (e instanceof UserError) return e.message;
  const err = e as DbError;
  if (err?.code === 'P0001' || err?.code === 'P0002') return formatAmountsInMessage(err.message);
  if (err?.constraint_name && CONSTRAINT_MESSAGES[err.constraint_name]) return CONSTRAINT_MESSAGES[err.constraint_name];
  if (err?.code === '23503') return 'This record is linked to other entries and cannot be changed that way.';
  if (err?.code === '23505') return 'That record already exists.';
  if (err?.code === '22003') return 'That amount is too large.';
  console.error(e);
  return 'Something went wrong while saving. Nothing was changed – please try again.';
}

// "only 59999.50 is outstanding" -> "only ₹59,999.50 is outstanding"
function formatAmountsInMessage(msg: string): string {
  return msg.replace(/(?<![\w-])(\d+\.\d{2})(?!\d)/g, (m) => {
    const [i, f] = m.split('.');
    return '₹' + groupIndian(i) + '.' + f;
  });
}

function groupIndian(int: string): string {
  if (int.length <= 3) return int;
  const last3 = int.slice(-3);
  const rest = int.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return rest + ',' + last3;
}
