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
 * The signed-in learner's own row. Other learners are anonymous ("Reader XXXXXX") unless they chose a leaderboard
 * nickname and nicknames are approved (m8_leaderboard_privacy_v1); the database decides. Without a chosen nickname,
 * the viewer's OWN profile nickname, which only they see, is shown.
 */
export function ownLeaderboardLabel(displayName: string, ownNickname: string | null | undefined): string {
  // The learner chose a leaderboard nickname that others see: the database sends "You (ReadingStar)".
  const shown = /^You \((.+)\)$/.exec(displayName);
  if (shown) return `${shown[1]} (You)`;
  const nickname = ownNickname?.trim();
  if (nickname) return `${nickname} (You)`;
  return displayName && displayName !== "You" ? `${displayName} (You)` : "You";
}
