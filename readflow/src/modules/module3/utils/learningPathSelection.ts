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
