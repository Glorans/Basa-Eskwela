import type { Difficulty, ReadingLevel } from "../../../data/dashboardData";
import type {
  DiagnosticLanguage,
  DiagnosticQuestion,
  DiagnosticQuestionsRouteState,
  DiagnosticResult,
  OralReadingMetrics,
  ReadingWordAlignment,
} from "../types/diagnostic";

export type DiagnosticAnswers = Record<string, string>;

/**
 * Representation only: NFKC, lowercase, apostrophe variants/removal, punctuation
 * as spaces, and collapsed whitespace. English additionally maps standalone 1
 * to one and the whole token mister to mr. Numeric compounds (1.5, -1, 1/2,
 * 1st, 10) are not expanded. No stemming, phonetics, fuzzy matching, contraction
 * expansion, or passage-dependent corrections. Filipino keeps the base rules.
 */
export function normalizeReadingText(text: string, language: DiagnosticLanguage = "en") {
  let normalized = text
    .normalize("NFKC")
    .replace(/[‘’‛ʼ`´]/g, "'")
    .toLowerCase();
  if (language === "en") {
    normalized = normalized.replace(
      /(^|[\s"'“”([{])1(?=$|[\s"'“”)\]}!?;]|[.,:](?!\p{N}))/gu,
      "$1one",
    );
  }
  normalized = normalized
    .replace(/'/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
  return language === "en"
    ? normalized.split(" ").map(word => word === "mister" ? "mr" : word).join(" ")
    : normalized;
}

export function getReadingWords(text: string, language: DiagnosticLanguage = "en") {
  const normalizedText = normalizeReadingText(text, language);
  return normalizedText ? normalizedText.split(" ") : [];
}

function alignReadingWords(
  expectedWords: string[],
  spokenWords: string[],
): ReadingWordAlignment[] {
  const costs = Array.from({ length: expectedWords.length + 1 }, () =>
    Array<number>(spokenWords.length + 1).fill(0),
  );

  for (
    let expectedIndex = 0;
    expectedIndex <= expectedWords.length;
    expectedIndex += 1
  ) {
    costs[expectedIndex][0] = expectedIndex;
  }

  for (
    let spokenIndex = 0;
    spokenIndex <= spokenWords.length;
    spokenIndex += 1
  ) {
    costs[0][spokenIndex] = spokenIndex;
  }

  for (
    let expectedIndex = 1;
    expectedIndex <= expectedWords.length;
    expectedIndex += 1
  ) {
    for (
      let spokenIndex = 1;
      spokenIndex <= spokenWords.length;
      spokenIndex += 1
    ) {
      const substitutionCost =
        expectedWords[expectedIndex - 1] === spokenWords[spokenIndex - 1] ? 0 : 1;

      costs[expectedIndex][spokenIndex] = Math.min(
        costs[expectedIndex - 1][spokenIndex - 1] + substitutionCost,
        costs[expectedIndex - 1][spokenIndex] + 1,
        costs[expectedIndex][spokenIndex - 1] + 1,
      );
    }
  }

  const alignment: ReadingWordAlignment[] = [];
  let expectedIndex = expectedWords.length;
  let spokenIndex = spokenWords.length;

  while (expectedIndex > 0 || spokenIndex > 0) {
    const expectedWord = expectedWords[expectedIndex - 1];
    const spokenWord = spokenWords[spokenIndex - 1];

    if (
      expectedIndex > 0 &&
      spokenIndex > 0 &&
      expectedWord === spokenWord &&
      costs[expectedIndex][spokenIndex] === costs[expectedIndex - 1][spokenIndex - 1]
    ) {
      alignment.push({ type: "match", expectedWord, spokenWord });
      expectedIndex -= 1;
      spokenIndex -= 1;
      continue;
    }

    if (
      expectedIndex > 0 &&
      spokenIndex > 0 &&
      costs[expectedIndex][spokenIndex] ===
        costs[expectedIndex - 1][spokenIndex - 1] + 1
    ) {
      alignment.push({ type: "substitution", expectedWord, spokenWord });
      expectedIndex -= 1;
      spokenIndex -= 1;
      continue;
    }

    if (
      expectedIndex > 0 &&
      costs[expectedIndex][spokenIndex] === costs[expectedIndex - 1][spokenIndex] + 1
    ) {
      alignment.push({ type: "omission", expectedWord });
      expectedIndex -= 1;
      continue;
    }

    alignment.push({ type: "insertion", spokenWord });
    spokenIndex -= 1;
  }

  return alignment.reverse();
}

const countMiscues = (alignment: ReadingWordAlignment[]) =>
  alignment.filter((word) => word.type !== "match").length;

/**
 * The displayed title is optional to read. Only a transcript that BEGINS with the whole title (normalized) is
 * considered, and that prefix is set aside only when doing so leaves strictly fewer miscues. So the title can only
 * remove its own words: title words elsewhere in the transcript, a partial title, or a passage that itself starts
 * with the title's words are scored exactly as before. Without a title the result is unchanged (M5 passes none).
 * Mirrors server/services/diagnosticScoring.js; tests/diagnosticTrustedScoring.test.js compares both.
 */
function alignWithOptionalTitle(expectedWords: string[], spokenWords: string[], titleWords: string[]) {
  const alignment = alignReadingWords(expectedWords, spokenWords);
  if (!titleWords.length || spokenWords.length <= titleWords.length
    || !titleWords.every((word, index) => spokenWords[index] === word)) {
    return { alignment, titleWordsExcluded: 0 };
  }
  const withoutTitle = alignReadingWords(expectedWords, spokenWords.slice(titleWords.length));
  return countMiscues(withoutTitle) < countMiscues(alignment)
    ? { alignment: withoutTitle, titleWordsExcluded: titleWords.length }
    : { alignment, titleWordsExcluded: 0 };
}

export function calculateOralReadingMetrics(
  expectedText: string,
  transcript: string,
  recordingDurationSeconds?: number,
  language: DiagnosticLanguage = "en",
  title = "",
): OralReadingMetrics {
  // transcript must be Google's completed FINAL output, never visual/interim state.
  const expectedWords = getReadingWords(expectedText, language);
  const titleWords = title ? getReadingWords(title, language) : [];
  const { alignment, titleWordsExcluded } = alignWithOptionalTitle(
    expectedWords, getReadingWords(transcript, language), titleWords,
  );
  const totalExpectedWords = expectedWords.length;
  const correctWords = alignment.filter((word) => word.type === "match").length;
  const substitutions = alignment.filter(
    (word) => word.type === "substitution",
  ).length;
  const omissions = alignment.filter((word) => word.type === "omission").length;
  const insertions = alignment.filter((word) => word.type === "insertion").length;
  // One miscue per token-level omission, substitution, or insertion. Extra
  // repetitions can appear as insertions; transpositions have no dedicated
  // operation and may produce multiple edits. Neither is diagnosed acoustically.
  const detectableMiscues = substitutions + omissions + insertions;
  const wordAccuracy =
    totalExpectedWords > 0 ? (correctWords / totalExpectedWords) * 100 : 0;
  const wordReadingScore =
    totalExpectedWords > 0
      ? Math.min(
          100,
          Math.max(
            0,
            ((totalExpectedWords - detectableMiscues) / totalExpectedWords) * 100,
          ),
        )
      : 0;

  // Every alignment entry except an omission represents a word detected in the
  // normalized transcript. Do not infer completion from the passage length.
  const numberOfWordsRead = alignment.filter(
    (word) => word.type !== "omission",
  ).length;
  const hasValidDuration =
    typeof recordingDurationSeconds === "number" &&
    Number.isFinite(recordingDurationSeconds) &&
    recordingDurationSeconds > 0;

  return {
    alignment,
    totalExpectedWords,
    numberOfWordsRead,
    correctWords,
    substitutions,
    omissions,
    insertions,
    detectableMiscues,
    wordAccuracy,
    wordReadingScore,
    // Only when a title was supplied (M2), so outputs without a title keep their exact shape.
    ...(titleWords.length ? { titleWordsExcluded } : {}),
    ...(hasValidDuration
      ? {
          recordingDurationSeconds,
          readingSpeedWpm: (numberOfWordsRead / recordingDurationSeconds) * 60,
          correctWordsPerMinute:
            (correctWords / recordingDurationSeconds) * 60,
        }
      : {}),
  };
}

// These are STT-detected oral reading miscues, not guaranteed pronunciation
// errors or phoneme-level assessment. Noise, microphone quality, accent variation,
// and recognition errors can cause mismatches. Teacher assessment remains distinct.
//
// Phil-IRI 2018 (Table 4, p. 19) counts mispronunciation, omission,
// substitution, insertion, repetition, transposition and reversal as one miscue
// each, and does NOT count self-corrections or dialectal variation. Speech-to-text
// alignment can only see omissions, substitutions and insertions: repetitions may
// appear as insertions, self-corrections may be counted as insertions, and dialect
// may surface as substitutions. This limitation is shown to learners as "score is
// based on automatic speech detection".

/**
 * Phil-IRI 2018 Table 7 criteria. Classify raw percentages, never rounded
 * display values, so 96.67 (2 miscues in 60 words) is Instructional.
 * Word reading: >= 97 Independent, >= 90 Instructional, < 90 Frustration.
 * Comprehension (6 items, no partial credit): >= 80 Independent (5-6 correct),
 * >= 59 Instructional (4 correct), <= 58 Frustration (0-3 correct).
 */
export const DIAGNOSTIC_READING_LEVEL_THRESHOLDS = {
  wordRecognition: {
    independentMinimum: 97,
    instructionalMinimum: 90,
  },
  comprehension: {
    independentMinimum: 80,
    instructionalMinimum: 59,
  },
} as const;

interface DiagnosticPlacementClassification {
  wordRecognitionLevel: ReadingLevel;
  comprehensionLevel: ReadingLevel;
  overallReadingLevel: ReadingLevel;
}

function classifyByThresholds(
  score: number,
  thresholds: { independentMinimum: number; instructionalMinimum: number },
): ReadingLevel {
  if (score >= thresholds.independentMinimum) return "Independent";
  if (score >= thresholds.instructionalMinimum) return "Instructional";
  return "Frustration";
}

export function classifyWordRecognitionLevel(score: number): ReadingLevel {
  return classifyByThresholds(score, DIAGNOSTIC_READING_LEVEL_THRESHOLDS.wordRecognition);
}

export function classifyComprehensionLevel(score: number): ReadingLevel {
  return classifyByThresholds(score, DIAGNOSTIC_READING_LEVEL_THRESHOLDS.comprehension);
}

type PlacementCombinationRule = Readonly<
  Record<ReadingLevel, Readonly<Record<ReadingLevel, ReadingLevel>>>
>;

/**
 * Word reading (rows) / comprehension (columns): the final level is the LOWER
 * of the two (Frustration < Instructional < Independent). Six cells come from
 * Phil-IRI 2018 Table 8, including Instructional + Independent = Instructional.
 * Table 8 omits Instructional/Instructional, Independent/Frustration and
 * Frustration/Independent; "lower of the two" is ReadFlow's stated assumption
 * for those. WPM is a separate fluency metric and never changes the level.
 */
export const DIAGNOSTIC_PLACEMENT_COMBINATION_RULE = {
  Independent: {
    Independent: "Independent",
    Instructional: "Instructional",
    Frustration: "Frustration",
  },
  Instructional: {
    Independent: "Instructional",
    Instructional: "Instructional",
    Frustration: "Frustration",
  },
  Frustration: {
    Independent: "Frustration",
    Instructional: "Frustration",
    Frustration: "Frustration",
  },
} as const satisfies PlacementCombinationRule;

export function combineDiagnosticReadingLevels(
  wordRecognitionLevel: ReadingLevel,
  comprehensionLevel: ReadingLevel,
): ReadingLevel {
  return DIAGNOSTIC_PLACEMENT_COMBINATION_RULE[wordRecognitionLevel][
    comprehensionLevel
  ];
}

export function classifyDiagnosticPlacement(
  orvScore: number,
  comprehensionScore: number,
): DiagnosticPlacementClassification {
  const wordRecognitionLevel = classifyWordRecognitionLevel(orvScore);
  const comprehensionLevel = classifyComprehensionLevel(comprehensionScore);

  return {
    wordRecognitionLevel,
    comprehensionLevel,
    overallReadingLevel: combineDiagnosticReadingLevels(
      wordRecognitionLevel,
      comprehensionLevel,
    ),
  };
}

/** Compatibility wrapper for callers that only need the final placement. */
export function classifyDiagnosticReadingLevel(
  orvScore: number,
  comprehensionScore: number,
): ReadingLevel {
  return classifyDiagnosticPlacement(orvScore, comprehensionScore)
    .overallReadingLevel;
}

export function calculateComprehensionScore(
  answers: DiagnosticAnswers,
  questions: readonly DiagnosticQuestion[],
) {
  if (questions.length === 0) return undefined;

  const correctAnswers = questions.filter(
    (question) => answers[question.id] === question.correctChoiceId,
  ).length;

  return (correctAnswers / questions.length) * 100;
}

// Frustration -> Easy, Instructional -> Medium, Independent -> Hard.
// Pending adviser confirmation that Independent should map to Hard.
const DIFFICULTY_BY_READING_LEVEL: Readonly<
  Record<ReadingLevel, Difficulty>
> = {
  Frustration: "Easy",
  Instructional: "Medium",
  Independent: "Hard",
};

export function assignDifficultyTier(readingLevel: ReadingLevel): Difficulty {
  return DIFFICULTY_BY_READING_LEVEL[readingLevel];
}

export function createDiagnosticResult(
  answers: DiagnosticAnswers,
  questions: readonly DiagnosticQuestion[],
  assessmentLanguage: DiagnosticLanguage,
  reading?: Partial<DiagnosticQuestionsRouteState>,
): DiagnosticResult {
  const oralReadingMetrics = reading?.oralReadingMetrics;
  const wordReadingScore = oralReadingMetrics?.wordReadingScore;
  const comprehensionScore = calculateComprehensionScore(answers, questions);
  const hasClassifiableScores =
    typeof wordReadingScore === "number" &&
    Number.isFinite(wordReadingScore) &&
    typeof comprehensionScore === "number" &&
    Number.isFinite(comprehensionScore);
  const placement = hasClassifiableScores
    ? classifyDiagnosticPlacement(wordReadingScore, comprehensionScore)
    : undefined;
  const readingLevel = placement?.overallReadingLevel;

  return {
    language: reading?.language ?? assessmentLanguage,
    comprehensionScore,
    orvScore: wordReadingScore,
    readingLevel,
    difficultyTier: readingLevel ? assignDifficultyTier(readingLevel) : undefined,
    readingSpeedWpm: oralReadingMetrics?.readingSpeedWpm,
    transcript: reading?.transcription?.text,
    googleConfidence: reading?.transcription?.confidence,
    oralReadingMetrics,
  };
}

export function hasValidDiagnosticPlacement(result?: DiagnosticResult) {
  return Boolean(
    result?.readingLevel &&
      result.difficultyTier &&
      Number.isFinite(result.orvScore) &&
      Number.isFinite(result.comprehensionScore),
  );
}
