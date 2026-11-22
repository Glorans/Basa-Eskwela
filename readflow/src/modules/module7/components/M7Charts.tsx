// Presentation-only SVG charts for the M7 redesign. They plot values exactly as the existing APIs return them:
// a missing value is drawn as "No data" (never as zero), nothing is interpolated, and every chart carries a
// screen-reader table with the exact values. No animation, no chart library.
import { useId, type ReactNode } from 'react';

export const M7_COLORS = { forest: '#17483C', green: '#79BD62', yellow: '#FFCA59', coral: '#F46F62', muted: '#54736A', soft: '#B9D8AE', blue: '#356A91' };
export type ChartUnit = '%' | 'WPM' | 'count';
const fmt = (value: number, unit: ChartUnit) => unit === '%' ? `${Number(value.toFixed(2))}%` : unit === 'WPM' ? `${Math.round(value)} WPM` : String(value);
/** A readable upper bound: 100 for percentages, otherwise the data maximum rounded up to a tidy step. */
export function chartMax(values: number[], unit: ChartUnit): number {
  if (unit === '%') return 100;
  const top = Math.max(1, ...values);
  const step = top <= 5 ? 1 : top <= 10 ? 2 : top <= 50 ? 10 : top <= 200 ? 25 : 100;
  return Math.ceil(top / step) * step;
}
/** Up to two lines of about `width` characters; longer labels end with an ellipsis (the full label is in the table). */
export function wrapLabel(label: string, width: number): string[] {
  const lines: string[] = [''];
  for (const word of label.split(/\s+/)) {
    const current = lines[lines.length - 1];
    if (!current || (current + ' ' + word).length <= width) lines[lines.length - 1] = current ? `${current} ${word}` : word;
    else lines.push(word);
  }
  if (lines.length <= 2) return lines.map(line => line.length > width ? `${line.slice(0, width - 1)}…` : line);
  const second = lines.slice(1).join(' ');
  return [lines[0].length > width ? `${lines[0].slice(0, width - 1)}…` : lines[0], `${second.slice(0, width - 1).trimEnd()}…`];
}
const valid = (value: number | null | undefined): value is number => typeof value === 'number' && Number.isFinite(value);

function Frame({ id, title, note, legend, children, table }: { id: string; title: string; note?: string; legend?: ReactNode; children: ReactNode; table: ReactNode }) {
  return <figure className="m7r-chart" aria-labelledby={`${id}-title`}>
    <figcaption id={`${id}-title`}><strong>{title}</strong>{note && <span>{note}</span>}</figcaption>
    {legend}
    {children}
    {table}
  </figure>;
}

export interface BarSeries { label: string; color: string; values: (number | null)[] }
/** Grouped bars: one group per category, one bar per series. The axis always starts at zero. */
export function BarChart({ title, note, unit, categories, series, emptyText = 'No recorded values for this chart.' }: {
  title: string; note?: string; unit: ChartUnit; categories: string[]; series: BarSeries[]; emptyText?: string;
}) {
  const id = useId();
  const values = series.flatMap(s => s.values.filter(valid));
  const max = chartMax(values, unit);
  const W = 640, H = 280, left = 56, right = 16, top = 24, base = 220;
  const groupWidth = (W - left - right) / Math.max(1, categories.length);
  const barWidth = Math.min(48, (groupWidth - 16) / Math.max(1, series.length));
  const y = (value: number) => base - value / max * (base - top);
  const legend = series.length > 1 ? <div className="m7r-legend">{series.map(s => <span key={s.label}><i style={{ background: s.color }} />{s.label}</span>)}</div> : undefined;
  const table = <table className="m7r-sr-only"><caption>{title}</caption><thead><tr><th>Category</th>{series.map(s => <th key={s.label}>{s.label}</th>)}</tr></thead>
    <tbody>{categories.map((c, i) => <tr key={c}><th>{c}</th>{series.map(s => <td key={s.label}>{valid(s.values[i]) ? fmt(s.values[i]!, unit) : 'No data'}</td>)}</tr>)}</tbody></table>;
  return <Frame id={id} title={title} note={note} legend={legend} table={table}>
    {!values.length ? <p className="m7r-empty">{emptyText}</p> : <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}. Exact values are listed in the table that follows.`}>
      {[0, 0.25, 0.5, 0.75, 1].map(r => <g key={r}><line x1={left} x2={W - right} y1={y(r * max)} y2={y(r * max)} stroke="#dbe7e1" />
        <text x={left - 8} y={y(r * max) + 4} textAnchor="end" className="m7r-axis">{unit === '%' ? `${r * max}%` : Number((r * max).toFixed(1))}</text></g>)}
      {categories.map((category, ci) => {
        const start = left + ci * groupWidth + (groupWidth - barWidth * series.length) / 2;
        return <g key={category}>
          {series.map((s, si) => {
            const value = s.values[ci], x = start + si * barWidth;
            return valid(value)
              ? <g key={s.label}><rect x={x + 2} y={y(value)} width={barWidth - 4} height={Math.max(0, base - y(value))} rx="4" fill={s.color}><title>{`${category} · ${s.label}: ${fmt(value, unit)}`}</title></rect>
                <text x={x + barWidth / 2} y={y(value) - 6} textAnchor="middle" className="m7r-value">{fmt(value, unit)}</text></g>
              : <text key={s.label} x={x + barWidth / 2} y={base - 6} textAnchor="middle" className="m7r-nodata">No data</text>;
          })}
          <text x={left + ci * groupWidth + groupWidth / 2} y={base + 20} textAnchor="middle" className="m7r-axis">{wrapLabel(category, Math.max(8, Math.floor(groupWidth / 8))).map((line, li) => <tspan key={li} x={left + ci * groupWidth + groupWidth / 2} dy={li ? 16 : 0}>{line}</tspan>)}<title>{category}</title></text>
        </g>;
      })}
      <line x1={left} x2={W - right} y1={base} y2={base} stroke="#54736A" />
    </svg>}
  </Frame>;
}

export interface DonutSegment { label: string; value: number; color: string }
/** Parts of one whole. Every segment is listed with its exact count and share in the legend. */
export function DonutChart({ title, note, segments, totalLabel }: { title: string; note?: string; segments: DonutSegment[]; totalLabel: string }) {
  const id = useId();
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  const share = (value: number) => total ? `${Math.round(value / total * 1000) / 10}%` : '0%';
  let angle = -Math.PI / 2;
  const arcs = segments.filter(s => s.value > 0).map(s => {
    const sweep = s.value / total * Math.PI * 2, start = angle; angle += sweep;
    const big = sweep > Math.PI ? 1 : 0, r = 80, cx = 100, cy = 100;
    const p = (a: number) => `${cx + r * Math.cos(a)} ${cy + r * Math.sin(a)}`;
    const d = sweep >= Math.PI * 2 - 1e-6 ? `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.01} ${cy - r}` : `M ${p(start)} A ${r} ${r} 0 ${big} 1 ${p(angle)}`;
    return { ...s, d };
  });
  const table = <table className="m7r-sr-only"><caption>{title}</caption><tbody>{segments.map(s => <tr key={s.label}><th>{s.label}</th><td>{s.value}</td><td>{share(s.value)}</td></tr>)}</tbody></table>;
  return <Frame id={id} title={title} note={note} table={table}>
    {!total ? <p className="m7r-empty">No accounts yet.</p> : <div className="m7r-donut">
      <svg viewBox="0 0 200 200" role="img" aria-label={`${title}. Exact counts are listed in the legend.`}>
        {arcs.map(a => <path key={a.label} d={a.d} fill="none" stroke={a.color} strokeWidth="34"><title>{`${a.label}: ${a.value} (${share(a.value)})`}</title></path>)}
        <text x="100" y="98" textAnchor="middle" className="m7r-donut-total">{total}</text>
        <text x="100" y="118" textAnchor="middle" className="m7r-axis">{totalLabel}</text>
      </svg>
      <ul className="m7r-donut-legend" aria-hidden="true">{segments.map(s => <li key={s.label}><i style={{ background: s.color }} /><span>{s.label}</span><strong>{s.value}</strong><small>{share(s.value)}</small></li>)}</ul>
    </div>}
  </Frame>;
}

export interface LinePoint { key: string; time: number; label: string; value: number | null }
/** One point per saved attempt in time order. A missing value breaks the line; nothing is filled in. */
export function LineChart({ title, note, unit, points, color = M7_COLORS.forest, emptyText = 'No recorded values yet.' }: {
  title: string; note?: string; unit: ChartUnit; points: LinePoint[]; color?: string; emptyText?: string;
}) {
  const id = useId();
  const sorted = [...points].sort((a, b) => a.time - b.time);
  const present = sorted.filter(p => valid(p.value));
  const max = chartMax(present.map(p => p.value!), unit);
  const W = 640, H = 260, left = 56, right = 20, top = 20, base = 210;
  const x = (i: number) => sorted.length === 1 ? (left + W - right) / 2 : left + i / (sorted.length - 1) * (W - left - right);
  const y = (value: number) => base - value / max * (base - top);
  const segments: string[][] = []; let current: string[] = [];
  sorted.forEach((p, i) => { if (valid(p.value)) current.push(`${x(i)},${y(p.value)}`); else if (current.length) { segments.push(current); current = []; } });
  if (current.length) segments.push(current);
  const table = <table className="m7r-sr-only"><caption>{title}</caption><thead><tr><th>Date</th><th>Value</th></tr></thead>
    <tbody>{sorted.map(p => <tr key={p.key}><td>{p.label}</td><td>{valid(p.value) ? fmt(p.value, unit) : 'No data'}</td></tr>)}</tbody></table>;
  return <Frame id={id} title={title} note={note} table={table}>
    {!present.length ? <p className="m7r-empty">{emptyText}</p> : <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}. Exact values are listed in the table that follows.`}>
      {[0, 0.5, 1].map(r => <g key={r}><line x1={left} x2={W - right} y1={y(r * max)} y2={y(r * max)} stroke="#dbe7e1" />
        <text x={left - 8} y={y(r * max) + 4} textAnchor="end" className="m7r-axis">{unit === '%' ? `${r * max}%` : Number((r * max).toFixed(1))}</text></g>)}
      {segments.map((s, i) => s.length > 1 && <polyline key={i} points={s.join(' ')} fill="none" stroke={color} strokeWidth="2.5" />)}
      {sorted.map((p, i) => valid(p.value) && <circle key={p.key} cx={x(i)} cy={y(p.value)} r="4.5" fill={color} stroke="#fff" strokeWidth="1.5"><title>{`${p.label}: ${fmt(p.value, unit)}`}</title></circle>)}
      <text x={x(0)} y={base + 24} textAnchor={sorted.length === 1 ? 'middle' : 'start'} className="m7r-axis">{sorted[0].label}</text>
      {sorted.length > 1 && <text x={x(sorted.length - 1)} y={base + 24} textAnchor="end" className="m7r-axis">{sorted[sorted.length - 1].label}</text>}
      <line x1={left} x2={W - right} y1={base} y2={base} stroke="#54736A" />
    </svg>}
  </Frame>;
}
