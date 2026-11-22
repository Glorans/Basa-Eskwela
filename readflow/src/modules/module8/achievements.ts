// M8 Earn Badge and Earn Achievement. Badges mark that something was done (m8_badges,
// m8_earned_badges). Achievements show how well a learner does over time, in Bronze, Silver and Gold
// (m8_my_achievements). This file explains both to Grade 5 learners and shows how close they are,
// using the database's rules. It awards nothing.

export interface AchievementStats {
  totalXp: number;
  /** Rewarded reading activities, when known. Falls back to completedModules. */
  completedActivities?: number;
  /** XP that counts toward Diamond: the balance without daily login XP. Falls back to totalXp. */
  diamondXp?: number;
  readAloudCount: number;
  completedModules: number;
  readingDays: number;
  longestStreak: number;
}

interface AchievementGuide {
  /** What to do, in simple words. */
  howToEarn: string;
  /** Extra detail shown under the requirement. */
  note?: string;
  /** Progress toward the requirement, when the database rule is a simple count. */
  goal?: (stats: AchievementStats) => { current: number; target: number; unit: string };
}

// Targets match the database rules (supabase/staging/c2_m8_gamification_hardened.sql,
// readflow/supabase/migrations/20261022000000_m8_consistent_reader.sql).
export const ACHIEVEMENT_GUIDE: Readonly<Record<string, AchievementGuide>> = {
  first_read: {
    howToEarn: "Finish your first reading activity.",
    goal: (s) => ({ current: s.completedActivities ?? s.completedModules, target: 1, unit: "reading activity" }),
  },
  bookworm: {
    howToEarn: "Finish 3 different reading activities.",
    goal: (s) => ({ current: s.completedActivities ?? s.completedModules, target: 3, unit: "different activities" }),
  },
  diamond: {
    howToEarn: "Collect 2,000 XP from reading activities.",
    note: "Daily login XP does not count toward this badge.",
    goal: (s) => ({ current: s.diamondXp ?? s.totalXp, target: 2000, unit: "XP" }),
  },
  level_up: {
    howToEarn: "Reach the Medium or Hard reading level in your reading test.",
  },
  streak_3: {
    howToEarn: "Read on 3 days in a row.",
    note: "Uses your best streak, so it counts even if your current streak is shorter.",
    goal: (s) => ({ current: s.longestStreak, target: 3, unit: "consecutive days (best streak)" }),
  },
  consistent_reader: {
    howToEarn: "Read on 7 different days.",
    goal: (s) => ({ current: s.readingDays, target: 7, unit: "reading days" }),
  },
  brave_reader: {
    howToEarn: "Read a story aloud 10 times.",
    goal: (s) => ({ current: s.readAloudCount, target: 10, unit: "verified readings" }),
  },
  graduate: {
    howToEarn: "Finish every published reading module.",
  },
};

/** Progress for a locked achievement, capped at its target; null when the rule is not a simple count. */
export function achievementProgress(badgeId: string, stats: AchievementStats) {
  const goal = ACHIEVEMENT_GUIDE[badgeId]?.goal?.(stats);
  if (!goal || !Number.isFinite(goal.current)) return null;
  return { ...goal, current: Math.max(0, Math.min(goal.current, goal.target)) };
}

// Capstone rules (m8_final_corrections_v1): Bronze 1, Silver 2, Gold 3 qualifying stories, attainable with the
// published content. The database (m8_my_achievements) decides; these targets only label the progress bars.
export type AchievementTier = "Bronze" | "Silver" | "Gold";
const TIERS: readonly { tier: AchievementTier; target: number }[] = [
  { tier: "Bronze", target: 1 }, { tier: "Silver", target: 2 }, { tier: "Gold", target: 3 },
];

export const MILESTONE_GUIDE: Readonly<Record<string, { name: string; howToEarn: string; unit: string }>> = {
  accurate_reader: {
    name: "Accurate Reader",
    howToEarn: "Read English stories with at least 90% reading accuracy. Only your first reading of a story counts.",
    unit: "stories",
  },
  comprehension_star: {
    name: "Comprehension Star",
    howToEarn: "Score at least 80% on your first answers to a story's questions.",
    unit: "stories",
  },
};

/** The tier reached and the next target, from the count the database returns. */
export function milestoneProgress(qualifying: number) {
  const count = Number.isFinite(qualifying) ? Math.max(0, qualifying) : 0;
  const reached = [...TIERS].reverse().find(({ target }) => count >= target)?.tier ?? null;
  const next = TIERS.find(({ target }) => count < target) ?? null;
  return { count, reached, next };
}

/** The earned date in Philippine time, or null for a missing or invalid value. */
export function earnedDate(value: string | null): string | null {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toLocaleDateString("en-PH", { timeZone: "Asia/Manila", year: "numeric", month: "short", day: "numeric" });
}

// ========================================
// CLAIMING (m8_f2_f3_reward_claims_v1)
// ========================================
// The database decides eligibility and stores claims. These helpers only turn its answers into what the
// page shows: Locked, Ready to claim or Claimed.

export type RewardState = "locked" | "ready" | "claimed";

/** A badge's state from m8_my_badges: claimed wins, then eligible. */
export function badgeState(badge: { eligible: boolean; claimed_at: string | null }): RewardState {
  if (badge.claimed_at) return "claimed";
  return badge.eligible ? "ready" : "locked";
}

export type TierKey = "bronze" | "silver" | "gold";
export interface AchievementClaimRow { achievement_id: string; tier: string; claimed_at: string }
export interface TierStatus {
  key: TierKey;
  tier: AchievementTier;
  target: number;
  reachedAt: string | null;
  claimedAt: string | null;
  state: RewardState;
}

/**
 * Bronze, Silver and Gold of one achievement, each with its own state. Reaching a tier never claims it,
 * and claiming one tier never claims another. Without claim data (claiming not installed yet) a reached
 * tier shows as earned, as before.
 */
export function milestoneTiers(
  row: { achievement_id: string; bronze_at: string | null; silver_at: string | null; gold_at: string | null },
  claims: readonly AchievementClaimRow[] | null,
): TierStatus[] {
  const reached: Record<TierKey, string | null> = { bronze: row.bronze_at, silver: row.silver_at, gold: row.gold_at };
  return TIERS.map(({ tier, target }) => {
    const key = tier.toLowerCase() as TierKey;
    const reachedAt = reached[key] ?? null;
    const claimedAt = claims === null
      ? reachedAt
      : claims.find((claim) => claim.achievement_id === row.achievement_id && claim.tier === key)?.claimed_at ?? null;
    const state: RewardState = claimedAt ? "claimed" : reachedAt ? "ready" : "locked";
    return { key, tier, target, reachedAt, claimedAt, state };
  });
}

/** The database refused a claim because the reward is locked or retired: HTTP 409 (PT409), or 55000 before
 * m8_final_corrections_v1. */
export const isLockedError = (error: unknown) => ["PT409", "55000"].includes(String((error as { code?: unknown } | null)?.code ?? ""));

/** A learner-friendly message for a refused claim. */
export function claimErrorMessage(error: unknown): string {
  const code = String((error as { code?: unknown } | null)?.code ?? "");
  const message = String((error as { message?: unknown } | null)?.message ?? "");
  if (code === "PT409" && /no longer awarded/i.test(message)) return "This badge is no longer awarded.";
  if (code === "PT409" || code === "55000") return "This reward is still locked. Keep reading to unlock it!";
  if (code === "42501") return "Only Students and Independent Learners can claim rewards. Please log in again.";
  return "We could not claim this reward right now. Please try again.";
}

/** Retired badges (m8_final_corrections_v1): no longer earned; a learner's earlier claim stays as a past badge. */
export const RETIRED_BADGE_NOTE = "This badge is no longer awarded. You keep it as a past badge.";
/** A retired badge the learner unlocked before it was retired: it can still be claimed once. */
export const RETIRED_UNLOCKED_NOTE = "This badge is no longer awarded, but you unlocked it before. You can claim it once as a past badge.";
export const retiredBadgeNote = (state: RewardState) => (state === "claimed" ? RETIRED_BADGE_NOTE : RETIRED_UNLOCKED_NOTE);

/** Badge counter: claimed active badges out of all active badges, and past (retired) badges kept separately. */
export function badgeCounts(badges: readonly { state: RewardState; retired?: boolean }[]) {
  const active = badges.filter((badge) => !badge.retired);
  return {
    claimed: active.filter((badge) => badge.state === "claimed").length,
    total: active.length,
    past: badges.filter((badge) => badge.retired && badge.state === "claimed").length,
  };
}
