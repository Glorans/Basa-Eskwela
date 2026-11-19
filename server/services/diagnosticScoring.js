// Server port of readflow/src/modules/module2/services/diagnosticScoring.ts.
// The rubric, normalization and thresholds must stay identical to the browser
// version; tests/diagnosticTrustedScoring.test.js runs both on the same inputs.

/**
 * Representation only: NFKC, lowercase, apostrophe variants/removal, punctuation
 * as spaces, and collapsed whitespace. English additionally maps standalone 1
 * to one and the whole token mister to mr. Filipino keeps the base rules.
 */
function normalizeReadingText(text, language = "en") {
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
    ? normalized.split(" ").map((word) => word === "mister" ? "mr" : word).join(" ")
    : normalized;
}

function getReadingWords(text, language = "en") {
  const normalizedText = normalizeReadingText(text, language);
  return normalizedText ? normalizedText.split(" ") : [];
}

function alignReadingWords(expectedWords, spokenWords) {
  const costs = Array.from({ length: expectedWords.length + 1 }, () =>
    Array(spokenWords.length + 1).fill(0));

  for (let expectedIndex = 0; expectedIndex <= expectedWords.length; expectedIndex += 1) {
    costs[expectedIndex][0] = expectedIndex;
  }
  for (let spokenIndex = 0; spokenIndex <= spokenWords.length; spokenIndex += 1) {
    costs[0][spokenIndex] = spokenIndex;
  }
  for (let expectedIndex = 1; expectedIndex <= expectedWords.length; expectedIndex += 1) {
    for (let spokenIndex = 1; spokenIndex <= spokenWords.length; spokenIndex += 1) {
      const substitutionCost =
        expectedWords[expectedIndex - 1] === spokenWords[spokenIndex - 1] ? 0 : 1;
      costs[expectedIndex][spokenIndex] = Math.min(
        costs[expectedIndex - 1][spokenIndex - 1] + substitutionCost,
        costs[expectedIndex - 1][spokenIndex] + 1,
        costs[expectedIndex][spokenIndex - 1] + 1,
      );
    }
  }

  const alignment = [];
  let expectedIndex = expectedWords.length;
  let spokenIndex = spokenWords.length;

  while (expectedIndex > 0 || spokenIndex > 0) {
    const expectedWord = expectedWords[expectedIndex - 1];
    const spokenWord = spokenWords[spokenIndex - 1];

    if (expectedIndex > 0 && spokenIndex > 0 && expectedWord === spokenWord
      && costs[expectedIndex][spokenIndex] === costs[expectedIndex - 1][spokenIndex - 1]) {
      alignment.push({ type: "match", expectedWord, spokenWord });
      expectedIndex -= 1;
      spokenIndex -= 1;
      continue;
    }
    if (expectedIndex > 0 && spokenIndex > 0
      && costs[expectedIndex][spokenIndex] === costs[expectedIndex - 1][spokenIndex - 1] + 1) {
      alignment.push({ type: "substitution", expectedWord, spokenWord });
      expectedIndex -= 1;
      spokenIndex -= 1;
      continue;
    }
    if (expectedIndex > 0
      && costs[expectedIndex][spokenIndex] === costs[expectedIndex - 1][spokenIndex] + 1) {
      alignment.push({ type: "omission", expectedWord });
      expectedIndex -= 1;
      continue;
    }
    alignment.push({ type: "insertion", spokenWord });
    spokenIndex -= 1;
  }

  return alignment.reverse();
}

const countMiscues = (alignment) => alignment.filter((word) => word.type !== "match").length;

// Saved with every new verified M2 result (oral_reading_metrics.scoringRule). Version 3.0 results saved before this
// rule have no marker and scored a spoken title as insertions; the assessment version itself is unchanged.
const DIAGNOSTIC_SCORING_RULE = "title-optional-v1";

/**
 * The displayed title is optional to read. Only a transcript that BEGINS with the whole title (normalized) is
 * considered, and that prefix is set aside only when doing so leaves strictly fewer miscues. So the title can only
 * remove its own words: title words elsewhere in the transcript, a partial title, or a passage that itself starts
 * with the title's words are scored exactly as before. Without a title the result is unchanged (M5 passes none).
 */
function alignWithOptionalTitle(expectedWords, spokenWords, titleWords) {
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

function calculateOralReadingMetrics(expectedText, transcript, recordingDurationSeconds, language = "en", title = "") {
  const expectedWords = getReadingWords(expectedText, language);
  const titleWords = title ? getReadingWords(title, language) : [];
  const { alignment, titleWordsExcluded } = alignWithOptionalTitle(expectedWords, getReadingWords(transcript, language), titleWords);
  const totalExpectedWords = expectedWords.length;
  const correctWords = alignment.filter((word) => word.type === "match").length;
  const substitutions = alignment.filter((word) => word.type === "substitution").length;
  const omissions = alignment.filter((word) => word.type === "omission").length;
  const insertions = alignment.filter((word) => word.type === "insertion").length;
  const detectableMiscues = substitutions + omissions + insertions;
  const wordAccuracy = totalExpectedWords > 0 ? (correctWords / totalExpectedWords) * 100 : 0;
  const wordReadingScore = totalExpectedWords > 0
    ? Math.min(100, Math.max(0, ((totalExpectedWords - detectableMiscues) / totalExpectedWords) * 100))
    : 0;
  const numberOfWordsRead = alignment.filter((word) => word.type !== "omission").length;
  const hasValidDuration = typeof recordingDurationSeconds === "number"
    && Number.isFinite(recordingDurationSeconds) && recordingDurationSeconds > 0;

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
          correctWordsPerMinute: (correctWords / recordingDurationSeconds) * 60,
        }
      : {}),
  };
}

/** Phil-IRI 2018 Table 7 criteria, classified on raw (unrounded) percentages. */
const DIAGNOSTIC_READING_LEVEL_THRESHOLDS = Object.freeze({
  wordRecognition: Object.freeze({ independentMinimum: 97, instructionalMinimum: 90 }),
  comprehension: Object.freeze({ independentMinimum: 80, instructionalMinimum: 59 }),
});

function classifyByThresholds(score, thresholds) {
  if (score >= thresholds.independentMinimum) return "Independent";
  if (score >= thresholds.instructionalMinimum) return "Instructional";
  return "Frustration";
}

// Final level is the LOWER of word reading and comprehension (Phil-IRI 2018
// Table 8 plus ReadFlow's stated assumption for the cells Table 8 omits).
const LEVEL_RANK = Object.freeze({ Frustration: 0, Instructional: 1, Independent: 2 });

function classifyDiagnosticPlacement(orvScore, comprehensionScore) {
  const wordRecognitionLevel = classifyByThresholds(orvScore, DIAGNOSTIC_READING_LEVEL_THRESHOLDS.wordRecognition);
  const comprehensionLevel = classifyByThresholds(comprehensionScore, DIAGNOSTIC_READING_LEVEL_THRESHOLDS.comprehension);
  return {
    wordRecognitionLevel,
    comprehensionLevel,
    overallReadingLevel: LEVEL_RANK[wordRecognitionLevel] <= LEVEL_RANK[comprehensionLevel]
      ? wordRecognitionLevel : comprehensionLevel,
  };
}

function calculateComprehensionScore(answers, questions) {
  if (questions.length === 0) return undefined;
  const correctAnswers = questions.filter((question) => answers[question.id] === question.correctChoiceId).length;
  return (correctAnswers / questions.length) * 100;
}

// Frustration -> Easy, Instructional -> Medium, Independent -> Hard.
const DIFFICULTY_BY_READING_LEVEL = Object.freeze({
  Frustration: "Easy",
  Instructional: "Medium",
  Independent: "Hard",
});

function assignDifficultyTier(readingLevel) {
  return DIFFICULTY_BY_READING_LEVEL[readingLevel];
}

/**
 * Scores one whole-passage diagnostic from a server-verified transcript and the
 * learner's answers. Throws on unanswered or unknown answers. Duration only
 * affects WPM; it never changes the reading level.
 */
function scoreDiagnostic({ assessment, passageText, transcript, recordingDurationSeconds, answers }) {
  for (const question of assessment.questions) {
    if (!question.choiceIds.includes(answers?.[question.id])) {
      throw new Error("Every diagnostic question needs one valid answer.");
    }
  }
  const comprehensionAnswers = Object.fromEntries(assessment.questions.map((question) => [question.id, answers[question.id]]));
  const oralReadingMetrics = calculateOralReadingMetrics(passageText, transcript, recordingDurationSeconds, assessment.language, assessment.title);
  const orvScore = oralReadingMetrics.wordReadingScore;
  const comprehensionScore = calculateComprehensionScore(comprehensionAnswers, assessment.questions);
  const readingLevel = classifyDiagnosticPlacement(orvScore, comprehensionScore).overallReadingLevel;

  return {
    orvScore,
    comprehensionScore,
    readingLevel,
    difficultyTier: assignDifficultyTier(readingLevel),
    readingSpeedWpm: oralReadingMetrics.readingSpeedWpm,
    oralReadingMetrics,
    comprehensionAnswers,
  };
}

module.exports = {
  DIAGNOSTIC_READING_LEVEL_THRESHOLDS,
  DIAGNOSTIC_SCORING_RULE,
  assignDifficultyTier,
  calculateComprehensionScore,
  calculateOralReadingMetrics,
  classifyDiagnosticPlacement,
  getReadingWords,
  normalizeReadingText,
  scoreDiagnostic,
};
