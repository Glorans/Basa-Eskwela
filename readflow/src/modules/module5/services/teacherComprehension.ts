import type {
  ComprehensionQuestionType,
  TeacherComprehensionDetail,
  TeacherComprehensionQuestionReview,
  TeacherComprehensionScore,
  TeacherComprehensionStatus,
  TeacherComprehensionSummary,
  TeacherComprehensionTypeSummary,
} from "../types/oralReading.ts";

const QUESTION_TYPES: readonly ComprehensionQuestionType[] = ["literal", "inferential", "critical"];
const UNAVAILABLE = { status: "unavailable" } as const;

export const TEACHER_COMPREHENSION_STATUS_LABELS: Record<TeacherComprehensionStatus, string> = {
  completed: "Completed",
  in_progress: "In progress",
  not_started: "Not started",
  not_applicable: "Read-aloud only",
  unavailable: "Unavailable",
};

export const TEACHER_COMPREHENSION_BADGE_CLASS: Record<TeacherComprehensionStatus, string> = {
  completed: "m3-status-badge--completed",
  in_progress: "m3-status-badge--processing",
  not_started: "m3-status-badge--pending",
  not_applicable: "",
  unavailable: "m3-status-badge--failed",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isOptionIndex(value: unknown): value is number {
  return isCount(value) && value <= 3;
}

function parseScore(value: Record<string, unknown>): TeacherComprehensionScore | null {
  const { firstCorrect, totalQuestions, firstAttemptPercentage, hintsUsed, completedAt } = value;
  if (!isCount(firstCorrect) || !isCount(totalQuestions) || !isCount(hintsUsed)
    || typeof firstAttemptPercentage !== "number" || !Number.isFinite(firstAttemptPercentage)
    || firstCorrect > totalQuestions) return null;
  return {
    firstCorrect,
    totalQuestions,
    firstAttemptPercentage,
    hintsUsed,
    completedAt: typeof completedAt === "string" ? completedAt : null,
  };
}

export function parseTeacherComprehensionSummary(value: unknown): TeacherComprehensionSummary {
  if (!isRecord(value)) return UNAVAILABLE;
  const { status } = value;
  if (status === "not_started" || status === "not_applicable" || status === "unavailable") return { status };
  if (status !== "completed" && status !== "in_progress") return UNAVAILABLE;
  const score = parseScore(value);
  return score ? { status, ...score } : UNAVAILABLE;
}

function parseTypeSummary(value: unknown): TeacherComprehensionTypeSummary | null {
  if (!isRecord(value)) return null;
  const { total, answered, firstCorrect, resolved, hintsUsed, firstAttemptPercentage } = value;
  if (![total, answered, firstCorrect, resolved, hintsUsed].every(isCount)
    || typeof firstAttemptPercentage !== "number") return null;
  return {
    total: total as number,
    answered: answered as number,
    firstCorrect: firstCorrect as number,
    resolved: resolved as number,
    hintsUsed: hintsUsed as number,
    firstAttemptPercentage,
  };
}

function parseQuestion(value: unknown): TeacherComprehensionQuestionReview | null {
  if (!isRecord(value)) return null;
  const { order, type, prompt, options, studentFirstAnswerIndex, correctIndex,
    firstAnswerCorrect, hintUsed, resolved, secondAnswerIndex } = value;
  if (!isCount(order) || !QUESTION_TYPES.includes(type as ComprehensionQuestionType)
    || typeof prompt !== "string" || !Array.isArray(options) || options.length !== 4
    || !options.every((option) => typeof option === "string")
    || !(studentFirstAnswerIndex === null || isOptionIndex(studentFirstAnswerIndex))
    || !isOptionIndex(correctIndex)
    || !(firstAnswerCorrect === null || typeof firstAnswerCorrect === "boolean")
    || typeof hintUsed !== "boolean" || typeof resolved !== "boolean"
    || !(secondAnswerIndex === undefined || isOptionIndex(secondAnswerIndex))) return null;
  return {
    order,
    type: type as ComprehensionQuestionType,
    prompt,
    options: options as string[],
    studentFirstAnswerIndex,
    correctIndex,
    firstAnswerCorrect,
    hintUsed,
    resolved,
    ...(secondAnswerIndex === undefined ? {} : { secondAnswerIndex }),
  };
}

export function parseTeacherComprehensionDetail(value: unknown): TeacherComprehensionDetail {
  const summary = parseTeacherComprehensionSummary(value);
  if (!("firstCorrect" in summary)) return summary;
  if (!isRecord(value) || !isRecord(value.byType) || !Array.isArray(value.questions)) return UNAVAILABLE;
  const byType = value.byType;
  const types = QUESTION_TYPES.map((type) => [type, parseTypeSummary(byType[type])] as const);
  const questions = value.questions.map(parseQuestion);
  if (types.some(([, group]) => !group) || questions.some((question) => !question)) return UNAVAILABLE;
  return {
    ...summary,
    byType: Object.fromEntries(types) as Record<ComprehensionQuestionType, TeacherComprehensionTypeSummary>,
    questions: questions as TeacherComprehensionQuestionReview[],
  };
}
