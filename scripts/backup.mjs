// Saves a full JSON backup of every business table into ./backups/.
// Usage: npm run backup      (same content as Settings → Download full backup)
import { mkdirSync, writeFileSync } from 'node:fs';
import postgres from 'postgres';
import { connectOptions } from './_env.mjs';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Put it in .env.local (see .env.example).');
  process.exit(1);
}
const sql = postgres(process.env.DATABASE_URL, connectOptions());
const TABLES = { lead: 'id', supplier: 'id', supplier_quote: 'id', lead_payment: 'id', activity: 'id', audit_log: 'id' };
try {
  const tables = {};
  for (const [t, order] of Object.entries(TABLES)) {
    // table and column names come from the fixed list above
    const [r] = await sql.unsafe(`select coalesce(json_agg(x order by x.${order}), '[]')::text as d from crm.${t} x`);
    tables[t] = JSON.parse(r.d);
  }
  const now = new Date().toISOString();
  mkdirSync('backups', { recursive: true });
  const file = `backups/skyroad-crm-backup-${now.slice(0, 19).replace(/[:T]/g, '-')}.json`;
  writeFileSync(file, JSON.stringify({ app: 'skyroad-crm', format: 1, exported_at: now, tables }, null, 1));
  console.log(`✓ Saved ${file} (${tables.lead.length} enquiries, ${tables.supplier.length} suppliers)`);
} catch (e) {
  console.error('Backup failed:', e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
