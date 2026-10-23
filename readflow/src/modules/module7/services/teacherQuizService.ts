import { isValidScore, validAnswerCounts } from './scoreDisplay';
import { m7Request } from './m7Service';

export interface TeacherQuizAttempt {
  attemptId: string;
  studentId: string;
  studentName: string;
  roomId: string | null;
  moduleTitle: string;
  completedAt: string;
  correctAnswers: number;
  totalQuestions: number;
  scorePercentage: number;
  hintsUsed: number;
}

export async function getTeacherQuizAttempts(): Promise<TeacherQuizAttempt[]> {
  const quizzes = await m7Request<TeacherQuizAttempt[]>('/teacher/quizzes');
  // Keep the endpoint's fail-closed contract if a malformed payload reaches us.
  if (!Array.isArray(quizzes) || quizzes.some(quiz => !quiz
    || !isValidScore(quiz.scorePercentage) || !validAnswerCounts(quiz.correctAnswers, quiz.totalQuestions))) {
    throw new Error('Invalid assessment evidence. Teacher quiz analytics are unavailable.');
  }
  return quizzes;
}

export function quizMetrics(quizzes: TeacherQuizAttempt[]) {
  return {
    completedComprehensionAttempts: quizzes.length,
    averageComprehensionScore: quizzes.length
      ? Math.round(quizzes.reduce((sum, quiz) => sum + quiz.scorePercentage, 0) / quizzes.length * 100) / 100
      : null,
  };
}
