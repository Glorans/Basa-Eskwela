// M8 F4: which classrooms the Student leaderboard offers, in what order, and which is selected first.
//   * A room the Student archived for themselves (M4 personal archive) is not offered at all. Classmates are
//     unaffected: their own lists and the room's rankings do not change.
//   * A room the Teacher archived stays viewable as history, listed separately after the active rooms and labelled
//     "(Archived)"; the database shows anonymous reader codes there.
//   * The first active room is selected by default; an archived room is selected only when no active room exists.
// Display only: the database still decides who may read each room's rankings.

export interface LeaderboardRoom { id: string; archived_at?: string | null }

export function leaderboardRooms<T extends LeaderboardRoom>(rooms: readonly T[], personallyArchived: ReadonlySet<string>) {
  const visible = rooms.filter((room) => !personallyArchived.has(room.id));
  const active = visible.filter((room) => !room.archived_at);
  const archived = visible.filter((room) => Boolean(room.archived_at));
  return { active, archived, defaultId: active[0]?.id ?? archived[0]?.id ?? "" };
}

/** "1 story", "2 stories". */
export function storyUnit(unit: string, count: number): string {
  return count === 1 && unit === "stories" ? "story" : unit;
}
