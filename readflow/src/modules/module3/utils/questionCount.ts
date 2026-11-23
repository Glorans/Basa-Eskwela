// M3 question-count rule, shared by every question-generation control (module passages, uploaded materials and the
// Independent Learner's private sets). The server applies the same rule (server/services/questionCountRule.js).
//
// Minimum 6, multiples of 3, equal Literal / Inferential / Critical. The maximum is the generator's real limit:
// questionGenerationService.validateQuestionCount accepts at most 12, and m3_passage_bank_sizes() reports 6, 9, 12.

export const QUESTION_COUNT_MIN = 6;
export const QUESTION_COUNT_MAX = 12;
export const QUESTION_COUNT_STEP = 3;
export const QUESTION_COUNT_INSTRUCTION =
  "Enter at least 6 questions in multiples of 3. Questions will be divided equally into Literal, Inferential, and Critical.";

export interface QuestionCountBreakdown { literal: number; inferential: number; critical: number }

export type QuestionCountCheck =
  | { ok: true; value: number; breakdown: QuestionCountBreakdown }
  | { ok: false; error: string };

/** Every allowed total between the minimum and `max` (6, 9, 12 with the current limit). */
export function allowedQuestionCounts(max = QUESTION_COUNT_MAX): number[] {
  const counts: number[] = [];
  for (let value = QUESTION_COUNT_MIN; value <= max; value += QUESTION_COUNT_STEP) counts.push(value);
  return counts;
}

export function questionBreakdown(total: number): QuestionCountBreakdown {
  const each = total / 3;
  return { literal: each, inferential: each, critical: each };
}

/**
 * Checks a typed value. Never rounds or adjusts: an invalid entry is refused with a plain reason, so the request that
 * is sent is always exactly the number the author typed.
 */
export function checkQuestionCount(raw: string | number, max = QUESTION_COUNT_MAX): QuestionCountCheck {
  const text = typeof raw === "number" ? String(raw) : raw.trim();
  if (!text) return { ok: false, error: "Enter the number of questions." };
  if (!/^\d+$/.test(text)) return { ok: false, error: "Enter a whole number, such as 6, 9 or 12." };
  const value = Number(text);
  if (value < QUESTION_COUNT_MIN) return { ok: false, error: `Enter at least ${QUESTION_COUNT_MIN} questions.` };
  if (value % QUESTION_COUNT_STEP !== 0) {
    return { ok: false, error: "Use a multiple of 3 so the questions divide equally into Literal, Inferential, and Critical." };
  }
  if (value > max) return { ok: false, error: `Enter at most ${max} questions. That is the most the question generator supports.` };
  return { ok: true, value, breakdown: questionBreakdown(value) };
}

export function describeBreakdown(total: number): string {
  const { literal, inferential, critical } = questionBreakdown(total);
  return `${literal} Literal, ${inferential} Inferential, ${critical} Critical`;
}

/** Category counts of a bank (any order). */
export function countByCategory(questions: readonly { type: string }[]): QuestionCountBreakdown {
  return {
    literal: questions.filter((question) => question.type === "literal").length,
    inferential: questions.filter((question) => question.type === "inferential").length,
    critical: questions.filter((question) => question.type === "critical").length,
  };
}

/** A bank is complete only with an allowed total split equally into the three categories. */
export function isBalancedTotal(questions: readonly { type: string }[], max = QUESTION_COUNT_MAX): boolean {
  const total = questions.length;
  const counts = countByCategory(questions);
  return allowedQuestionCounts(max).includes(total)
    && counts.literal === total / 3 && counts.inferential === total / 3 && counts.critical === total / 3;
}
