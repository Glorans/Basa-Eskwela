export type Period = 'all' | 'weekly' | 'monthly' | 'quarterly' | 'custom';
export interface AnalyticsScope { roomId: string; startDate: string; endDate: string }
export const allTime: AnalyticsScope = { roomId: '', startDate: '', endDate: '' };
const day = 86400000;
function dateValue(value: string) {
  const parsed = Date.parse(`${value}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0,10) !== value) throw new Error('Enter valid dates.');
  return parsed;
}
export function bounds(scope: AnalyticsScope) {
  if (!scope.startDate && !scope.endDate) return null;
  const start = dateValue(scope.startDate), end = dateValue(scope.endDate);
  if (end < start) throw new Error('End date must be on or after start date.');
  return { start: start - 8*3600000, end: end + day - 8*3600000 };
}
export function periodDates(period: Period, now = new Date()) {
  if (period === 'all' || period === 'custom') return { startDate: '', endDate: '' };
  const local = new Date(now.getTime()+8*3600000);
  let start = new Date(Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate()));
  let end: Date;
  if (period === 'weekly') { start = new Date(start.getTime()-((start.getUTCDay()+6)%7)*day); end = new Date(start.getTime()+6*day); }
  else { const month = period === 'quarterly' ? Math.floor(local.getUTCMonth()/3)*3 : local.getUTCMonth(); start = new Date(Date.UTC(local.getUTCFullYear(),month,1)); end = new Date(Date.UTC(local.getUTCFullYear(),month+(period === 'quarterly' ? 3 : 1),0)); }
  return { startDate: start.toISOString().slice(0,10), endDate: end.toISOString().slice(0,10) };
}
export function filterRecords<T extends { roomId?: string | null; completedAt: string | null }>(records: T[], scope: AnalyticsScope): T[] {
  const range = bounds(scope);
  return records.filter(record => (!scope.roomId || record.roomId === scope.roomId) && (!range || (record.completedAt !== null && Date.parse(record.completedAt) >= range.start && Date.parse(record.completedAt) < range.end)));
}
