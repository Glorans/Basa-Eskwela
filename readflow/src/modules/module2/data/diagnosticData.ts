import type {
  DiagnosticAssessment,
  DiagnosticAssessmentRegistry,
  DiagnosticLanguage,
} from "../types/diagnostic";
import { englishDiagnosticAssessment } from "./assessments/englishDiagnosticAssessment.ts";
import { filipinoDiagnosticAssessment } from "./assessments/filipinoDiagnosticAssessment.ts";

export const diagnosticAssessmentRegistry: DiagnosticAssessmentRegistry = {
  en: englishDiagnosticAssessment,
  fil: filipinoDiagnosticAssessment,
};

export function getDiagnosticAssessment<Language extends DiagnosticLanguage>(
  language: Language,
): DiagnosticAssessment<Language> | null {
  return diagnosticAssessmentRegistry[language];
}

export function requireDiagnosticAssessment<Language extends DiagnosticLanguage>(
  language: Language,
): DiagnosticAssessment<Language> {
  const assessment = getDiagnosticAssessment(language);

  if (!assessment) {
    throw new Error(`No diagnostic assessment is available for ${language}.`);
  }

  return assessment;
}

export function getDiagnosticPassageText(assessment: DiagnosticAssessment) {
  return assessment.passage.paragraphs.join(" ");
}

export function isDiagnosticLanguage(value: unknown): value is DiagnosticLanguage {
  return value === "en" || value === "fil";
}

export const diagnosticLanguageLabels = { en: "English", fil: "Filipino" } as const;

export function getRequiredDiagnosticLanguages(registry = diagnosticAssessmentRegistry): DiagnosticLanguage[] {
  return (["en", "fil"] as const).filter(language => registry[language]?.contentStatus === "active");
}

export function getNextDiagnosticLanguage(completed: readonly DiagnosticLanguage[], registry = diagnosticAssessmentRegistry) {
  return getRequiredDiagnosticLanguages(registry).find(language => !completed.includes(language));
}
