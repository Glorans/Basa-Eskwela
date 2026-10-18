import type { ReadingLevel } from "../../../data/dashboardData";
import type { SavedDiagnosticResult } from "../../module2/types/diagnostic";
import type { MaterialLanguageCode, ModuleDifficulty } from "../types/content";

export type LearnerPlacement = {
  status: "ready";
  language: MaterialLanguageCode;
  readingLevel: ReadingLevel;
  difficultyTier: ModuleDifficulty;
  assessmentId: string;
  assessmentVersion: string;
} | { status: "missing"; language: MaterialLanguageCode };

interface DiagnosticPlacementSource {
  hasCompletedInitialDiagnostic(language: MaterialLanguageCode): Promise<boolean>;
  getInitialDiagnosticResult(language: MaterialLanguageCode): Promise<SavedDiagnosticResult | null>;
}

export async function getLearnerPlacement(
  language: MaterialLanguageCode,
  source?: DiagnosticPlacementSource,
): Promise<LearnerPlacement> {
  const diagnostics = source ?? await import("../../module2/services/diagnosticDatabase");
  const missing = { status: "missing", language } as const;
  // M2 owns active-assessment validation; retrieval alone also permits old results.
  if (!await diagnostics.hasCompletedInitialDiagnostic(language)) return missing;
  const saved = await diagnostics.getInitialDiagnosticResult(language);
  const result = saved?.result;
  if (!result || result.language !== language || !result.assessmentId || !result.assessmentVersion
    || !["Independent", "Instructional", "Frustration"].includes(result.readingLevel ?? "")
    || !["Easy", "Medium", "Hard"].includes(result.difficultyTier ?? "")) return missing;
  return { status: "ready", language, readingLevel: result.readingLevel!,
    difficultyTier: result.difficultyTier!, assessmentId: result.assessmentId,
    assessmentVersion: result.assessmentVersion };
}
