import { NextResponse, type NextRequest } from 'next/server';
import { currentUser } from '@/lib/session';
import { runReport, REPORTS, type ReportKey } from '@/lib/reports';
import { reportToCsv } from '@/lib/csv';
import { todayIST, isIsoDate } from '@/lib/dates';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const p = req.nextUrl.searchParams;
  const key = (Object.keys(REPORTS).includes(p.get('r') ?? '') ? p.get('r') : 'register') as ReportKey;
  const today = todayIST();
  const from = isIsoDate(p.get('from')) ? p.get('from')! : today.slice(0, 8) + '01';
  const to = isIsoDate(p.get('to')) ? p.get('to')! : today;
  const report = await runReport(key, from, to, (p.get('label') ?? 'selected period').slice(0, 40));
  return new NextResponse(reportToCsv(report), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="skyroad-crm-${key}-${today}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
