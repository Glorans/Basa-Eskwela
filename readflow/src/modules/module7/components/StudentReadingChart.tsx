import { useId } from 'react';
import type { AdminStudentDetail } from '../services/m7Service';
import { studentReadingPoints } from '../services/studentReadingPresentation';
import { formatAnalyticsDate, formatAnalyticsDateTime } from '../services/dateDisplay';

export default function StudentReadingChart({ readings }: { readings: AdminStudentDetail['readings'] }) {
  const id = useId(), points = studentReadingPoints(readings);
  if (!points.length) return null;
  const first = points[0].time, last = points[points.length - 1].time;
  const x = (time: number) => first === last ? 320 : 100 + (time - first) / (last - first) * 470;
  return <div className="asp-reading-charts">{(['readingAccuracy', 'readingSpeedWpm'] as const).map(metric => {
    const title = metric === 'readingAccuracy' ? 'Reading accuracy' : 'Reading speed';
    const unit = metric === 'readingAccuracy' ? '%' : 'WPM';
    const valid = points.filter(p => typeof p[metric] === 'number' && Number.isFinite(p[metric]) && p[metric]! >= 0);
    const max = metric === 'readingAccuracy' ? 100 : Math.max(1, ...valid.map(p => p[metric]!));
    const y = (value: number) => 200 - value / max * 155;
    return <figure key={metric}><figcaption id={`${id}-${metric}`}>{title} <span>({unit})</span></figcaption>
      {!valid.length ? <p>No recorded values available.</p> : <svg viewBox="0 0 640 265" role="img" aria-labelledby={`${id}-${metric}`}>
        <desc>Each point is a saved reading attempt, plotted by completion date. No intermediate values are inferred. The table below contains every saved attempt and its exact available values.</desc>
        {[0, 0.5, 1].map(ratio => <g key={ratio}><line x1="100" x2="570" y1={y(max * ratio)} y2={y(max * ratio)} stroke="#dce5dc" /><text x="88" y={y(max * ratio) + 5} textAnchor="end">{Number((max * ratio).toFixed(1))}</text></g>)}
        {valid.map(p => <circle key={p.id} cx={x(p.time)} cy={y(p[metric]!)} r="4" fill={metric === 'readingAccuracy' ? '#286947' : '#356a91'}><title>{p.title} · {formatAnalyticsDateTime(p.completedAt)} PHT · {p[metric]} {unit}</title></circle>)}
        <text x={first === last ? 320 : 100} y="242" textAnchor={first === last ? 'middle' : 'start'}>{formatAnalyticsDate(points[0].completedAt)}</text>
        {first !== last && <text x="570" y="242" textAnchor="end">{formatAnalyticsDate(points[points.length - 1].completedAt)}</text>}
      </svg>}
    </figure>;
  })}</div>;
}
