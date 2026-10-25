import Link from 'next/link';
import { requireUser } from '@/lib/session';
import { runReport, REPORTS, type ReportKey } from '@/lib/reports';
import { resolvePeriod, todayIST, fmtDate, fmtMonth, fmtDateTime } from '@/lib/dates';
import { sumColumn, sumInt } from '@/lib/csv';
import { Card, Empty, Money } from '@/components/ui';
import { PrintButton } from '@/components/client';

export const metadata = { title: 'Reports' };

const PERIOD_OPTS = [
  { key: 'month', label: 'This month' }, { key: 'week', label: 'This week' }, { key: 'fy', label: 'This FY' },
  { key: 'all', label: 'All time' }, { key: 'custom', label: 'Custom' },
];

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const key = (Object.keys(REPORTS).includes(sp.r ?? '') ? sp.r : 'funnel') as ReportKey;
  const period = resolvePeriod(sp, todayIST(), key === 'monthly' ? 'fy' : 'month');
  const to = period.key === 'all' ? todayIST() : period.to;
  const report = await runReport(key, period.from, to, period.label.toLowerCase().startsWith('fy') ? period.label : period.label.toLowerCase());
  const params = new URLSearchParams({ r: key, from: period.from, to, label: period.label });
  const showTotals = report.columns.some((c) => c.total) && report.rows.length > 0;
  const num = (k?: string) => k === 'money' || k === 'int' || k === 'pct';

  return (
    <div className="stack">
      <div className="print-only print-head">
        <div><strong style={{ fontSize: '14pt' }}>Skyroad Holidays</strong><br />{report.title}</div>
        <div style={{ textAlign: 'right' }}>{report.subtitle}<br /><span className="muted">Printed {fmtDateTime(new Date().toISOString())} by {user.username}</span></div>
      </div>
      <div className="page-head">
        <div><h1>Reports</h1><p className="muted">Calculated live from your enquiries.</p></div>
        <div className="page-actions">
          <a href={`/api/export?${params}`} className="btn btn-ghost">Export Excel / CSV</a>
          <PrintButton />
        </div>
      </div>
      <div className="chips no-print">
        {(Object.keys(REPORTS) as ReportKey[]).map((k) => (
          <Link key={k} href={`/reports?r=${k}&period=${period.key}${period.key === 'custom' ? `&from=${period.from}&to=${period.to}` : ''}`} className={`chip${k === key ? ' chip-on' : ''}`}>{REPORTS[k]}</Link>
        ))}
      </div>
      <Card>
        {key !== 'payments' && (
          <form className="filters no-print" method="get">
            <input type="hidden" name="r" value={key} />
            <label className="field"><span className="field-label">Period</span>
              <select name="period" defaultValue={period.key}>{PERIOD_OPTS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</select></label>
            <label className="field"><span className="field-label">From (custom)</span><input type="date" name="from" defaultValue={period.from} /></label>
            <label className="field"><span className="field-label">To (custom)</span><input type="date" name="to" defaultValue={to} /></label>
            <button type="submit" className="btn btn-primary">Run report</button>
          </form>
        )}
        <div className="card-head" style={{ marginTop: 6 }}>
          <div><h2>{report.title}</h2><p className="muted small" style={{ margin: 0 }}>{report.subtitle} · {report.rows.length} row{report.rows.length === 1 ? '' : 's'}</p></div>
        </div>
        {report.rows.length === 0 ? <Empty title="Nothing to show for this period" /> : (
          <div className="table-wrap">
            <table>
              <thead><tr>{report.columns.map((c) => <th key={c.key} className={num(c.kind) ? 'num' : ''}>{c.label}</th>)}</tr></thead>
              <tbody>
                {report.rows.map((row, i) => (
                  <tr key={i}>
                    {report.columns.map((c) => {
                      const v = row[c.key];
                      let content: React.ReactNode = v ?? '—';
                      if (c.kind === 'money') content = v === null || v === undefined ? '' : <Money value={v} />;
                      else if (c.kind === 'date') content = fmtDate(v);
                      else if (c.kind === 'pct') content = v === '' || v === null ? '' : `${v}%`;
                      else if (c.key === 'month') content = fmtMonth(v);
                      return <td key={c.key} className={num(c.kind) ? 'num' : ''}>{content}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
              {showTotals && (
                <tfoot><tr>
                  {report.columns.map((c, i) => (
                    <td key={c.key} className={num(c.kind) ? 'num' : ''}>
                      {i === 0 ? 'Total' : !c.total ? '' : c.kind === 'int' ? sumInt(report.rows, c.key) : <Money value={sumColumn(report.rows, c.key)} />}
                    </td>
                  ))}
                </tr></tfoot>
              )}
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
