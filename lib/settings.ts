// App settings stored in the database: the supplier email template and the
// Claude connector key (only its SHA-256 is stored).
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { db, withTx, UserError } from './db-core';
import type { MailTemplate } from './templates';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

async function get(key: string): Promise<string | null> {
  try {
    const [r] = await db()<{ value: string | null }>`select value from crm.app_setting where key = ${key}::text`;
    return r?.value ?? null;
  } catch (e) {
    if ((e as { code?: string }).code === '42P01') return null; // settings table not created yet (migration 005)
    throw e;
  }
}
async function setMany(actor: string, values: Record<string, string | null>) {
  await withTx(actor, async (tx) => {
    for (const [k, v] of Object.entries(values)) {
      await tx`insert into crm.app_setting (key, value, updated_at) values (${k}::text, ${v}::text, now())
               on conflict (key) do update set value = excluded.value, updated_at = now()`;
    }
  });
}

// ── supplier email template ──
export async function getSupplierTemplate(): Promise<MailTemplate | null> {
  const [subject, body] = [await get('supplier_mail_subject'), await get('supplier_mail_body')];
  return body?.trim() ? { subject: subject ?? '', body } : null;
}
export async function saveSupplierTemplate(actor: string, subject: string, body: string) {
  const b = body.replace(/\r/g, '').trim();
  const s = subject.replace(/[\r\n]+/g, ' ').trim();
  if (b.length > 8000 || s.length > 300) throw new UserError('That template is too long.');
  if (b && !b.includes('{{')) throw new UserError('Add at least one {{placeholder}}, e.g. {{destination}} or {{dates}}, so each mail is filled in for the enquiry.');
  await setMany(actor, { supplier_mail_subject: s || null, supplier_mail_body: b || null });
}

// ── Claude connector key ──
export interface ConnectorStatus { enabled: boolean; hint: string | null; createdAt: string | null; lastUsedAt: string | null }

export async function connectorStatus(): Promise<ConnectorStatus> {
  const [hash, hint, created, used] = [await get('connector_key_hash'), await get('connector_key_hint'), await get('connector_created_at'), await get('connector_last_used_at')];
  return { enabled: !!hash, hint, createdAt: created, lastUsedAt: used };
}

/** Creates a new secret key (replacing any old one). Returned once; only its hash is kept. */
export async function createConnectorKey(actor: string): Promise<string> {
  const key = 'skc_' + randomBytes(24).toString('base64url');
  await setMany(actor, { connector_key_hash: sha256(key), connector_key_hint: key.slice(-4), connector_created_at: new Date().toISOString(), connector_last_used_at: null });
  return key;
}
export async function disableConnector(actor: string) {
  await setMany(actor, { connector_key_hash: null, connector_key_hint: null, connector_created_at: null });
}
export async function verifyConnectorKey(key: string | undefined | null): Promise<boolean> {
  if (!key || key.length < 20 || key.length > 100) return false;
  const stored = await get('connector_key_hash');
  if (!stored) return false;
  const a = Buffer.from(sha256(key), 'hex'), b = Buffer.from(stored, 'hex');
  const ok = a.length === b.length && timingSafeEqual(a, b);
  if (ok) {
    // note when it was last used (at most once a minute)
    await db()`insert into crm.app_setting (key, value, updated_at) values ('connector_last_used_at', ${new Date().toISOString()}::text, now())
               on conflict (key) do update set value = excluded.value, updated_at = now()
               where crm.app_setting.updated_at < now() - interval '1 minute'`;
  }
  return ok;
}
