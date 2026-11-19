import { restorePassageReading } from "./diagnosticPassage.ts";
import type { DiagnosticAnswers } from "./diagnosticScoring.ts";
import type { DiagnosticAssessment, DiagnosticQuestionsRouteState } from "../types/diagnostic.ts";

export interface DiagnosticSession {
  assessmentId: string;
  assessmentVersion: string;
  reading: DiagnosticQuestionsRouteState;
  answers: DiagnosticAnswers;
  questionIndex: number;
}

/** "m2" = the official diagnostic; "m2-practice" = F7 staff Practice Mode, so the two drafts can never mix. */
export type DiagnosticSessionNamespace = "m2" | "m2-practice";

export function diagnosticSessionKey(userId: string, assessment: DiagnosticAssessment, namespace: DiagnosticSessionNamespace = "m2") {
  return `readflow:${namespace}:${encodeURIComponent(userId)}:${assessment.language}:${encodeURIComponent(assessment.id)}:${encodeURIComponent(assessment.version)}`;
}

export function recoverDiagnosticSession(raw: string | null, userId: string, assessment: DiagnosticAssessment, now = Date.now()): DiagnosticSession | null {
  if (!raw || raw.length > 200000) return null;
  try {
    const value = JSON.parse(raw);
    if (value.userId !== userId || value.assessmentId !== assessment.id
      || value.assessmentVersion !== assessment.version || value.reading?.language !== assessment.language
      || !Number.isFinite(value.savedAt) || value.savedAt > now || now - value.savedAt > 86400000) return null;
    // Recover from the saved Google FINAL transcript, never visual progress or scores.
    const reading = restorePassageReading(value.reading, assessment);
    const answers: DiagnosticAnswers = {};
    for (const question of assessment.questions) {
      const answer = value.answers?.[question.id];
      if (question.choices.some(choice => choice.id === answer)) answers[question.id] = answer;
    }
    // Invalid/tampered steps cannot skip unanswered questions.
    const firstUnanswered = assessment.questions.findIndex(question => !answers[question.id]);
    const maxIndex = firstUnanswered < 0 ? assessment.questions.length - 1 : firstUnanswered;
    const questionIndex = Number.isInteger(value.questionIndex)
      ? Math.max(0, Math.min(value.questionIndex, maxIndex)) : 0;
    return { assessmentId: assessment.id, assessmentVersion: assessment.version, answers, questionIndex, reading };
  } catch { return null; }
}

export function serializeDiagnosticSession(session: DiagnosticSession, userId: string) {
  return JSON.stringify({ ...session, userId, savedAt: Date.now() });
}
