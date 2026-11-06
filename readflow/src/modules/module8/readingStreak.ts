// M8 View Reading Streak: calculated when the page is viewed, from the learner's saved reading
// days (m8_reading_days, one row per Philippine calendar date). The stored current_streak is
// only refreshed when a new reading day is saved, so it can be out of date after a break; this
// reads the same records and never writes anything.

const DAY_MS = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Calendar day number for a YYYY-MM-DD date, or NaN when the value is not a real date. */
function dayNumber(date: string): number {
  if (!ISO_DATE.test(date)) return Number.NaN;
  const [year, month, day] = date.split("-").map(Number);
  const time = Date.UTC(year, month - 1, day);
  return new Date(time).toISOString().slice(0, 10) === date ? time / DAY_MS : Number.NaN;
}

/** Today's date in the Philippines (Asia/Manila, UTC+8), as YYYY-MM-DD. */
export function philippineDate(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export interface ReadingStreaks {
  /** Consecutive reading days ending today or yesterday; 0 after a missed day. */
  current: number;
  longest: number;
  readingDays: number;
  lastReadDate: string | null;
  readToday: boolean;
}

/**
 * - Several readings on one date count once (dates are de-duplicated).
 * - Read today: the run ending today. Last read yesterday: the run is kept, because today
 *   can still continue it. Last read earlier: 0.
 * - Dates after today and invalid values are ignored.
 */
export function readingStreaks(dates: readonly string[], today: string): ReadingStreaks {
  const todayNumber = dayNumber(today);
  const days = [...new Set(dates.map(dayNumber).filter((day) => Number.isFinite(day) && day <= todayNumber))].sort((a, b) => a - b);
  if (!days.length) return { current: 0, longest: 0, readingDays: 0, lastReadDate: null, readToday: false };

  let longest = 1;
  let run = 1;
  for (let index = 1; index < days.length; index += 1) {
    run = days[index] === days[index - 1] + 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
  }
  const latest = days[days.length - 1];
  let current = 0;
  if (latest >= todayNumber - 1) {
    current = 1;
    for (let index = days.length - 1; index > 0 && days[index - 1] === days[index] - 1; index -= 1) current += 1;
  }
  return {
    current, longest, readingDays: days.length,
    lastReadDate: new Date(latest * DAY_MS).toISOString().slice(0, 10),
    readToday: latest === todayNumber,
  };
}
