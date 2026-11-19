import type { DiagnosticLanguage } from "../types/diagnostic";

/**
 * The initial diagnostic lineage per language. Any server-verified initial result of the lineage with version 3.0 or
 * later counts as completed (the built-in 3.0 or a version a System Admin activates later), so a learner is never asked
 * to retake. The pre-verification, sentence-based version 2.0 has a different id and is intentionally not part of it.
 * server/services/initialDiagnosticCompletion.js must name the same lineage ids (a test checks).
 */
export const INITIAL_DIAGNOSTIC_LINEAGE: Readonly<Record<DiagnosticLanguage, string>> = {
  en: "grade5-en-passage-v3",
  fil: "grade5-fil-passage-v3",
};

/** "major.minor" -> comparable number; anything else -> NaN (never official). */
export function initialVersionNumber(label: string | null | undefined) {
  return typeof label === "string" && /^[0-9]{1,4}(\.[0-9]{1,4})?$/.test(label)
    ? Number(label.split(".")[0]) * 10000 + Number(label.split(".")[1] ?? 0) : Number.NaN;
}
/** Version 3.0 is the first server-verified version of the lineage. */
export const FIRST_OFFICIAL_INITIAL_VERSION = initialVersionNumber("3.0");
