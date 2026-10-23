import { allTime, filterRecords, type AnalyticsScope } from "./analyticsFilters.ts";

import { getTeacherQuizAttempts } from "./teacherQuizService";
import { countIndependentAssessments } from "./assessmentSource.ts";

export interface StudentQuizScore {
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

export interface StudentQuizScoreSummary {
  studentId: string;
  studentName: string;
  completedQuizzes: number;
  averageScore: number;
  highestScore: number;
  lowestScore: number;
  scores: StudentQuizScore[];
}

export interface QuizScoreResult {
  totalCompletedQuizzes: number;
  independentQuizzes: number;
  studentsWithScores: number;
  averageQuizScore: number | null;
  highestQuizScore: number | null;
  lowestQuizScore: number | null;
  students: StudentQuizScoreSummary[];
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;

  return round(
    values.reduce((sum, value) => sum + value, 0) /
      values.length
  );
}

export async function getQuizScores(loadQuizzes = getTeacherQuizAttempts, scope: AnalyticsScope = allTime): Promise<QuizScoreResult> {
  const scores: StudentQuizScore[] = filterRecords(await loadQuizzes(), scope);

  const scoresByStudent = new Map<
    string,
    StudentQuizScore[]
  >();

  for (const score of scores) {
    const existing =
      scoresByStudent.get(score.studentId) ?? [];

    existing.push(score);
    scoresByStudent.set(score.studentId, existing);
  }

  const students: StudentQuizScoreSummary[] = [
    ...scoresByStudent.entries(),
  ]
    .map(([studentId, studentScores]) => {
      const percentages = studentScores.map(
        (score) => score.scorePercentage
      );

      return {
        studentId,
        studentName: studentScores[0].studentName,
        completedQuizzes: studentScores.length,
        averageScore: average(percentages) ?? 0,
        highestScore: Math.max(...percentages),
        lowestScore: Math.min(...percentages),
        scores: [...studentScores].sort(
          (a, b) =>
            new Date(b.completedAt).getTime() -
            new Date(a.completedAt).getTime()
        ),
      };
    })
    .sort((a, b) =>
      a.studentName.localeCompare(b.studentName)
    );

  const allPercentages = scores.map(
    (score) => score.scorePercentage
  );

  return {
    totalCompletedQuizzes: scores.length,
    independentQuizzes: countIndependentAssessments(scores),
    studentsWithScores: students.length,
    averageQuizScore: average(allPercentages),
    highestQuizScore:
      allPercentages.length > 0
        ? Math.max(...allPercentages)
        : null,
    lowestQuizScore:
      allPercentages.length > 0
        ? Math.min(...allPercentages)
        : null,
    students,
  };
}
