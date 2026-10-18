import type { DiagnosticLanguage, OralReadingMetrics } from "../types/diagnostic";
import { getDiagnosticPracticeWords } from "../utils/diagnosticDisplay.ts";
import { getReadingWords } from "./diagnosticScoring.ts";

/** Evidence from the actual scorer output, not a second or more lenient score. */
export function createDiagnosticScoreAudit(
  expectedText: string,
  googleFinalTranscript: string,
  metrics: OralReadingMetrics,
  language: DiagnosticLanguage = "en",
) {
  const expectedTokens = getReadingWords(expectedText, language);
  const transcriptTokens = getReadingWords(googleFinalTranscript, language);
  let expectedIndex = 0;
  let transcriptIndex = 0;
  const alignment = metrics.alignment.map(word => ({
    type: word.type,
    expectedWord: word.type === "insertion" ? null : word.expectedWord,
    spokenWord: word.type === "omission" ? null : word.spokenWord,
    expectedIndex: word.type === "insertion" ? null : expectedIndex++,
    transcriptIndex: word.type === "omission" ? null : transcriptIndex++,
  }));
  const mismatches = alignment.filter(word => word.type === "omission" || word.type === "substitution");
  const practiceWords = getDiagnosticPracticeWords(metrics);
  const positions = (tokens: string[], word: string) => tokens.flatMap((token, index) => token === word ? [index] : []);

  return {
    expected: expectedText,
    googleFinalTranscript,
    normalizedExpectedTokens: expectedTokens,
    normalizedTranscriptTokens: transcriptTokens,
    matched: alignment.filter(word => word.type === "match"),
    omissions: alignment.filter(word => word.type === "omission"),
    substitutions: alignment.filter(word => word.type === "substitution"),
    insertions: alignment.filter(word => word.type === "insertion"),
    practiceWords,
    // Presence elsewhere is not proof of an alignment bug: repeated words and
    // reordered phrases need occurrence-level review. Indexes are zero-based.
    practiceEvidence: practiceWords.map(word => ({
      word,
      expectedPositions: positions(expectedTokens, word),
      transcriptPositions: positions(transcriptTokens, word),
      mismatches: mismatches.filter(item => item.expectedWord === word),
      unmatchedTranscriptPositions: alignment.filter(item => item.type !== "match"
        && item.type !== "omission" && item.spokenWord === word).map(item => item.transcriptIndex),
    })),
    wordRecognition: metrics.wordReadingScore,
    miscueBasis: "STT-detected oral reading miscues",
  };
}

export function logDiagnosticScoreAudit(
  expectedText: string,
  googleFinalTranscript: string,
  metrics: OralReadingMetrics,
  language: DiagnosticLanguage = "en",
) {
  if (import.meta.env?.DEV) {
    try {
      console.info("[M2 SCORE AUDIT]", createDiagnosticScoreAudit(expectedText, googleFinalTranscript, metrics, language));
    } catch { /* A developer audit must never interrupt a completed assessment. */ }
  }
}
