import type { DiagnosticLanguage } from "../types/diagnostic";
import type { VersionStatus } from "../services/assessmentPackages";

// M2 F6: DISPLAY wording for the System Admin's Initial Diagnostic only. Stored status values, package titles and
// Reassessment (F10) labels are unchanged.

const LANGUAGE_NAMES: Record<DiagnosticLanguage, string> = { en: "English", fil: "Filipino" };

/** The assessment's name, the same for every version (the stored package title may be a passage title). */
export const initialAssessmentName = (language: DiagnosticLanguage) => `Initial Diagnostic — ${LANGUAGE_NAMES[language]}`;

/** Library status of a version. "Active" (what new learners take) is shown separately: see versionStateLabel. */
export const INITIAL_STATUS_LABELS: Record<VersionStatus, string> = {
  draft: "Draft",
  in_review: "Submitted",
  approved: "Approved",
  published: "Published",
  retired: "Retired",
};

/** Both meanings together, e.g. "Published · Active" or "Retired · Active" (a retired version learners still take). */
export const versionStateLabel = (status: VersionStatus, active: boolean) =>
  active ? `${INITIAL_STATUS_LABELS[status]} · Active` : INITIAL_STATUS_LABELS[status];
