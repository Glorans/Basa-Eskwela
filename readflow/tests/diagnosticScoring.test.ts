import assert from "node:assert/strict";
import test from "node:test";
import {
  assignDifficultyTier,
  calculateComprehensionScore,
  calculateOralReadingMetrics,
  classifyComprehensionLevel,
  classifyDiagnosticPlacement,
  classifyDiagnosticReadingLevel,
  classifyWordRecognitionLevel,
  combineDiagnosticReadingLevels,
  DIAGNOSTIC_PLACEMENT_COMBINATION_RULE,
  DIAGNOSTIC_READING_LEVEL_THRESHOLDS,
  createDiagnosticResult,
  normalizeReadingText,
} from "../src/modules/module2/services/diagnosticScoring.ts";
import type { OralReadingMetrics } from "../src/modules/module2/types/diagnostic.ts";

function alignmentCounts(metrics: OralReadingMetrics) {
  return {
    totalExpectedWords: metrics.totalExpectedWords,
    numberOfWordsRead: metrics.numberOfWordsRead,
    correctWords: metrics.correctWords,
    substitutions: metrics.substitutions,
    omissions: metrics.omissions,
    insertions: metrics.insertions,
    detectableMiscues: metrics.detectableMiscues,
    wordAccuracy: metrics.wordAccuracy,
    wordReadingScore: metrics.wordReadingScore,
  };
}

test("counts an exact reading", () => {
  const metrics = calculateOralReadingMetrics(
    "the quick brown fox",
    "the quick brown fox",
  );

  assert.deepEqual(alignmentCounts(metrics), {
    totalExpectedWords: 4,
    numberOfWordsRead: 4,
    correctWords: 4,
    substitutions: 0,
    omissions: 0,
    insertions: 0,
    detectableMiscues: 0,
    wordAccuracy: 100,
    wordReadingScore: 100,
  });
});

test("aligns a missing word as one omission", () => {
  const metrics = calculateOralReadingMetrics(
    "the quick brown fox",
    "the brown fox",
  );

  assert.deepEqual(alignmentCounts(metrics), {
    totalExpectedWords: 4,
    numberOfWordsRead: 3,
    correctWords: 3,
    substitutions: 0,
    omissions: 1,
    insertions: 0,
    detectableMiscues: 1,
    wordAccuracy: 75,
    wordReadingScore: 75,
  });
  assert.deepEqual(
    metrics.alignment.filter((word) => word.type !== "match"),
    [{ type: "omission", expectedWord: "quick" }],
  );
});

test("aligns a changed word as one substitution", () => {
  const metrics = calculateOralReadingMetrics(
    "the quick brown fox",
    "the quick red fox",
  );

  assert.deepEqual(alignmentCounts(metrics), {
    totalExpectedWords: 4,
    numberOfWordsRead: 4,
    correctWords: 3,
    substitutions: 1,
    omissions: 0,
    insertions: 0,
    detectableMiscues: 1,
    wordAccuracy: 75,
    wordReadingScore: 75,
  });
  assert.deepEqual(
    metrics.alignment.filter((word) => word.type !== "match"),
    [{ type: "substitution", expectedWord: "brown", spokenWord: "red" }],
  );
});

test("aligns an extra word as one insertion", () => {
  const metrics = calculateOralReadingMetrics(
    "the quick brown fox",
    "the very quick brown fox",
  );

  assert.deepEqual(alignmentCounts(metrics), {
    totalExpectedWords: 4,
    numberOfWordsRead: 5,
    correctWords: 4,
    substitutions: 0,
    omissions: 0,
    insertions: 1,
    detectableMiscues: 1,
    wordAccuracy: 100,
    wordReadingScore: 75,
  });
});

test("counts mixed detectable miscues", () => {
  const metrics = calculateOralReadingMetrics(
    "a b c d e f g h i",
    "a x c extra d e f h i",
  );

  assert.deepEqual(alignmentCounts(metrics), {
    totalExpectedWords: 9,
    numberOfWordsRead: 9,
    correctWords: 7,
    substitutions: 1,
    omissions: 1,
    insertions: 1,
    detectableMiscues: 3,
    wordAccuracy: (7 / 9) * 100,
    wordReadingScore: (6 / 9) * 100,
  });
});

test("clamps the automated ORV score to the 0-100 range", () => {
  assert.equal(
    calculateOralReadingMetrics("one word", "many extra inserted words here").wordReadingScore,
    0,
  );
  assert.equal(
    calculateOralReadingMetrics("one word", "one word").wordReadingScore,
    100,
  );
});

test("normalizes capitalization, punctuation, apostrophes, and whitespace", () => {
  assert.equal(
    normalizeReadingText("  Mia smiled. We found it!  "),
    "mia smiled we found it",
  );
  assert.equal(normalizeReadingText("Mia’s kite — IT'S red."), "mias kite its red");
});

test("normalizes and aligns Filipino text without English-only assumptions", () => {
  const filipinoText =
    "Ako, mga kaibigan, ay isang bata na nag-aaral sa paaralan.";

  assert.equal(
    normalizeReadingText(filipinoText),
    "ako mga kaibigan ay isang bata na nag aaral sa paaralan",
  );

  const metrics = calculateOralReadingMetrics(
    filipinoText,
    "Ako mga kaibigan ay isang bata na nag-aaral sa paaralan",
  );

  assert.equal(metrics.correctWords, 11);
  assert.equal(metrics.detectableMiscues, 0);
  assert.equal(metrics.wordReadingScore, 100);
});

test("calculates WPM and correct WPM for a complete reading", () => {
  const eightyWords = Array(80).fill("word").join(" ");
  const metrics = calculateOralReadingMetrics(eightyWords, eightyWords, 120);

  assert.equal(metrics.numberOfWordsRead, 80);
  assert.equal(metrics.readingSpeedWpm, 40);
  assert.equal(metrics.correctWordsPerMinute, 40);
  assert.equal(metrics.recordingDurationSeconds, 120);
});

test("calculates a partial passage from spoken words rather than passage length", () => {
  const expectedText = "one two three four five six seven eight nine ten";
  const metrics = calculateOralReadingMetrics(
    expectedText,
    "one two three",
    12,
  );

  assert.equal(metrics.totalExpectedWords, 10);
  assert.equal(metrics.numberOfWordsRead, 3);
  assert.equal(metrics.correctWords, 3);
  assert.equal(metrics.readingSpeedWpm, 15);
  assert.equal(metrics.correctWordsPerMinute, 15);
});

test("does not use the entire passage to calculate a very short reading", () => {
  const longPassage = Array.from(
    { length: 100 },
    (_, index) => `word${index + 1}`,
  ).join(" ");
  const metrics = calculateOralReadingMetrics(
    longPassage,
    "word1 word2 word3",
    6,
  );

  assert.equal(metrics.totalExpectedWords, 100);
  assert.equal(metrics.numberOfWordsRead, 3);
  assert.equal(metrics.readingSpeedWpm, 30);
  assert.equal(metrics.correctWordsPerMinute, 30);
  assert.notEqual(metrics.readingSpeedWpm, 1000);
});

test("excludes omissions and includes substitutions and insertions in spoken WPM", () => {
  const substitution = calculateOralReadingMetrics(
    "the quick brown fox",
    "the quick red fox",
    60,
  );
  const omission = calculateOralReadingMetrics(
    "the quick brown fox",
    "the brown fox",
    60,
  );
  const insertion = calculateOralReadingMetrics(
    "the quick brown fox",
    "the very quick brown fox",
    60,
  );

  assert.deepEqual(
    {
      words: substitution.numberOfWordsRead,
      wpm: substitution.readingSpeedWpm,
      correctWpm: substitution.correctWordsPerMinute,
    },
    { words: 4, wpm: 4, correctWpm: 3 },
  );
  assert.deepEqual(
    {
      words: omission.numberOfWordsRead,
      wpm: omission.readingSpeedWpm,
      correctWpm: omission.correctWordsPerMinute,
    },
    { words: 3, wpm: 3, correctWpm: 3 },
  );
  assert.deepEqual(
    {
      words: insertion.numberOfWordsRead,
      wpm: insertion.readingSpeedWpm,
      correctWpm: insertion.correctWordsPerMinute,
    },
    { words: 5, wpm: 5, correctWpm: 4 },
  );
});

test("omits rate metrics for zero, negative, and invalid durations", () => {
  for (const duration of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const metrics = calculateOralReadingMetrics(
      "one two",
      "one two",
      duration,
    );

    assert.equal(metrics.readingSpeedWpm, undefined);
    assert.equal(metrics.correctWordsPerMinute, undefined);
    assert.equal(metrics.recordingDurationSeconds, undefined);
  }

  assert.equal(
    calculateOralReadingMetrics("the quick brown fox", "the brown fox", 60)
      .readingSpeedWpm,
    3,
  );
});

test("keeps adopted placement thresholds explicit and named", () => {
  assert.deepEqual(DIAGNOSTIC_READING_LEVEL_THRESHOLDS, {
    wordRecognition: {
      independentMinimum: 97,
      instructionalMinimum: 90,
    },
    comprehension: {
      independentMinimum: 80,
      instructionalMinimum: 59,
    },
  });
});

test("classifies every word-recognition boundary independently", () => {
  const cases = [
    { score: 100, expected: "Independent" },
    { score: 97, expected: "Independent" },
    { score: 96.99, expected: "Instructional" },
    { score: 96.67, expected: "Instructional" },
    { score: 96, expected: "Instructional" },
    { score: 90, expected: "Instructional" },
    { score: 89.99, expected: "Frustration" },
    { score: 89, expected: "Frustration" },
  ] as const;

  for (const { score, expected } of cases) {
    assert.equal(
      classifyWordRecognitionLevel(score),
      expected,
      `${score} word recognition`,
    );
  }
});

test("classifies every comprehension boundary independently", () => {
  const cases = [
    { score: 100, expected: "Independent" },
    { score: 80, expected: "Independent" },
    { score: 79, expected: "Instructional" },
    { score: 59, expected: "Instructional" },
    { score: 58, expected: "Frustration" },
  ] as const;

  for (const { score, expected } of cases) {
    assert.equal(
      classifyComprehensionLevel(score),
      expected,
      `${score} comprehension`,
    );
  }
});

test("final level is the lower of word reading and comprehension (Phil-IRI 2018 Table 8)", () => {
  const order = ["Frustration", "Instructional", "Independent"] as const;
  for (const wordReading of order) {
    for (const comprehension of order) {
      assert.equal(
        combineDiagnosticReadingLevels(wordReading, comprehension),
        order[Math.min(order.indexOf(wordReading), order.indexOf(comprehension))],
        wordReading + " + " + comprehension,
      );
    }
  }
  assert.equal(DIAGNOSTIC_PLACEMENT_COMBINATION_RULE.Instructional.Independent, "Instructional");
});

test("keeps the adopted final-placement combination rule transparent", () => {
  assert.equal(
    DIAGNOSTIC_PLACEMENT_COMBINATION_RULE.Independent.Independent,
    "Independent",
  );
  assert.equal(
    DIAGNOSTIC_PLACEMENT_COMBINATION_RULE.Frustration.Frustration,
    "Frustration",
  );
  assert.equal(
    combineDiagnosticReadingLevels("Independent", "Frustration"),
    "Frustration",
  );
  assert.equal(
    combineDiagnosticReadingLevels("Frustration", "Independent"),
    "Frustration",
  );
});

test("returns separate domain levels and overall placement", () => {
  assert.deepEqual(classifyDiagnosticPlacement(100, 40), {
    wordRecognitionLevel: "Independent",
    comprehensionLevel: "Frustration",
    overallReadingLevel: "Frustration",
  });
  assert.deepEqual(classifyDiagnosticPlacement(50, 100), {
    wordRecognitionLevel: "Frustration",
    comprehensionLevel: "Independent",
    overallReadingLevel: "Frustration",
  });
});

test("applies the adopted final-placement outcomes", () => {
  const cases = [
    { orv: 97, comprehension: 80, expected: "Independent" },
    { orv: 100, comprehension: 100, expected: "Independent" },
    { orv: 96, comprehension: 100, expected: "Instructional" },
    { orv: 96.67, comprehension: 5 / 6 * 100, expected: "Instructional" },
    { orv: 100, comprehension: 79, expected: "Instructional" },
    { orv: 89, comprehension: 80, expected: "Frustration" },
    { orv: 97, comprehension: 58, expected: "Frustration" },
    { orv: 90, comprehension: 59, expected: "Instructional" },
    { orv: 89, comprehension: 58, expected: "Frustration" },
    { orv: 80, comprehension: 40, expected: "Frustration" },
    { orv: 50, comprehension: 100, expected: "Frustration" },
  ] as const;

  for (const { orv, comprehension, expected } of cases) {
    assert.equal(
      classifyDiagnosticReadingLevel(orv, comprehension),
      expected,
      `${orv} ORV + ${comprehension} comprehension`,
    );
  }
});

test("calculates comprehension as correct answers divided by question count", () => {
  const questions = Array.from({ length: 7 }, (_, index) => ({
    id: `question-${index + 1}`,
    prompt: `Question ${index + 1}`,
    choices: [
      { id: "correct", label: "Correct" },
      { id: "incorrect", label: "Incorrect" },
    ],
    correctChoiceId: "correct",
  }));

  for (const correctCount of [0, 1, 2, 3, 4, 5, 6, 7]) {
    const answers = Object.fromEntries(
      questions.map((question, index) => [
        question.id,
        index < correctCount ? "correct" : "incorrect",
      ]),
    );

    assert.equal(
      calculateComprehensionScore(answers, questions),
      (correctCount / questions.length) * 100,
    );
  }
});

test("maps reading profiles to ReadFlow difficulty tiers", () => {
  assert.equal(assignDifficultyTier("Frustration"), "Easy");
  assert.equal(assignDifficultyTier("Instructional"), "Medium");
  assert.equal(assignDifficultyTier("Independent"), "Hard");
});

test("carries oral metrics and transcription into the diagnostic result", () => {
  const oralReadingMetrics = calculateOralReadingMetrics(
    "the quick brown fox",
    "the quick brown fox",
    60,
  );
  const result = createDiagnosticResult(
    { question: "correct" },
    [
      {
        id: "question",
        prompt: "Test question",
        choices: [{ id: "correct", label: "Correct" }],
        correctChoiceId: "correct",
      },
    ],
    "en",
    {
      language: "en",
      transcription: { text: "the quick brown fox", confidence: 0.92 },
      oralReadingMetrics,
    },
  );

  assert.equal(result.language, "en");
  assert.equal(result.comprehensionScore, 100);
  assert.equal(result.orvScore, 100);
  assert.equal(result.readingSpeedWpm, 4);
  assert.equal(result.transcript, "the quick brown fox");
  assert.equal(result.googleConfidence, 0.92);
  assert.equal(result.oralReadingMetrics, oralReadingMetrics);
  assert.equal(result.readingLevel, "Independent");
  assert.equal(result.difficultyTier, "Hard");
  assert.equal("orv_score" in result, false);
  assert.equal("comprehension_score" in result, false);
  assert.equal("reading_level" in result, false);
  assert.equal("difficulty_tier" in result, false);
});

test("creates a Frustration result when comprehension is Frustration", () => {
  const oralReadingMetrics = calculateOralReadingMetrics(
    "the quick brown fox",
    "the quick brown fox",
  );
  const result = createDiagnosticResult(
    { question: "incorrect" },
    [
      {
        id: "question",
        prompt: "Test question",
        choices: [
          { id: "correct", label: "Correct" },
          { id: "incorrect", label: "Incorrect" },
        ],
        correctChoiceId: "correct",
      },
    ],
    "en",
    { oralReadingMetrics },
  );

  assert.equal(result.orvScore, 100);
  assert.equal(result.comprehensionScore, 0);
  assert.equal(result.readingLevel, "Frustration");
  assert.equal(result.difficultyTier, "Easy");
});


test("classifies decimal scores before display rounding", () => {
  assert.equal(classifyWordRecognitionLevel(89.999), "Frustration");
  assert.equal(classifyComprehensionLevel(58.999), "Frustration");
  for (const score of [96.9, 90]) assert.equal(classifyWordRecognitionLevel(score), "Instructional");
  for (const score of [79.9, 59]) assert.equal(classifyComprehensionLevel(score), "Instructional");
});

test("each insertion, omission, and substitution costs exactly one WR miscue", () => {
  for (const [spoken, kind] of [["a frog sat", "omissions"], ["a duck sat still", "substitutions"], ["a green frog sat still", "insertions"]] as const) {
    const metrics = calculateOralReadingMetrics("a frog sat still", spoken);
    assert.equal(metrics[kind], 1);
    assert.equal(metrics.detectableMiscues, 1);
    assert.equal(metrics.wordReadingScore, 75);
  }
});

test("repetition and transposition remain token edits without separate acoustic diagnoses", () => {
  const repeated = calculateOralReadingMetrics("frog sat still", "frog frog sat still");
  assert.equal(repeated.insertions, 1);
  assert.equal(repeated.detectableMiscues, 1);
  const swapped = calculateOralReadingMetrics("frog sat still", "sat frog still");
  assert.equal(swapped.substitutions, 2);
  assert.equal(swapped.detectableMiscues, 2);
});

test("partial transcript WPM stays separate from placement at every duration", () => {
  const questions = [{ id: "q", prompt: "Test", choices: [{ id: "yes", label: "Yes" }], correctChoiceId: "yes" }];
  for (const duration of [10, 60, 120]) {
    const metrics = calculateOralReadingMetrics("one day a frog sat", "one day", duration);
    assert.equal(metrics.numberOfWordsRead, 2);
    assert.equal(metrics.readingSpeedWpm, 2 / duration * 60);
    const result = createDiagnosticResult({ q: "yes" }, questions, "en", { oralReadingMetrics: metrics });
    assert.equal(result.orvScore, 40);
    assert.equal(result.comprehensionScore, 100);
    assert.equal(result.readingLevel, "Frustration");
  }
});
