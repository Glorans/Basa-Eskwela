/** Pure helpers for M2 F3 (View Assessment Results and History). No data access. */
export interface HistoryEntryLike {
  id: string;
  assessmentType: string;
  language: string;
  completedAt: string;
}

export const HISTORY_LANGUAGES = [
  { code: "en", label: "English" },
  { code: "fil", label: "Filipino" },
] as const;

export function assessmentTypeLabel(type: string) {
  if (type === "initial") return "Initial";
  if (type === "reassessment") return "Reassessment";
  return type ? type.charAt(0).toUpperCase() + type.slice(1) : "Unknown";
}

export function formatScore(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`
    : "—";
}

export function formatCompletedDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Unavailable"
    : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function versionLabel(version: string | null | undefined) {
  return version ? `Version ${version}` : "Not recorded";
}

/** Newest first (ties by id, so the order is stable). */
export function sortNewestFirst<T extends HistoryEntryLike>(entries: readonly T[]) {
  return [...entries].sort((a, b) => {
    const time = Date.parse(b.completedAt) - Date.parse(a.completedAt);
    return Number.isNaN(time) || time === 0 ? b.id.localeCompare(a.id) : time;
  });
}

/** English and Filipino separately, each newest first. Unknown languages are not shown. */
export function groupHistoryByLanguage<T extends HistoryEntryLike>(entries: readonly T[]) {
  return HISTORY_LANGUAGES.map(({ code, label }) => ({
    code,
    label,
    entries: sortNewestFirst(entries.filter((entry) => entry.language === code)),
  }));
}
