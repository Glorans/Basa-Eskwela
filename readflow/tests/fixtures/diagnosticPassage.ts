import { getDiagnosticPassageText, requireDiagnosticAssessment } from "../../src/modules/module2/data/diagnosticData.ts";
import { createPassageDiagnosticResult } from "../../src/modules/module2/services/diagnosticPassage.ts";
import { calculateOralReadingMetrics, getReadingWords } from "../../src/modules/module2/services/diagnosticScoring.ts";
import type { DiagnosticLanguage } from "../../src/modules/module2/types/diagnostic.ts";

/** A whole-passage FINAL transcript with exactly `miscues` single-word substitutions. */
export function passageTranscript(language: DiagnosticLanguage, miscues = 0) {
  const words = getReadingWords(getDiagnosticPassageText(requireDiagnosticAssessment(language)), language);
  return words.map((word, index) => index < miscues ? "zz" + index : word).join(" ");
}

export function passageAnswers(language: DiagnosticLanguage, correct = 6) {
  const { questions } = requireDiagnosticAssessment(language);
  return Object.fromEntries(questions.map((q, index) => [q.id,
    index < correct ? q.correctChoiceId : q.choices.find(c => c.id !== q.correctChoiceId)!.id]));
}

export function passageReading(language: DiagnosticLanguage, miscues = 0, durationSeconds = 30) {
  const text = passageTranscript(language, miscues);
  return { language, transcription: { text }, oralReadingMetrics: calculateOralReadingMetrics(
    getDiagnosticPassageText(requireDiagnosticAssessment(language)), text, durationSeconds, language) };
}

export function passageResult(language: DiagnosticLanguage, { miscues = 0, correct = 6, durationSeconds = 30 } = {}) {
  return createPassageDiagnosticResult(requireDiagnosticAssessment(language),
    passageReading(language, miscues, durationSeconds), passageAnswers(language, correct));
}

export const perfectResult = (language: DiagnosticLanguage) => passageResult(language);
