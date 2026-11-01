
import { supabase } from "../../lib/supabaseClient";
import { toLearnerProgress } from "./learnerProgress";
import type { LearnerProgressRow } from "./learnerProgress";
import { rankByXp } from "./leaderboardRanking";

export type Difficulty = "Easy" | "Medium" | "Hard";

export type ReadingLevel =
  | "Frustration"
  | "Instructional"
  | "Independent";

export interface LearnerProgress {
  user_id: string;
  total_xp: number;
  current_streak: number;
  longest_streak: number;
  // From m8_learner_progress.unlocked_difficulty; null if missing or invalid.
  difficulty: Difficulty | null;
}

export interface Badge {
  id: string;
  name: string;
  description: string;
  icon: string;
  earned: boolean;
  earned_at: string | null;
}

export interface LeaderboardEntry {
  user_id: string;
  display_name: string;
  xp: number;
  difficulty: string;
  rank: number;
}

export const difficultyFromDiagnostic = (
  level: ReadingLevel
): Difficulty => {
  const difficultyMap: Record<ReadingLevel, Difficulty> = {
    Frustration: "Easy",
    Instructional: "Medium",
    Independent: "Hard",
  };

  return difficultyMap[level];
};

export const xpForModule = (
  difficulty: Difficulty
): number => {
  const xpMap: Record<Difficulty, number> = {
    Easy: 30,
    Medium: 50,
    Hard: 80,
  };

  return xpMap[difficulty];
};

// Temporary compatibility type for Module 8 tables and RPCs.
// Regenerate your Supabase database types after migration.
const db = supabase as any;

export async function getMyGamification(): Promise<{
  progress: LearnerProgress | null;
  badges: Badge[];
}> {
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError) throw authError;
  if (!user) throw new Error("Please log in first.");

  const [progressResult, earnedResult, badgesResult] =
    await Promise.all([
      db
        .from("m8_learner_progress")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle(),

      db
        .from("m8_earned_badges")
        .select("badge_id, earned_at")
        .eq("user_id", user.id),

      db
        .from("m8_badges")
        .select("id, name, description, icon"),
    ]);

  if (progressResult.error) {
    throw progressResult.error;
  }

  if (earnedResult.error) {
    throw earnedResult.error;
  }

  if (badgesResult.error) {
    throw badgesResult.error;
  }

  const earnedMap = new Map<string, string>();

  for (const item of earnedResult.data ?? []) {
    earnedMap.set(item.badge_id, item.earned_at);
  }

  const badges: Badge[] = (badgesResult.data ?? []).map(
    (badge: {
      id: string;
      name: string;
      description: string;
      icon: string;
    }) => ({
      id: badge.id,
      name: badge.name,
      description: badge.description,
      icon: badge.icon,
      earned: earnedMap.has(badge.id),
      earned_at: earnedMap.get(badge.id) ?? null,
    })
  );

  const rawProgress: LearnerProgressRow | null =
    progressResult.data;

  const progress: LearnerProgress | null = rawProgress
    ? toLearnerProgress(rawProgress)
    : null;

  return {
    progress,
    badges,
  };
}

export async function getWeeklyLeaderboard(): Promise<
  LeaderboardEntry[]
> {
  const { data, error } = await db.rpc(
    "m8_weekly_leaderboard"
  );

  if (error) throw error;

  return (data ?? []).map(
    (
      entry: {
        user_id: string;
        display_name?: string;
        xp?: number;
        total_xp?: number;
        difficulty?: string;
      },
      index: number
    ): LeaderboardEntry => ({
      user_id: entry.user_id,
      display_name:
        entry.display_name ?? "Student",
      xp: Number(entry.xp ?? entry.total_xp ?? 0),
      difficulty: entry.difficulty ?? "Easy",
      rank: index + 1,
    })
  );
}

export { rankByXp };

/**
 * Weekly rankings for one Learning Room (m8_classroom_leaderboard, proposed migration).
 * Returns null while that function is not deployed, so callers can fall back to
 * m8_weekly_leaderboard (all of the student's classrooms combined).
 */
export async function getClassroomLeaderboard(
  roomId: string
): Promise<LeaderboardEntry[] | null> {
  const { data, error } = await db.rpc("m8_classroom_leaderboard", {
    p_room_id: roomId,
  });

  if (error) {
    if (["PGRST202", "42883"].includes(String(error.code))) return null;
    throw error;
  }

  return rankByXp(
    (data ?? []).map(
      (entry: { user_id: string; display_name?: string; xp?: number; difficulty?: string }) => ({
        user_id: entry.user_id,
        display_name: entry.display_name ?? "Student",
        xp: Number(entry.xp ?? 0),
        difficulty: entry.difficulty ?? "Easy",
        rank: 0,
      })
    )
  );
}

export async function getIndependentLeaderboard(
  period: "weekly" | "all_time" = "weekly"
): Promise<LeaderboardEntry[]> {
  const { data, error } = await db.rpc(
    "m8_independent_leaderboard",
    {
      p_period: period,
    }
  );

  if (error) throw error;

  return (data ?? []).map(
    (
      entry: {
        user_id: string;
        display_name?: string;
        xp?: number;
        difficulty?: string;
      },
      index: number
    ): LeaderboardEntry => ({
      user_id: entry.user_id,
      display_name:
        entry.display_name ?? "Independent Learner",
      xp: Number(entry.xp ?? 0),
      difficulty: entry.difficulty ?? "Easy",
      rank: index + 1,
    })
  );
}
