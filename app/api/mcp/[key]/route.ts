import { NextResponse, type NextRequest } from 'next/server';
import { ensureDb } from '@/lib/db';
import { verifyConnectorKey } from '@/lib/settings';
import { handleRpc } from '@/lib/connector';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Claude connector endpoint (MCP over streamable HTTP, JSON responses).
 * The secret key in the address is the password: create or turn it off in
 * Settings → Claude connector. A wrong key looks exactly like a missing page.
 */
async function guard(key: string) {
  ensureDb();
  return verifyConnectorKey(key);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  if (!(await guard(key))) return new NextResponse('Not found', { status: 404 });
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, { status: 400 }); }
  const batch = Array.isArray(body);
  const msgs = (batch ? body : [body]) as Parameters<typeof handleRpc>[0][];
  const out: object[] = [];
  for (const m of msgs) { const r = await handleRpc(m); if (r) out.push(r); }   // one at a time (see lib/db-core inSeries)
  if (!out.length) return new NextResponse(null, { status: 202 });
  return NextResponse.json(batch ? out : out[0], { headers: { 'Cache-Control': 'no-store' } });
}

export async function GET(_: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  if (!(await guard(key))) return new NextResponse('Not found', { status: 404 });
  return new NextResponse('Skyroad CRM connector is on. Add this address in Claude → Settings → Connectors.', { status: 405, headers: { Allow: 'POST' } });
}

export async function DELETE() { return new NextResponse(null, { status: 405 }); }
