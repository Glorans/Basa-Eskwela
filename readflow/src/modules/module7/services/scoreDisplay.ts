export const EVALUATION_UNAVAILABLE = 'Evaluation unavailable';
export const INVALID_EVIDENCE = 'Invalid assessment evidence';

export function isValidScore(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
}

export function formatScore(value: unknown, digits?: number): string {
  return isValidScore(value) ? `${digits === undefined ? value : value.toFixed(digits)}%` : EVALUATION_UNAVAILABLE;
}

export function validAnswerCounts(correct: unknown, total: unknown): boolean {
  return typeof correct === 'number' && Number.isInteger(correct) && correct >= 0
    && typeof total === 'number' && Number.isInteger(total) && total > 0 && correct <= total;
}

export function formatAnswerCounts(correct: unknown, total: unknown): string {
  return validAnswerCounts(correct, total) ? `${correct}/${total}` : EVALUATION_UNAVAILABLE;
}

export function formatQuizScore(quiz: { score?: unknown; firstCorrect?: unknown; totalQuestions?: unknown; dataQuality?: unknown }): string {
  if (quiz.dataQuality) return INVALID_EVIDENCE;
  if (!isValidScore(quiz.score) || !validAnswerCounts(quiz.firstCorrect, quiz.totalQuestions)) return EVALUATION_UNAVAILABLE;
  return `${formatAnswerCounts(quiz.firstCorrect, quiz.totalQuestions)} (${formatScore(quiz.score)})`;
}

export function formatComprehension(data: { comprehensionScore?: unknown; completedQuizzes?: number; invalidCompletedQuizzes?: number }): string {
  if ((data.invalidCompletedQuizzes ?? 0) > 0) return INVALID_EVIDENCE;
  if (data.comprehensionScore == null && data.completedQuizzes === 0) return 'No data';
  return formatScore(data.comprehensionScore);
}

export function formatCount(value: unknown): string {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? String(value) : EVALUATION_UNAVAILABLE;
}
