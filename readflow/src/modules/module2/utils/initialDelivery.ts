import { getDiagnosticAssessment } from "../data/diagnosticData.ts";
import { diagnosticSessionKey } from "../services/diagnosticSession.ts";
import type { DiagnosticAssessment, DiagnosticLanguage } from "../types/diagnostic.ts";

/**
 * M2 F6: which initial diagnostic version a learner takes is decided by the SERVER (System Admin activation). The
 * built-in 3.0 ships with the app; an activated package version arrives WITHOUT answer keys (the server scores it).
 */
export interface InitialDelivery {
  active: { source: "code" | "package"; id: string; version: string };
  accepted: { id: string; version: string }[];
  delivered: {
    source: "code" | "package";
    id: string;
    version: string;
    assessment?: {
      id: string;
      version: string;
      language: DiagnosticLanguage;
      title: string;
      passage: { title: string; paragraphs: string[] };
      questions: { id: string; prompt: string; choices: { id: string; label: string }[] }[];
    };
  };
}

/** The DiagnosticAssessment for a delivery: the bundled one for the built-in version, else the package content. */
export function assessmentFromDelivery(language: DiagnosticLanguage, delivered: InitialDelivery["delivered"]): DiagnosticAssessment | null {
  const bundled = getDiagnosticAssessment(language);
  if (delivered.source === "code") return bundled && bundled.version === delivered.version ? bundled : null;
  const a = delivered.assessment;
  if (!a || a.language !== language || !a.questions?.length || !a.passage?.paragraphs?.length) return null;
  return {
    id: a.id,
    title: a.title,
    gradeLevel: bundled?.gradeLevel ?? 5,
    language,
    assessmentType: "initial",
    sourceLabel: "Initial diagnostic",
    sourceUrl: "",
    version: a.version,
    contentStatus: "active",
    passage: { language, title: a.passage.title, paragraphs: [...a.passage.paragraphs] },
    // No answer keys are delivered; the server scores with the stored keys of this exact version.
    questions: a.questions.map((q) => ({ id: q.id, prompt: q.prompt, choices: q.choices.map((c) => ({ id: c.id, label: c.label })), correctChoiceId: "" })),
  };
}

/**
 * A version other than the active one that the learner already started (a saved draft) and the server still accepts.
 * Resuming it means the content never changes midway through a learner's diagnostic.
 */
export function draftVersionToResume(userId: string, language: DiagnosticLanguage, delivery: InitialDelivery,
  hasDraft: (key: string) => boolean): string | null {
  for (const candidate of delivery.accepted) {
    if (candidate.version === delivery.active.version) continue;
    const key = diagnosticSessionKey(userId, { language, id: candidate.id, version: candidate.version } as DiagnosticAssessment);
    if (hasDraft(key)) return candidate.version;
  }
  return null;
}

export type InitialDiagnosticLoad =
  | { status: "ready"; assessment: DiagnosticAssessment }
  | { status: "error"; message: string };

export const INITIAL_LOAD_ERROR = "We couldn't load the diagnostic. Check your connection and try again.";
export const INITIAL_OUTDATED_ERROR = "The diagnostic was updated. Please reload the page to continue.";
const statusOf = (error: unknown) => (error as { response?: { status?: unknown } } | null)?.response?.status;

/**
 * Decides which initial diagnostic the learner sees. The server's choice is never replaced by a guess:
 *   * the delivery endpoint does not exist (HTTP 404, a backend from before F6): that backend only knows the built-in
 *     version, so the bundled assessment is exactly what it expects;
 *   * any other failure: an error with Try Again (never the bundled version, which may not be the active one);
 *   * a started version the server no longer accepts (HTTP 409 on resume): the active version it already returned;
 *   * a delivery this app cannot show (for example a newer built-in version): ask the learner to reload.
 */
export async function resolveInitialDiagnostic(
  language: DiagnosticLanguage,
  userId: string,
  fetchDelivery: (language: DiagnosticLanguage, version?: string) => Promise<InitialDelivery>,
  hasDraft: (key: string) => boolean,
): Promise<InitialDiagnosticLoad> {
  let delivery: InitialDelivery;
  try {
    delivery = await fetchDelivery(language);
  } catch (error) {
    const bundled = getDiagnosticAssessment(language);
    return statusOf(error) === 404 && bundled ? { status: "ready", assessment: bundled } : { status: "error", message: INITIAL_LOAD_ERROR };
  }
  const resume = draftVersionToResume(userId, language, delivery, hasDraft);
  if (resume) {
    try {
      delivery = await fetchDelivery(language, resume);
    } catch (error) {
      if (statusOf(error) !== 409) return { status: "error", message: INITIAL_LOAD_ERROR };
    }
  }
  const assessment = assessmentFromDelivery(language, delivery.delivered);
  return assessment ? { status: "ready", assessment } : { status: "error", message: INITIAL_OUTDATED_ERROR };
}
