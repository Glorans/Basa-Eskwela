/** Stable result numbers within a module or assigned reading activity.
 * New completions append; identical timestamps are ordered by saved ID. */
export function numberSavedAttempts<T extends { id: string; completedAt: string }>(attempts: readonly T[]) {
  const unique = new Map(attempts.filter(row => row.id && Number.isFinite(Date.parse(row.completedAt)))
    .map(row => [row.id, row]));
  return [...unique.values()].sort((a, b) => Date.parse(a.completedAt) - Date.parse(b.completedAt)
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((attempt, index) => ({ ...attempt, resultNumber: index + 1 }));
}
