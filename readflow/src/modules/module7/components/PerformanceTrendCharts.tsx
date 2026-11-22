import { useId } from 'react';
import { formatAnalyticsDate } from '../services/dateDisplay';
import { trendPoints, trendSegments, type TrendMetric, type TrendWeek } from '../services/trendPresentation';

type Series = { metric: TrendMetric; label: string; color: string };
const percentageSeries: Series[] = [
  { metric: 'pronunciationAccuracy', label: 'Reading accuracy', color: '#286947' },
  { metric: 'comprehensionScore', label: 'Comprehension', color: '#a34c29' },
];
const speedSeries: Series[] = [{ metric: 'readingSpeedWpm', label: 'Reading speed', color: '#356a91' }];
const activitySeries: Series[] = [
  { metric: 'readingAttempts', label: 'Saved readings', color: '#286947' },
  { metric: 'completedQuizzes', label: 'Completed quizzes', color: '#a34c29' },
];

function TrendChart({ weeks, title, unit, series, bars = false }: { weeks: TrendWeek[]; title: string; unit: string; series: Series[]; bars?: boolean }) {
  const id = useId();
  const plots = series.map(s => ({ ...s, points: trendPoints(weeks, s.metric) }));
  const values = plots.flatMap(s => s.points.flatMap(p => p.value === null ? [] : [p.value]));
  const times = plots[0].points.map(p => p.time);
  const first = Math.min(...times), last = Math.max(...times);
  const max = unit === '%' ? 100 : Math.max(1, ...values);
  const x = (time: number) => first === last ? 320 : 96 + (time - first) / (last - first) * 480;
  const y = (value: number) => 206 - value / max * 166;
  const barWidth = Math.min(14, 240 / Math.max(1, (last - first) / (7 * 86400000) + 1));
  const ticks = [...new Set([0, times.length - 1])];
  return <figure className="sp-chart">
    <figcaption id={`${id}-title`}>{title} <span>({unit})</span></figcaption>
    <div className="sp-chart-legend">{series.map(s => <span key={s.metric}><i style={{ background: s.color }} />{s.label}</span>)}</div>
    {!values.length ? <p className="sp-empty">No recorded values for this chart.</p> : <svg viewBox="0 0 640 260" role="img" aria-labelledby={`${id}-title ${id}-description`}>
      <desc id={`${id}-description`}>Observed weekly {title.toLowerCase()}. Axis starts at zero. Missing weeks and values are gaps. Exact values and sample counts are available in the weekly table.</desc>
      {[0, 0.5, 1].map(ratio => <g key={ratio}>
        <line x1="96" x2="576" y1={y(ratio * max)} y2={y(ratio * max)} stroke="#dce4de" />
        <text x="86" y={y(ratio * max) + 5} textAnchor="end">{Number((ratio * max).toFixed(1))}</text>
      </g>)}
      {ticks.map(i => <text key={i} x={x(times[i])} y="240" textAnchor={i === 0 ? 'start' : i === times.length - 1 ? 'end' : 'middle'}>{formatAnalyticsDate(plots[0].points[i].weekStart)}</text>)}
      {plots.map((s, seriesIndex) => <g key={s.metric}>
        {!bars && trendSegments(s.points).map((segment, i) => <polyline key={i} fill="none" stroke={s.color} strokeWidth="2.5"
          strokeDasharray={seriesIndex ? '6 4' : undefined} points={segment.map(p => `${x(p.time)},${y(p.value)}`).join(' ')} />)}
        {s.points.filter(p => p.value !== null).map(p => {
          const tooltip = `${formatAnalyticsDate(p.weekStart)} · ${s.label}: ${p.value}${unit === '%' ? '%' : ` ${unit}`}`;
          return bars ? <rect key={p.weekStart} x={x(p.time) + (seriesIndex - 1) * barWidth} y={y(p.value!)} width={barWidth - 1} height={206 - y(p.value!)} fill={s.color}><title>{tooltip}</title></rect>
            : <circle key={p.weekStart} cx={x(p.time)} cy={y(p.value!)} r={seriesIndex ? 4 : 3} fill={s.color} stroke="white" strokeWidth="1"><title>{tooltip}</title></circle>;
        })}
      </g>)}
    </svg>}
  </figure>;
}

export default function PerformanceTrendCharts({ weeks }: { weeks: TrendWeek[] }) {
  if (!weeks.length) return <p className="sp-empty">No results available for a trend.</p>;
  return <div className="sp-charts">
    <TrendChart weeks={weeks} title="Weekly reading accuracy and comprehension" unit="%" series={percentageSeries} />
    <TrendChart weeks={weeks} title="Weekly reading speed" unit="WPM" series={speedSeries} />
    <TrendChart weeks={weeks} title="Weekly reading and quiz activity" unit="count" series={activitySeries} bars />
  </div>;
}
