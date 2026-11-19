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

/** Server placement (initial diagnostic unless an approved policy lets a recorded reassessment count). */
export interface ServerPlacementSource {
  getServerPlacement(language: MaterialLanguageCode): Promise<LearnerPlacement>;
}

const READING_LEVELS = ["Independent", "Instructional", "Frustration"];
const TIERS = ["Easy", "Medium", "Hard"];

/**
 * Reading level and recommended tier for one language. Without an injected source, the backend placement endpoint is
 * asked first; if it is unavailable (not deployed yet, offline, error) the existing direct lookup of the learner's own
 * official initial result is used, which gives the same answer while no reassessment policy is approved.
 */
export async function getLearnerPlacement(
  language: MaterialLanguageCode,
  source?: DiagnosticPlacementSource,
  server?: ServerPlacementSource | null,
): Promise<LearnerPlacement> {
  // An injected legacy source alone (tests) skips the server; an injected server is always asked first.
  if (server !== null && (server !== undefined || !source)) {
    try {
      const api = server ?? await import("./placementApi");
      const placement = api ? await api.getServerPlacement(language) : null;
      if (placement?.status === "missing" && placement.language === language) return placement;
      if (placement?.status === "ready" && placement.language === language && READING_LEVELS.includes(placement.readingLevel)
        && TIERS.includes(placement.difficultyTier) && placement.assessmentId && placement.assessmentVersion) return placement;
    } catch { /* fall back to the direct lookup below */ }
  }
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
