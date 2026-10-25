// Enquiries vs bookings per month – server-rendered SVG.
import { fmtMonth } from '@/lib/dates';

export function CountChart({ data }: { data: { month: string; enquiries: number; confirmed: number }[] }) {
  const W = 720, H = 220, padL = 36, padB = 28, padT = 12;
  const max = Math.max(4, ...data.flatMap((d) => [d.enquiries, d.confirmed]));
  const nice = Math.ceil(max / 4) * 4;
  const innerW = W - padL - 8, innerH = H - padT - padB;
  const step = innerW / Math.max(data.length, 1);
  const bw = Math.min(16, step / 3);
  const y = (v: number) => padT + innerH - (v / nice) * innerH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(t * nice));
  const empty = data.every((d) => d.enquiries === 0 && d.confirmed === 0);
  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Enquiries and confirmed bookings per month">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - 8} y1={y(t)} y2={y(t)} className="grid-line" />
            <text x={padL - 6} y={y(t) + 4} textAnchor="end" className="axis">{t}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = padL + i * step + step / 2;
          return (
            <g key={d.month}>
              <rect x={x - bw - 1} y={y(d.enquiries)} width={bw} height={Math.max(0, padT + innerH - y(d.enquiries))} rx="3" className="bar-in"><title>{`${fmtMonth(d.month)}: ${d.enquiries} enquiries`}</title></rect>
              <rect x={x + 1} y={y(d.confirmed)} width={bw} height={Math.max(0, padT + innerH - y(d.confirmed))} rx="3" className="bar-won"><title>{`${fmtMonth(d.month)}: ${d.confirmed} confirmed`}</title></rect>
              <text x={x} y={H - 8} textAnchor="middle" className="axis">{fmtMonth(d.month).slice(0, 3)}</text>
            </g>
          );
        })}
        {empty && <text x={W / 2} y={H / 2} textAnchor="middle" className="axis">No enquiries yet</text>}
      </svg>
      <figcaption className="legend"><span><span className="dot dot-q" />Enquiries</span><span><span className="dot dot-won" />Confirmed</span></figcaption>
    </figure>
  );
}
