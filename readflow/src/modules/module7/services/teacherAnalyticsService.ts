
import { getApiUrl } from "../../../lib/apiUrl";
import { supabase } from "../../../lib/supabaseClient";
import { getTeacherOralReadingAttempts } from "../../module5/services/oralReadingService";
import type { TeacherOralReadingAttemptSummary } from "../../module5/types/oralReading";

export interface TeacherAnalyticsSummary {
  totalReadingAttempts: number;
  studentsWithResults: number;
  averagePronunciationAccuracy: number | null;
  averageReadingSpeedWpm: number | null;
  averageComprehensionScore: number | null;
  completedComprehensionAttempts: number;
}

export interface ClassroomCompletionAnalytics {
  roomId: string;
  roomName: string;
  totalAssignments: number;
  completedAssignments: number;
  incompleteAssignments: number;
  completionRate: number | null;
}

export interface StudentClassroomCompletionAnalytics {
  roomId: string;
  roomName: string;
  totalAssignments: number;
  completedAssignments: number;
  incompleteAssignments: number;
  completionRate: number | null;
}

export interface StudentCompletionAnalytics {
  studentId: string;
  totalAssignments: number;
  completedAssignments: number;
  incompleteAssignments: number;
  completionRate: number | null;
  classrooms: StudentClassroomCompletionAnalytics[];
}

export interface TeacherCompletionAnalytics {
  totalClassrooms: number;
  totalAssignments: number;
  completedAssignments: number;
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
  attempts: TeacherOralReadingAttemptSummary[]
): TeacherAnalyticsSummary {
  const uniqueStudents = new Set(
    attempts.map((attempt) => attempt.learnerId)
  );

  const completedComprehension = attempts.filter(
    (attempt) => attempt.comprehension.status === "completed"
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

    averageComprehensionScore: calculateAverage(
      completedComprehension.map(
        (attempt) =>
          attempt.comprehension.status === "completed"
            ? attempt.comprehension.firstAttemptPercentage
            : NaN
      )
    ),

    completedComprehensionAttempts:
      completedComprehension.length,
  };
}

export async function getTeacherAnalytics(): Promise<TeacherAnalyticsSummary> {
  const attempts = await getTeacherOralReadingAttempts();

  return calculateTeacherAnalytics(attempts);
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
