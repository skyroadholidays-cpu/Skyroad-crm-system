import { NextResponse, type NextRequest } from 'next/server';
import { ensureDb } from '@/lib/db';
import { db } from '@/lib/db-core';
import * as C from '@/lib/crm';
import { isPasswordSet } from '@/lib/auth-core';

export const dynamic = 'force-dynamic';

/** Runs one step with a time limit and reports how long it took (or why it failed). Reveals no business data. */
async function step(name: string, fn: () => Promise<unknown>, limitMs = 10000) {
  const t0 = Date.now();
  try {
    await Promise.race([fn(), new Promise((_, rej) => setTimeout(() => rej(new Error(`no answer after ${limitMs / 1000}s`)), limitMs))]);
    return { step: name, ok: true, ms: Date.now() - t0 };
  } catch (e) {
    const err = e as { message?: string; code?: string };
    return { step: name, ok: false, ms: Date.now() - t0, error: `${err.code ? err.code + ': ' : ''}${String(err.message ?? e).slice(0, 300)}` };
  }
}

/**
 * Public health check: confirms the app can reach the database.
 * /api/health?deep=1 also times each step the dashboard needs (for troubleshooting).
 */
export async function GET(req: NextRequest) {
  try {
    ensureDb();
    if (req.nextUrl.searchParams.get('deep')) {
      const steps = [];
      steps.push(await step('connect', () => db()`select 1`));
      steps.push(await step('schema', async () => {
        const [r] = await db()<{ ok: boolean }>`select exists (select 1 from information_schema.tables where table_schema = 'crm' and table_name = 'lead') as ok`;
        if (!r.ok) throw new Error('crm schema missing – run db/migrations/001_init.sql');
      }));
      steps.push(await step('password set', () => isPasswordSet()));
      steps.push(await step('sessions table', () => db()`select count(*)::int from crm.session`));
      steps.push(await step('enquiry list', () => C.listLeads({}, 5)));
      steps.push(await step('dashboard', () => C.getDashboard(), 20000));
      steps.push(await step('recent activity', () => C.recentActivity(5)));
      return NextResponse.json({
        status: steps.every((s) => s.ok) ? 'ok' : 'problem',
        region: process.env.VERCEL_REGION ?? 'local',
        steps,
      }, { headers: { 'Cache-Control': 'no-store' } });
    }
    const [r] = await db()<{ schema: boolean }>`
      select exists (select 1 from information_schema.tables where table_schema = 'crm' and table_name = 'lead') as schema`;
    return NextResponse.json({ status: r.schema ? 'ok' : 'database reachable, schema missing – run db/migrations/001_init.sql', database: true });
  } catch (e) {
    return NextResponse.json({ status: 'database unreachable – check DATABASE_URL', database: false, error: String((e as Error)?.message ?? e).slice(0, 200) }, { status: 503 });
  }
}
