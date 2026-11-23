import type { LearningPath } from "../types/content";

// Never pick the first row when the catalog has a duplicate pair.
export function resolveLearningPath(paths: readonly LearningPath[], language: string, readingLevel: string) {
  const matches = paths.filter(path => path.language === language && path.readingLevel === readingLevel);
  return matches.length === 1 ? matches[0] : null;
}

export function learningPathSelectionIssue(paths: readonly LearningPath[], language: string, readingLevel: string) {
  if (!language || !readingLevel) return "Choose a language and reading level.";
  const matches = paths.filter(path => path.language === language && path.readingLevel === readingLevel);
  if (!matches.length) return "No learning path is configured for this combination. Contact your administrator.";
  if (matches.length > 1) return "More than one learning path matches this combination. Contact your administrator; no path was selected automatically.";
  return "";
}

// M3 all-role refinement: modules no longer ask for a reading level (a learner classification, not material metadata).
// Each learning path pairs one difficulty tier with one reading level, so the path is chosen from the module's
// language and difficulty. Learner recommendations keep working unchanged (placement -> path -> modules).
export function resolveLearningPathByDifficulty(paths: readonly LearningPath[], language: string, difficulty: string) {
  const matches = paths.filter(path => path.language === language && path.difficultyTier === difficulty);
  return matches.length === 1 ? matches[0] : null;
}

export function difficultyPathIssue(paths: readonly LearningPath[], language: string, difficulty: string) {
  if (!language) return "Choose a language.";
  const matches = paths.filter(path => path.language === language && path.difficultyTier === difficulty);
  if (!matches.length) return "No learning path is configured for this language and difficulty. Contact your administrator.";
  if (matches.length > 1) return "More than one learning path matches this language and difficulty. Contact your administrator; no path was selected automatically.";
  return "";
}
