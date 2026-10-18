import type { DiagnosticResult, OralReadingMetrics } from "../types/diagnostic";

/** The same final-alignment selection is used by the result UI and score audit. */
export function getDiagnosticPracticeWords(metrics?: OralReadingMetrics) {
  const uniqueWords = new Set<string>();
  for (const word of metrics?.alignment ?? []) {
    if (word.type === "substitution" || word.type === "omission") {
      uniqueWords.add(word.expectedWord);
    }
    if (uniqueWords.size === 8) break;
  }
  return [...uniqueWords];
}

export type DiagnosticPlacementStatus = "loading" | "ready" | "empty" | "error";

export function getDiagnosticPlacementDisplay(
  status: DiagnosticPlacementStatus,
  result?: Pick<DiagnosticResult, "readingLevel" | "difficultyTier">,
) {
  if (status === "loading") {
    return { readingLevel: "Loading...", difficultyTier: "Loading..." };
  }

  if (status === "error") {
    return { readingLevel: "Unavailable", difficultyTier: "Unavailable" };
  }

  if (
    status !== "ready"
    || !result?.readingLevel
    || !result.difficultyTier
  ) {
    return {
      readingLevel: "Not assessed yet",
      difficultyTier: "Not assessed yet",
    };
  }

  return {
    readingLevel: result.readingLevel,
    difficultyTier: result.difficultyTier,
  };
}
