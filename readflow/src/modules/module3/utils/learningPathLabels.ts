import type { LearningPath, ModuleDifficulty } from "../types/content";

// Learning paths come from the database and keep their names. These helpers only
// make the separate meanings visible: the path's language, its Phil-IRI reading
// level (from M2 placement) and its difficulty tier, versus the module's own
// difficulty (which sets M8 module XP).
export function learningPathOptionLabel(path: LearningPath): string {
  return `${path.name} — ${path.language === "fil" ? "Filipino" : "English"} · ${path.readingLevel} reading level · ${path.difficultyTier} tier`;
}

export function learningPathDescription(path: LearningPath): string {
  return `Learners placed at the ${path.readingLevel} reading level in ${path.language === "fil" ? "Filipino" : "English"} are recommended modules from this path. Its difficulty tier is ${path.difficultyTier}.`;
}

export function difficultyTierMismatch(
  path: Pick<LearningPath, "difficultyTier"> | undefined,
  difficulty: ModuleDifficulty | string,
): string | null {
  if (!path || path.difficultyTier === difficulty) return null;
  return `This module's difficulty (${difficulty}) differs from the learning path's ${path.difficultyTier} tier. Learner recommendations use the path; module XP uses the module difficulty.`;
}
