// Server copy of the active Module 2 diagnostics: identity, passage text and
// answer keys only (prompts and labels stay in the frontend). Scoring trusts
// this copy, never the browser's. tests/diagnosticTrustedScoring.test.js fails
// if it drifts from readflow/src/modules/module2/data/assessments/*.ts.
const { createHash } = require("node:crypto");

const QUESTION_CHOICES = Object.freeze(["a", "b", "c", "d"]);

function questions(prefix) {
  return Object.freeze(Array.from({ length: 6 }, (_, index) => Object.freeze({
    id: `${prefix}-question-${index + 1}`,
    choiceIds: QUESTION_CHOICES,
    correctChoiceId: "a",
  })));
}

const DIAGNOSTIC_ASSESSMENTS = Object.freeze({
  en: Object.freeze({
    id: "grade5-en-passage-v3",
    version: "3.0",
    language: "en",
    assessmentType: "initial",
    contentStatus: "active",
    // Shown above the story; reading it aloud is optional and never scored (not part of the passage or binding).
    title: "Watering the School Garden",
    paragraphs: Object.freeze([
      "Mia walked to the school garden with her friend Ben.",
      "They hurried to water the tomato plants before the hot afternoon sun could dry the soil and harm the roots.",
      "Although the bucket was heavy and the path was long, Mia and Ben kept working together until every plant had enough water, and they felt proud of their careful teamwork.",
    ]),
    questions: questions("en"),
  }),
  fil: Object.freeze({
    id: "grade5-fil-passage-v3",
    version: "3.0",
    language: "fil",
    assessmentType: "initial",
    contentStatus: "active",
    // Shown above the story; reading it aloud is optional and never scored (not part of the passage or binding).
    title: "Si Lito at ang Mais",
    paragraphs: Object.freeze([
      "Maagang nagtungo si Lito sa bukid kasama ang lola niya.",
      "Magkasama nilang inani ang mga mais at agad inilagay ang mga ito sa basket bago bumuhos ang malakas na ulan.",
      "Kahit basa na ang kanilang damit at madulas ang daan pauwi, maingat na binuhat ni Lito ang mabigat na basket at hindi niya iniwan ang pagod na pagod niyang lola.",
    ]),
    questions: questions("fil"),
  }),
});

function getActiveDiagnosticAssessment(language) {
  return Object.hasOwn(DIAGNOSTIC_ASSESSMENTS, language) ? DIAGNOSTIC_ASSESSMENTS[language] : null;
}

function getDiagnosticPassageText(assessment) {
  return assessment.paragraphs.join(" ");
}

/**
 * The server's identity for "this transcript is a reading of this diagnostic":
 * the active assessment id/version for the language plus a hash of the server's
 * own passage text. Returns null unless the claimed identity is the active one.
 */
function getDiagnosticAssessmentBinding(language, assessmentId, assessmentVersion) {
  const assessment = getActiveDiagnosticAssessment(language);
  if (!assessment || assessment.contentStatus !== "active"
    || assessmentId !== assessment.id || assessmentVersion !== assessment.version) {
    return null;
  }
  return {
    assessmentId: assessment.id,
    assessmentVersion: assessment.version,
    passageHash: createHash("sha256").update(getDiagnosticPassageText(assessment)).digest("hex"),
  };
}

module.exports = {
  DIAGNOSTIC_ASSESSMENTS,
  getActiveDiagnosticAssessment,
  getDiagnosticAssessmentBinding,
  getDiagnosticPassageText,
};
