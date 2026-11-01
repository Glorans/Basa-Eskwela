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
