import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/session';
import { exportAll } from '@/lib/crm';
import { todayIST } from '@/lib/dates';

export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const body = await exportAll();
  return new NextResponse(body, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="skyroad-crm-backup-${todayIST()}.json"`,
      'Cache-Control': 'no-store',
    },
  });
}
