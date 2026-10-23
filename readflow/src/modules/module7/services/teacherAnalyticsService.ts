import { allTime, filterRecords, type AnalyticsScope } from "./analyticsFilters.ts";
import { getTeacherQuizAttempts, quizMetrics, type TeacherQuizAttempt } from "./teacherQuizService";
import { countIndependentAssessments } from "./assessmentSource.ts";

import { supabase } from "../../../lib/supabaseClient";
import { getApiUrl } from "../../../lib/apiUrl";
import { getTeacherOralReadingAttempts } from "../../module5/services/oralReadingService";
import type { TeacherOralReadingAttemptSummary } from "../../module5/types/oralReading";

export interface TeacherAnalyticsSummary {
  totalReadingAttempts: number;
  studentsWithResults: number;
  averagePronunciationAccuracy: number | null;
  averageReadingSpeedWpm: number | null;
  averageComprehensionScore: number | null;
  completedComprehensionAttempts: number;
  independentComprehensionAttempts: number;
}

export interface ClassroomCompletionAnalytics {
  roomId: string;
  roomName: string;
  totalAssignments: number;
  completedAssignments: number;
  inProgressAssignments: number;
  notStartedAssignments: number;
  incompleteAssignments: number;
  completionRate: number | null;
}

export interface StudentClassroomCompletionAnalytics {
  roomId: string;
  roomName: string;
  totalAssignments: number;
  completedAssignments: number;
  inProgressAssignments: number;
  notStartedAssignments: number;
  incompleteAssignments: number;
  completionRate: number | null;
}

export interface StudentCompletionAnalytics {
  studentId: string;
  totalAssignments: number;
  completedAssignments: number;
  inProgressAssignments: number;
  notStartedAssignments: number;
  incompleteAssignments: number;
  completionRate: number | null;
  classrooms: StudentClassroomCompletionAnalytics[];
}

export interface TeacherCompletionAnalytics {
  totalClassrooms: number;
  totalAssignments: number;
  completedAssignments: number;
  inProgressAssignments: number;
  notStartedAssignments: number;
  incompleteAssignments: number;
  completionRate: number | null;
  classrooms: ClassroomCompletionAnalytics[];
  students: StudentCompletionAnalytics[];
}

function calculateAverage(values: number[]): number | null {
  const validValues = values.filter(Number.isFinite);

  if (validValues.length === 0) {
    return null;
  }

  const total = validValues.reduce(
    (sum, value) => sum + value,
    0
  );

  return Math.round(
    (total / validValues.length) * 100
  ) / 100;
}

export function calculateTeacherAnalytics(
  attempts: TeacherOralReadingAttemptSummary[],
  quizzes: TeacherQuizAttempt[]
): TeacherAnalyticsSummary {
  const uniqueStudents = new Set(
    attempts.map((attempt) => attempt.learnerId)
  );

  return {
    totalReadingAttempts: attempts.length,

    studentsWithResults: uniqueStudents.size,

    averagePronunciationAccuracy: calculateAverage(
      attempts.map(
        (attempt) => attempt.pronunciationAccuracy
      )
    ),

    averageReadingSpeedWpm: calculateAverage(
      attempts.map(
        (attempt) => attempt.readingSpeedWpm
      )
    ),

    ...quizMetrics(quizzes),
    independentComprehensionAttempts: countIndependentAssessments(quizzes),
  };
}

export async function getTeacherAnalytics(loadQuizzes = getTeacherQuizAttempts, scope: AnalyticsScope = allTime): Promise<TeacherAnalyticsSummary> {
  const [attempts, quizzes] = await Promise.all([getTeacherOralReadingAttempts(), loadQuizzes()]);

  return calculateTeacherAnalytics(filterRecords(attempts, scope), filterRecords(quizzes, scope));
}

export async function getTeacherCompletionAnalytics(): Promise<TeacherCompletionAnalytics> {
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();

  if (sessionError || !session?.access_token) {
    throw new Error(
      "Please sign in again to view completion analytics."
    );
  }

  const response = await fetch(
    `${getApiUrl().replace(/\/+$/, "")}/api/oral-reading/teacher/completion-analytics`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    }
  );

  const result = await response.json();

  if (!response.ok || !result.success) {
    throw new Error(
      result.message ||
        "Unable to load classroom completion analytics."
    );
  }

  return result.analytics as TeacherCompletionAnalytics;
}
