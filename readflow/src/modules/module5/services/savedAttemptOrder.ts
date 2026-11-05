/** Stable result numbers within a module or assigned reading activity.
 * New completions append; identical timestamps are ordered by saved ID. */
export function numberSavedAttempts<T extends { id: string; completedAt: string }>(attempts: readonly T[]) {
  const unique = new Map(attempts.filter(row => row.id && Number.isFinite(Date.parse(row.completedAt)))
    .map(row => [row.id, row]));
  return [...unique.values()].sort((a, b) => Date.parse(a.completedAt) - Date.parse(b.completedAt)
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((attempt, index) => ({ ...attempt, resultNumber: index + 1 }));
}

/** The story a saved reading belongs to: an assigned material, or a module passage. */
export function historyReadingKey(attempt: {
  moduleId?: string | null; passageId?: string | null; materialId?: string | null; activityAssignmentId?: string | null;
}) {
  return attempt.materialId
    ? `material:${attempt.materialId}:${attempt.activityAssignmentId ?? ""}`
    : `module:${attempt.moduleId ?? ""}:${attempt.passageId ?? ""}`;
}

/**
 * F7 Reading History: "Reading 1, 2, 3…" per learner and story, in the order the
 * readings were completed. The list itself is shown newest first, so each card
 * keeps its real number. Returns attempt ID -> reading number.
 */
export function numberHistoryReadings<T extends {
  id: string; completedAt: string; moduleId?: string | null; passageId?: string | null;
  materialId?: string | null; activityAssignmentId?: string | null;
}>(attempts: readonly T[]) {
  const groups = new Map<string, T[]>();
  for (const attempt of attempts) {
    const key = historyReadingKey(attempt);
    groups.set(key, [...(groups.get(key) ?? []), attempt]);
  }
  const numbers = new Map<string, number>();
  for (const group of groups.values()) {
    for (const row of numberSavedAttempts(group)) numbers.set(row.id, row.resultNumber);
  }
  return numbers;
}
