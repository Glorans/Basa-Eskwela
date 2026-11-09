import { allTime, filterRecords, type AnalyticsScope } from "./analyticsFilters.ts";
import { getTeacherQuizAttempts, quizMetrics } from "./teacherQuizService";
import { attributeClassroomAttempts } from "./classroomAttribution";
import { isActiveClassroom } from "./activeClassrooms.ts";

import { supabase } from "../../../lib/supabaseClient";

import {
  getTeacherClassrooms,
  getRoomEnrollments,
} from "../../module4/services/classroomService";

import { getTeacherOralReadingAttempts } from "../../module5/services/oralReadingService";

import {
  getTeacherCompletionAnalytics,
} from "./teacherAnalyticsService";

export interface ClassPerformanceSummary {
  roomId: string;
  roomName: string;
  section: string | null;

  enrolledStudents: number;
  studentsWithResults: number;
  readingAttempts: number;

  averagePronunciationAccuracy: number | null;
  averageReadingSpeedWpm: number | null;
  averageComprehensionScore: number | null;

  totalAssignments: number;
  completedAssignments: number;
  completionRate: number | null;

  attributionLimited: boolean;
}

export interface ClassPerformanceResult {
  classrooms: ClassPerformanceSummary[];
  totalClassrooms: number;
  totalEnrolledStudents: number;
  unattributedReadingAttempts: number;
}

function calculateAverage(
  values: number[]
): number | null {
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

export async function getClassPerformance(loadQuizzes = getTeacherQuizAttempts, loadCompletion = getTeacherCompletionAnalytics, scope: AnalyticsScope = allTime): Promise<ClassPerformanceResult> {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    throw new Error(
      "Please sign in again to view classroom performance."
    );
  }

  // Active classrooms only; attempts and quizzes are attributed to these rooms alone.
  const classrooms = (await getTeacherClassrooms(user.id)).filter(room => isActiveClassroom(room) && (!scope.roomId || room.id === scope.roomId));

  const [
    enrollmentsByClass,
    readingAttempts,
    completionAnalytics,
    quizzes,
  ] = await Promise.all([
    Promise.all(
      classrooms.map((classroom) =>
        getRoomEnrollments(classroom.id)
      )
    ),
    getTeacherOralReadingAttempts(),
    loadCompletion(),
    loadQuizzes(),
  ]);

  const studentClassrooms = new Map<string, Set<string>>();

  classrooms.forEach((classroom, index) => {
    const enrollments = enrollmentsByClass[index];

    enrollments.forEach((student) => {
      const existing =
        studentClassrooms.get(student.student_id) ??
        new Set<string>();

      existing.add(classroom.id);

      studentClassrooms.set(
        student.student_id,
        existing
      );
    });
  });

  const { attemptsByClass, unattributedReadingAttempts } =
    attributeClassroomAttempts(filterRecords(readingAttempts, scope), studentClassrooms);

  const completionByClass = new Map(
    completionAnalytics.classrooms.map((room) => [
      room.roomId,
      room,
    ])
  );

  const summaries: ClassPerformanceSummary[] =
    classrooms.map((classroom, index) => {
      const enrollments = enrollmentsByClass[index];

      const attempts =
        attemptsByClass.get(classroom.id) ?? [];

      const uniqueStudents = new Set(
        attempts.map((attempt) => attempt.learnerId)
      );

      const completion =
        completionByClass.get(classroom.id);

      return {
        roomId: classroom.id,
        roomName: classroom.room_name,
        section: classroom.section,

        enrolledStudents: new Set(enrollments.map(student => student.student_id)).size,
        studentsWithResults: uniqueStudents.size,
        readingAttempts: attempts.length,

        averagePronunciationAccuracy:
          calculateAverage(
            attempts.map(
              (attempt) =>
                attempt.pronunciationAccuracy
            )
          ),

        averageReadingSpeedWpm:
          calculateAverage(
            attempts.map(
              (attempt) =>
                attempt.readingSpeedWpm
            )
          ),

        averageComprehensionScore:
          quizMetrics(filterRecords(quizzes, scope).filter(quiz => quiz.roomId === classroom.id)).averageComprehensionScore,

        totalAssignments:
          completion?.totalAssignments ?? 0,

        completedAssignments:
          completion?.completedAssignments ?? 0,

        completionRate:
          completion?.completionRate ?? null,

        attributionLimited: false,
      };
    });

  return {
    classrooms: summaries,
    totalClassrooms: summaries.length,

    totalEnrolledStudents: new Set(
      enrollmentsByClass.flatMap((students) =>
        students.map((student) => student.student_id)
      )
    ).size,

    unattributedReadingAttempts,
  };
}
