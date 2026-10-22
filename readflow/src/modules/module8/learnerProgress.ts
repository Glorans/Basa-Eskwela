import type { Difficulty, LearnerProgress } from "./gamificationService";

// Row shape of public.m8_learner_progress. The learner's unlocked difficulty
// is stored as unlocked_difficulty: it is derived from, but distinct from, the
// diagnostic reading level (Frustration/Instructional/Independent).
export interface LearnerProgressRow {
  user_id: string;
  total_xp?: number | null;
  current_streak?: number | null;
  longest_streak?: number | null;
  unlocked_difficulty?: unknown;
}

const DIFFICULTIES: readonly string[] = ["Easy", "Medium", "Hard"];

// A missing or unrecognised value is reported as null so the page can say the
// level is unavailable instead of presenting the learner as Easy.
export function parseUnlockedDifficulty(value: unknown): Difficulty | null {
  return typeof value === "string" && DIFFICULTIES.includes(value)
    ? (value as Difficulty)
    : null;
}

export function toLearnerProgress(row: LearnerProgressRow): LearnerProgress {
  return {
    user_id: row.user_id,
    total_xp: Number(row.total_xp ?? 0),
    current_streak: Number(row.current_streak ?? 0),
    longest_streak: Number(row.longest_streak ?? 0),
    difficulty: parseUnlockedDifficulty(row.unlocked_difficulty),
  };
}
