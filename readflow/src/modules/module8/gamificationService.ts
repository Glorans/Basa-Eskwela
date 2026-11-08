
import { supabase } from "../../lib/supabaseClient";
import { toLearnerProgress } from "./learnerProgress";
import type { LearnerProgressRow } from "./learnerProgress";
import { rankByXp } from "./leaderboardRanking";
import { philippineDate, readingStreaks } from "./readingStreak";
import { badgeState } from "./achievements";
import type { AchievementClaimRow, AchievementStats, RewardState, TierKey } from "./achievements";

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
  /** Locked, Ready to claim or Claimed, as the database decided. */
  state: RewardState;
  /** When the learner pressed Claim, or, if preserved, when it was awarded automatically. */
  claimed_at: string | null;
  /** Awarded automatically before claiming began: claimed_at is the original award date. */
  preserved: boolean;
}

export interface LeaderboardEntry {
  /** A learner's ID on the older functions; an opaque ID on the per-language rankings. */
  user_id: string;
  display_name: string;
  xp: number;
  /** Older functions only. The per-language rankings keep classmates' levels private. */
  difficulty?: string;
  rank: number;
  is_me?: boolean;
}

export type RankingLanguage = "en" | "fil";

export interface MilestoneRow {
  achievement_id: string;
  qualifying: number;
  bronze_at: string | null;
  silver_at: string | null;
  gold_at: string | null;
}

/** The function is not deployed yet: older pages and functions keep working. */
const isMissingFunction = (error: { code?: unknown }) => ["PGRST202", "42883"].includes(String(error.code));

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

export interface ReadingSummary {
  readingDays: number;
  lastReadDate: string | null;
  readToday: boolean;
}

/**
 * The signed-in learner's own M8 records (row-level security limits every read to them).
 * Reading only: opening the page never grants XP, badges or streak days. The current streak
 * is calculated from the saved reading days in Philippine time, so it is correct after a break
 * even though the stored value is only refreshed when a new reading day is saved.
 */
export async function getMyGamification(): Promise<{
  progress: LearnerProgress | null;
  badges: Badge[];
  /** False until reward claiming is deployed: every unlocked badge then shows as earned, as before. */
  claiming: boolean;
  stats: AchievementStats;
  reading: ReadingSummary;
}> {
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError) throw authError;
  if (!user) throw new Error("Please log in first.");

  const [progressResult, earnedResult, badgesResult, daysResult, xpResult, claimResult] =
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

      db
        .from("m8_reading_days")
        .select("reading_date")
        .eq("user_id", user.id),

      db
        .from("m8_xp_events")
        .select("xp_earned, source_type")
        .eq("user_id", user.id),

      db.rpc("m8_my_badges"),
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

  if (daysResult.error) {
    throw daysResult.error;
  }

  const earnedMap = new Map<string, string>();

  for (const item of earnedResult.data ?? []) {
    earnedMap.set(item.badge_id, item.earned_at);
  }

  if (claimResult.error && !isMissingFunction(claimResult.error)) {
    throw claimResult.error;
  }
  const claiming = !claimResult.error;

  // With claiming: the database's Locked / Ready / Claimed. Before it is deployed: earned badges as before.
  const badges: Badge[] = claiming
    ? ((claimResult.data ?? []) as MyBadgeRow[]).map(toBadge)
    : (badgesResult.data ?? []).map(
      (badge: {
        id: string;
        name: string;
        description: string;
        icon: string;
      }): Badge => ({
        id: badge.id,
        name: badge.name,
        description: badge.description,
        icon: badge.icon,
        state: earnedMap.has(badge.id) ? "claimed" : "locked",
        claimed_at: earnedMap.get(badge.id) ?? null,
        preserved: earnedMap.has(badge.id),
      })
    );

  const rawProgress: LearnerProgressRow | null =
    progressResult.data;

  const streaks = readingStreaks(
    (daysResult.data ?? []).map((row: { reading_date: string }) => row.reading_date),
    philippineDate()
  );
  const saved: LearnerProgress | null = rawProgress
    ? toLearnerProgress(rawProgress)
    : null;
  // Longest never decreases; the current streak follows today's date.
  const progress: LearnerProgress | null = saved
    ? { ...saved, current_streak: streaks.current, longest_streak: Math.max(saved.longest_streak, streaks.longest) }
    : null;
  const xpRows = (xpResult.error ? [] : xpResult.data ?? []) as { xp_earned: number; source_type: string }[];
  const loginXp = xpRows.filter((row) => row.source_type === "daily_login").reduce((sum, row) => sum + Number(row.xp_earned ?? 0), 0);
  const completedActivities = xpRows.filter((row) => ["passage", "assignment", "module"].includes(row.source_type)).length;
  const counters = rawProgress as (LearnerProgressRow & { read_aloud_count?: number | null; completed_modules?: number | null }) | null;

  return {
    progress,
    badges,
    claiming,
    stats: {
      totalXp: progress?.total_xp ?? 0,
      // Daily login XP is in the balance but does not count toward Diamond. Progress only:
      // the database decides the badge, so a failed read falls back to the balance.
      ...(loginXp > 0 ? { diamondXp: Math.max(0, (progress?.total_xp ?? 0) - loginXp) } : {}),
      ...(completedActivities > 0 ? { completedActivities } : {}),
      readAloudCount: Number(counters?.read_aloud_count ?? 0),
      completedModules: Number(counters?.completed_modules ?? 0),
      readingDays: streaks.readingDays,
      longestStreak: progress?.longest_streak ?? streaks.longest,
    },
    reading: { readingDays: streaks.readingDays, lastReadDate: streaks.lastReadDate, readToday: streaks.readToday },
  };
}

/** The learner's Bronze, Silver and Gold progress; null until m8_my_achievements is deployed. */
export async function getMyAchievements(): Promise<MilestoneRow[] | null> {
  const { data, error } = await db.rpc("m8_my_achievements");
  if (error) {
    if (isMissingFunction(error)) return null;
    throw error;
  }
  return data ?? [];
}

interface MyBadgeRow {
  badge_id: string;
  name: string;
  description: string;
  icon: string;
  eligible: boolean;
  claimed_at: string | null;
  preserved?: boolean;
}
const toBadge = (row: MyBadgeRow): Badge => ({
  id: row.badge_id, name: row.name, description: row.description, icon: row.icon,
  state: badgeState({ eligible: row.eligible === true, claimed_at: row.claimed_at ?? null }), claimed_at: row.claimed_at ?? null,
  preserved: row.preserved === true,
});

/**
 * Claims one badge for the signed-in learner. The database rechecks the rule, so a locked badge is
 * refused (code 55000) and a repeat returns the first claim. Returns the claim date.
 */
export async function claimBadge(badgeId: string): Promise<{ claimedAt: string; newlyClaimed: boolean }> {
  const { data, error } = await db.rpc("m8_claim_badge", { p_badge_id: badgeId });
  if (error) throw error;
  const row = (data ?? [])[0] as { claimed_at: string; newly_claimed: boolean } | undefined;
  if (!row?.claimed_at) throw new Error("The badge was not claimed. Please try again.");
  return { claimedAt: row.claimed_at, newlyClaimed: row.newly_claimed === true };
}

/** The learner's claimed achievement tiers; null until reward claiming is deployed. */
export async function getMyAchievementClaims(): Promise<AchievementClaimRow[] | null> {
  const { data, error } = await db.rpc("m8_my_achievement_claims");
  if (error) {
    if (isMissingFunction(error)) return null;
    throw error;
  }
  return data ?? [];
}

/** Claims one tier of one achievement. Other tiers stay as they are. */
export async function claimAchievement(achievementId: string, tier: TierKey): Promise<{ claimedAt: string; newlyClaimed: boolean }> {
  const { data, error } = await db.rpc("m8_claim_achievement", { p_achievement_id: achievementId, p_tier: tier });
  if (error) throw error;
  const row = (data ?? [])[0] as { claimed_at: string; newly_claimed: boolean } | undefined;
  if (!row?.claimed_at) throw new Error("The achievement was not claimed. Please try again.");
  return { claimedAt: row.claimed_at, newlyClaimed: row.newly_claimed === true };
}

type RankingRow = { entry_id: string; display_name?: string; xp?: number; is_me?: boolean };
const toRanked = (rows: RankingRow[] | null): LeaderboardEntry[] => rankByXp((rows ?? []).map((row) => ({
  user_id: row.entry_id, display_name: row.display_name ?? "Reader", xp: Number(row.xp ?? 0), is_me: row.is_me === true, rank: 0,
})));

/** One classroom's weekly ranking in one language; null until m8_classroom_rankings is deployed. */
export async function getClassroomRankings(roomId: string, language: RankingLanguage): Promise<LeaderboardEntry[] | null> {
  const { data, error } = await db.rpc("m8_classroom_rankings", { p_room_id: roomId, p_language: language });
  if (error) {
    if (isMissingFunction(error)) return null;
    throw error;
  }
  return toRanked(data);
}

/** The Independent Learner ranking in one language; null until m8_independent_rankings is deployed. */
export async function getIndependentRankings(period: "weekly" | "all_time", language: RankingLanguage): Promise<LeaderboardEntry[] | null> {
  const { data, error } = await db.rpc("m8_independent_rankings", { p_period: period, p_language: language });
  if (error) {
    if (isMissingFunction(error)) return null;
    throw error;
  }
  return toRanked(data);
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
