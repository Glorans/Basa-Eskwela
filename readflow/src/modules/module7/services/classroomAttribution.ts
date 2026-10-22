// Membership authorizes access; only the saved classroom identifies attribution.
export function attributeClassroomAttempts<T extends { id: string; learnerId: string; roomId?: string | null }>(
  attempts: T[], memberships: Map<string, Set<string>>,
) {
  const attemptsByClass = new Map<string, T[]>();
  const seen = new Set<string>();
  let unattributedReadingAttempts = 0;
  for (const attempt of attempts) {
    if (seen.has(attempt.id)) continue;
    seen.add(attempt.id);
    const rooms = memberships.get(attempt.learnerId);
    if (!rooms?.size) continue;
    if (!attempt.roomId) {
      unattributedReadingAttempts++;
      continue;
    }
    if (!rooms.has(attempt.roomId)) continue;
    const group = attemptsByClass.get(attempt.roomId) ?? [];
    group.push(attempt);
    attemptsByClass.set(attempt.roomId, group);
  }
  return { attemptsByClass, unattributedReadingAttempts };
}
