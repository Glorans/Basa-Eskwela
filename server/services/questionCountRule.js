// M3 question-count rule for every generation request (module passages, uploaded materials, Independent Learner
// private sets). Mirrors readflow/src/modules/module3/utils/questionCount.ts. Minimum 6, multiples of 3, split
// equally into literal / inferential / critical. The maximum is the generator's real limit (12): see
// questionGenerationService.validateQuestionCount and m3_passage_bank_sizes() (6, 9, 12).
const QUESTION_COUNT_MIN = 6;
const QUESTION_COUNT_MAX = 12;
const QUESTION_COUNT_STEP = 3;

/** The reason a requested total is refused, or null when it is allowed. Never rounds or adjusts. */
function questionCountProblem(value) {
  if (value === undefined || value === null || value === "") return "Enter the number of questions.";
  if (typeof value !== "number" || !Number.isInteger(value)) return "Enter a whole number of questions, such as 6, 9 or 12.";
  if (value < QUESTION_COUNT_MIN) return "Enter at least 6 questions.";
  if (value % QUESTION_COUNT_STEP !== 0) return "Use a multiple of 3 so the questions divide equally into Literal, Inferential, and Critical.";
  if (value > QUESTION_COUNT_MAX) return "Enter at most 12 questions. That is the most the question generator supports.";
  return null;
}

const ALLOWED_QUESTION_COUNTS = Object.freeze([6, 9, 12]);

module.exports = { QUESTION_COUNT_MIN, QUESTION_COUNT_MAX, QUESTION_COUNT_STEP, ALLOWED_QUESTION_COUNTS, questionCountProblem };
