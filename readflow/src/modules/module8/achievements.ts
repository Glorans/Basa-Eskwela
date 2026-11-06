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
    goal: (s) => ({ current: s.completedActivities ?? s.completedModules, target: 1, unit: "activity" }),
  },
  bookworm: {
    howToEarn: "Finish 5 different reading activities.",
    goal: (s) => ({ current: s.completedActivities ?? s.completedModules, target: 5, unit: "activities" }),
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
    goal: (s) => ({ current: s.longestStreak, target: 3, unit: "days in a row" }),
  },
  consistent_reader: {
    howToEarn: "Read on 7 different days.",
    goal: (s) => ({ current: s.readingDays, target: 7, unit: "reading days" }),
  },
  brave_reader: {
    howToEarn: "Read a story aloud 10 times.",
    goal: (s) => ({ current: s.readAloudCount, target: 10, unit: "read-alouds" }),
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

// Provisional project rules, pending adviser approval (docs/M8_F2_F5_RELEASE_NOTES.md).
export type AchievementTier = "Bronze" | "Silver" | "Gold";
const TIERS: readonly { tier: AchievementTier; target: number }[] = [
  { tier: "Bronze", target: 3 }, { tier: "Silver", target: 10 }, { tier: "Gold", target: 25 },
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
