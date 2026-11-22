import type { Metrics } from './m7Service';
export type TrendWeek = Metrics & { weekStart: string };
export type TrendMetric = 'pronunciationAccuracy' | 'comprehensionScore' | 'readingSpeedWpm' | 'readingAttempts' | 'completedQuizzes';
const WEEK = 7 * 86400000;

/** Presentation only: retain observed weeks and nulls; never fill missing weeks with zeros. */
export function trendPoints(weeks: TrendWeek[], metric: TrendMetric) {
  return [...weeks].sort((a, b) => a.weekStart.localeCompare(b.weekStart)).map(week => {
    const value = week[metric];
    const invalid = metric === 'comprehensionScore' && (week.invalidCompletedQuizzes ?? 0) > 0;
    return { weekStart: week.weekStart, time: Date.parse(`${week.weekStart}T00:00:00+08:00`),
      value: !invalid && typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null };
  });
}

/** Break lines at missing values AND omitted calendar weeks, rather than implying observations. */
export function trendSegments(points: ReturnType<typeof trendPoints>) {
  const segments: { weekStart: string; time: number; value: number }[][] = [];
  let previous: number | null = null;
  for (const point of points) {
    if (point.value === null) { previous = null; continue; }
    if (previous === null || point.time - previous !== WEEK) segments.push([]);
    segments[segments.length - 1].push({ ...point, value: point.value });
    previous = point.time;
  }
  return segments;
}
