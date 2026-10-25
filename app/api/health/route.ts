import { NextResponse } from 'next/server';
import { ensureDb } from '@/lib/db';
import { db } from '@/lib/db-core';

export const dynamic = 'force-dynamic';

/** Public health check: confirms the app can reach the database. Reveals no data. */
export async function GET() {
  try {
    ensureDb();
    const [r] = await db()<{ schema: boolean }>`
      select exists (select 1 from information_schema.tables where table_schema = 'crm' and table_name = 'lead') as schema`;
    return NextResponse.json({ status: r.schema ? 'ok' : 'database reachable, schema missing – run db/migrations/001_init.sql', database: true });
  } catch {
    return NextResponse.json({ status: 'database unreachable – check DATABASE_URL', database: false }, { status: 503 });
  }
}
