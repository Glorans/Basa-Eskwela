import { getDiagnosticPassageText } from "../data/diagnosticData.ts";
import type { DiagnosticAssessment, DiagnosticQuestionsRouteState, DiagnosticResult } from "../types/diagnostic.ts";
import { calculateOralReadingMetrics, createDiagnosticResult, getReadingWords, type DiagnosticAnswers } from "./diagnosticScoring.ts";

/**
 * Rebuilds the whole-passage reading from the saved Google FINAL transcript and
 * recording duration. Scores are always recalculated, never trusted from storage.
 * The passage is graded as one unit: one transcript, one set of metrics.
 */
export function restorePassageReading(value: unknown, assessment: DiagnosticAssessment): DiagnosticQuestionsRouteState {
  const reading = value as Partial<DiagnosticQuestionsRouteState> | undefined;
  const text = reading?.transcription?.text;
  const duration = reading?.oralReadingMetrics?.recordingDurationSeconds;
  if (typeof text !== "string" || text.length > 30000 || !getReadingWords(text, assessment.language).length
    || typeof duration !== "number" || !Number.isFinite(duration) || duration <= 0 || duration > 301) {
    throw new Error("Invalid passage reading");
  }
  const confidence = reading?.transcription?.confidence;
  return {
    language: assessment.language,
    transcription: { text, ...(typeof confidence === "number" && confidence >= 0 && confidence <= 1 ? { confidence } : {}) },
    oralReadingMetrics: calculateOralReadingMetrics(getDiagnosticPassageText(assessment), text, duration, assessment.language),
  };
}

export function createPassageDiagnosticResult(
  assessment: DiagnosticAssessment,
  reading: unknown,
  answers: DiagnosticAnswers,
): DiagnosticResult {
  const restored = restorePassageReading(reading, assessment);
  if (assessment.questions.some(q => !q.choices.some(c => c.id === answers[q.id]))) {
    throw new Error("Read the story and answer every question first.");
  }
  const comprehensionAnswers = Object.fromEntries(assessment.questions.map(q => [q.id, answers[q.id]]));
  return {
    ...createDiagnosticResult(comprehensionAnswers, assessment.questions, assessment.language, restored),
    assessmentId: assessment.id,
    assessmentVersion: assessment.version,
    comprehensionAnswers,
  };
}
