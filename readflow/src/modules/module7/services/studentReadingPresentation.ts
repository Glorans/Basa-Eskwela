import type { AdminStudentDetail } from './m7Service';
/** Plot each saved attempt; preserve duplicates, nulls and original response order. No averaging or interpolation. */
export function studentReadingPoints(readings: AdminStudentDetail['readings']) {
  return readings.map(reading => ({ ...reading, time: Date.parse(reading.completedAt) }))
    .filter(reading => Number.isFinite(reading.time))
    .sort((a, b) => a.time - b.time);
}
