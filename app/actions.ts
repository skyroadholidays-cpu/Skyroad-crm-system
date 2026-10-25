'use server';
// Every change in the CRM goes through these server actions. Each one
// re-checks the session, validates on the server and returns a readable error.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { ensureDb } from '@/lib/db';
import { requireUser, setSessionCookie, clearSessionCookie, readSessionToken, clientInfo } from '@/lib/session';
import { friendlyError, UserError } from '@/lib/db-core';
import * as auth from '@/lib/auth-core';
import * as C from '@/lib/crm';
import * as ST from '@/lib/settings';
import { headers } from 'next/headers';

export type FormState = { error?: string; ok?: string } | undefined;

const refresh = () => revalidatePath('/', 'layout');
const safeNext = (v: FormDataEntryValue | null, fallback: string) => {
  const s = typeof v === 'string' ? v : '';
  return s.startsWith('/') && !s.startsWith('//') ? s : fallback;
};
const getter = (fd: FormData) => (k: string) => {
  const v = fd.get(k);
  return typeof v === 'string' ? v : undefined;
};
const idOf = (fd: FormData, k = 'id') => {
  const n = Number(fd.get(k));
  if (!Number.isInteger(n) || n <= 0) throw new UserError('Missing record id – please reload the page.');
  return n;
};

/** Runs a change; on success either redirects or returns a message. */
async function run(fn: (actor: string) => Promise<string | { redirect: string }>): Promise<FormState> {
  const user = await requireUser();
  let res: string | { redirect: string };
  try {
    res = await fn(user.username);
  } catch (e) {
    return { error: friendlyError(e) };
  }
  refresh();
  if (typeof res === 'object') redirect(res.redirect);
  return { ok: res };
}

// ───────────────────────── auth ─────────────────────────

export async function loginAction(_: FormState, fd: FormData): Promise<FormState> {
  ensureDb();
  const { ip, userAgent } = await clientInfo();
  try {
    const token = await auth.login(String(fd.get('username') ?? '').trim(), String(fd.get('password') ?? ''), ip, userAgent);
    await setSessionCookie(token);
  } catch (e) {
    return { error: friendlyError(e) };
  }
  redirect(safeNext(fd.get('next'), '/'));
}

export async function setupAction(_: FormState, fd: FormData): Promise<FormState> {
  ensureDb();
  const { ip, userAgent } = await clientInfo();
  try {
    const expected = process.env.SETUP_TOKEN;
    if (!expected || expected.length < 12) throw new UserError('Setup is disabled: SETUP_TOKEN is not configured on the server (see README).');
    if (String(fd.get('setup_token') ?? '') !== expected) throw new UserError('The setup code is incorrect.');
    await auth.setInitialPassword(String(fd.get('password') ?? ''), String(fd.get('confirm') ?? ''));
    const token = await auth.login('Skyroadholidays', String(fd.get('password')), ip, userAgent);
    await setSessionCookie(token);
  } catch (e) {
    return { error: friendlyError(e) };
  }
  redirect('/?welcome=1');
}

export async function logoutAction() {
  ensureDb();
  await auth.destroySession(await readSessionToken());
  await clearSessionCookie();
  redirect('/login');
}

export async function changePasswordAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  try {
    await auth.changePassword(user, String(fd.get('current') ?? ''), String(fd.get('password') ?? ''), String(fd.get('confirm') ?? ''));
  } catch (e) {
    return { error: friendlyError(e) };
  }
  return { ok: 'Password changed. All other devices have been signed out.' };
}

export async function signOutOthersAction(_: FormState): Promise<FormState> {
  const user = await requireUser();
  const n = await auth.signOutOtherSessions(user);
  refresh();
  return { ok: n ? `Signed out ${n} other device${n > 1 ? 's' : ''}.` : 'No other devices were signed in.' };
}

// ───────────────────────── enquiries ─────────────────────────

export async function createLeadAction(_: FormState, fd: FormData): Promise<FormState> {
  return run(async (actor) => {
    const input = C.parseLeadInput(getter(fd), (k) => fd.getAll(k).map(String));
    const r = await C.createLead(actor, input, String(fd.get('idem') ?? '') || null);
    if (fd.get('and_new') === '1') return { redirect: `/leads/new?saved=${r.lead_no}` };
    return { redirect: `/leads/${r.id}?saved=1` };
  });
}

export async function updateLeadAction(_: FormState, fd: FormData): Promise<FormState> {
  return run(async (actor) => {
    const id = idOf(fd);
    await C.updateLead(actor, id, C.parseLeadInput(getter(fd), (k) => fd.getAll(k).map(String)));
    return { redirect: `/leads/${id}?saved=1` };
  });
}

export async function deleteLeadAction(_: FormState, fd: FormData): Promise<FormState> {
  return run(async (actor) => {
    await C.softDeleteLead(actor, idOf(fd));
    return { redirect: '/leads?deleted=1' };
  });
}

export async function restoreLeadAction(_: FormState, fd: FormData): Promise<FormState> {
  return run(async (actor) => {
    const id = idOf(fd);
    await C.restoreLead(actor, id);
    return { redirect: `/leads/${id}?restored=1` };
  });
}

export async function setStageAction(_: FormState, fd: FormData): Promise<FormState> {
  return run(async (actor) => {
    const id = idOf(fd);
    await C.setStage(actor, id, String(fd.get('stage') ?? ''), String(fd.get('note') ?? ''), String(fd.get('lost_reason') ?? ''));
    const next = fd.get('next');
    return next ? { redirect: safeNext(next, `/leads/${id}`) } : 'Stage updated.';
  });
}

export async function logInteractionAction(_: FormState, fd: FormData): Promise<FormState> {
  return run(async (actor) => {
    await C.logInteraction(actor, idOf(fd), getter(fd));
    return 'Saved to the timeline.';
  });
}

export async function setFollowUpAction(_: FormState, fd: FormData): Promise<FormState> {
  return run(async (actor) => {
    const date = String(fd.get('next_follow_up') ?? '').trim() || null;
    await C.setFollowUp(actor, idOf(fd), fd.get('clear') === '1' ? null : date, String(fd.get('follow_up_note') ?? '').trim() || null);
    return fd.get('clear') === '1' ? 'Follow-up cleared.' : 'Follow-up saved.';
  });
}

// ───────────────────────── suppliers & quotes ─────────────────────────

export async function requestQuotesAction(_: FormState, fd: FormData): Promise<FormState> {
  return run(async (actor) => {
    const ids = fd.getAll('supplier_id').map(Number);
    const n = await C.requestQuotes(actor, idOf(fd, 'lead_id'), ids, String(fd.get('channel') ?? 'email'));
    return `Recorded ${ids.length} rate request${ids.length === 1 ? '' : 's'}${n < ids.length ? ' (already-listed suppliers were re-sent)' : ''}. Use the Gmail / WhatsApp buttons to send the message.`;
  });
}

export async function updateQuoteAction(_: FormState, fd: FormData): Promise<FormState> {
  return run(async (actor) => {
    await C.updateQuote(actor, idOf(fd), getter(fd));
    return 'Supplier quote saved.';
  });
}

export async function removeQuoteAction(_: FormState, fd: FormData): Promise<FormState> {
  return run(async (actor) => {
    await C.removeQuote(actor, idOf(fd));
    return 'Removed.';
  });
}

export async function saveSupplierAction(_: FormState, fd: FormData): Promise<FormState> {
  return run(async (actor) => {
    const id = await C.saveSupplier(actor, getter(fd));
    const next = fd.get('next');
    if (next) return { redirect: safeNext(next, '/suppliers') };
    return fd.get('id') ? 'Supplier saved.' : { redirect: `/suppliers/${id}?saved=1` };
  });
}

export async function toggleSupplierAction(_: FormState, fd: FormData): Promise<FormState> {
  return run(async (actor) => {
    await C.setSupplierActive(actor, idOf(fd), fd.get('active') === 'true');
    return fd.get('active') === 'true' ? 'Supplier re-activated.' : 'Supplier hidden from new requests.';
  });
}

// ───────────────────────── selling ─────────────────────────

export async function shareQuoteAction(_: FormState, fd: FormData): Promise<FormState> {
  return run(async (actor) => {
    const id = idOf(fd);
    await C.shareQuote(actor, id, getter(fd));
    return { redirect: `/leads/${id}?shared=1` };
  });
}

export async function confirmBookingAction(_: FormState, fd: FormData): Promise<FormState> {
  return run(async (actor) => {
    const id = idOf(fd);
    await C.confirmBooking(actor, id, getter(fd));
    return { redirect: `/leads/${id}?confirmed=1` };
  });
}

export async function addPaymentAction(_: FormState, fd: FormData): Promise<FormState> {
  return run(async (actor) => {
    await C.addPayment(actor, idOf(fd, 'lead_id'), getter(fd), String(fd.get('idem') ?? '') || null);
    return 'Payment recorded.';
  });
}

export async function deletePaymentAction(_: FormState, fd: FormData): Promise<FormState> {
  return run(async (actor) => {
    await C.deletePayment(actor, idOf(fd));
    return 'Payment deleted.';
  });
}

// ───────────────────────── Claude connector & templates ─────────────────────────

export async function createConnectorAction(_: FormState): Promise<FormState> {
  return run(async (actor) => {
    const key = await ST.createConnectorKey(actor);
    const h = await headers();
    const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'crm.skyroadholidays.com';
    const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
    return `Your connector address (shown only once – copy it now): ${proto}://${host}/api/mcp/${key}`;
  });
}

export async function disableConnectorAction(_: FormState): Promise<FormState> {
  return run(async (actor) => {
    await ST.disableConnector(actor);
    return 'Connector turned off. Claude can no longer reach the CRM until you create a new address.';
  });
}

export async function saveTemplateAction(_: FormState, fd: FormData): Promise<FormState> {
  return run(async (actor) => {
    await ST.saveSupplierTemplate(actor, String(fd.get('subject') ?? ''), String(fd.get('body') ?? ''));
    return String(fd.get('body') ?? '').trim() ? 'Template saved. Every supplier mail now uses it.' : 'Template cleared – the built-in standard mail is used again.';
  });
}
