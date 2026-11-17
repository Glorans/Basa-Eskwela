export interface RankedEntry {
  xp: number;
  rank: number;
}

/**
 * Equal XP shares a rank ("1, 2, 2, 4"); order within a tie is unchanged.
 * Presentation only: XP values come from the database as they are.
 */
export function rankByXp<T extends RankedEntry>(entries: T[]): T[] {
  const sorted = [...entries].sort((a, b) => b.xp - a.xp);
  return sorted.map((entry, index) => ({
    ...entry,
    rank: index > 0 && sorted[index - 1].xp === entry.xp
      ? sorted.findIndex((other) => other.xp === entry.xp) + 1
      : index + 1,
  }));
}

/**
 * The signed-in learner's own row. Other learners stay anonymous ("Reader XXXXXX", from the database): there is no
 * public-display consent for Independent Learners. Only the viewer's OWN nickname, which only they see, is shown.
 */
export function ownLeaderboardLabel(displayName: string, ownNickname: string | null | undefined): string {
  const nickname = ownNickname?.trim();
  if (nickname) return `${nickname} (You)`;
  return displayName && displayName !== "You" ? `${displayName} (You)` : "You";
}
