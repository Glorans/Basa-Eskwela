const unavailable = 'Date unavailable';

function parseDate(value: unknown): { date: Date; dateOnly: boolean } | null {
  if (typeof value !== 'string') return null;
  // Require an unambiguous saved ISO date, and reject calendar rollover (e.g. February 30).
  const match = /^(\d{4}-\d{2}-\d{2})(?:$|[T ])/.exec(value);
  if (!match) return null;
  const day = new Date(`${match[1]}T00:00:00Z`);
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== match[1]) return null;
  const dateOnly = value.length === 10;
  const date = new Date(dateOnly ? `${value}T00:00:00+08:00` : value);
  return Number.isFinite(date.getTime()) ? { date, dateOnly } : null;
}

export function formatAnalyticsDateTime(value: unknown): string {
  const parsed = parseDate(value);
  return parsed ? parsed.date.toLocaleString('en-PH', {
    timeZone: 'Asia/Manila', dateStyle: 'medium',
    ...(parsed.dateOnly ? {} : { timeStyle: 'short' as const }),
  }) : unavailable;
}

export function formatAnalyticsDate(value: unknown): string {
  const parsed = parseDate(value);
  return parsed ? parsed.date.toLocaleDateString('en-PH', {
    timeZone: 'Asia/Manila', year: 'numeric', month: 'short', day: 'numeric',
  }) : unavailable;
}
