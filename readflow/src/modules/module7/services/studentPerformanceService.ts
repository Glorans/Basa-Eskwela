import { allTime, filterRecords, type AnalyticsScope } from "./analyticsFilters.ts";
import { getTeacherQuizAttempts, quizMetrics } from "./teacherQuizService";

import { supabase } from "../../../lib/supabaseClient";

import {
  getTeacherClassrooms,
  getRoomEnrollments,
} from "../../module4/services/classroomService";

import { getTeacherOralReadingAttempts } from "../../module5/services/oralReadingService";

import type { TeacherOralReadingAttemptSummary } from "../../module5/types/oralReading";

import {
  getTeacherCompletionAnalytics,
} from "./teacherAnalyticsService";

export interface StudentClassroomPerformance {
  roomId: string;
  roomName: string;
  section: string | null;

  totalAssignments: number;
  completedAssignments: number;
  inProgressAssignments: number;
  completionRate: number | null;

  incompleteAssignments: number;
  notStartedAssignments: number;
}

export interface StudentPerformanceSummary {
  studentId: string;
  studentName: string;

  classrooms: StudentClassroomPerformance[];

  totalAssignments: number;
  completedAssignments: number;
  inProgressAssignments: number;
  completionRate: number | null;

  incompleteAssignments: number;
  notStartedAssignments: number;

  readingAttempts: number;
  averagePronunciationAccuracy: number | null;
  averageReadingSpeedWpm: number | null;
  averageComprehensionScore: number | null;
  completedComprehensionAttempts: number;
}

export interface StudentPerformanceResult {
  totalStudents: number;
  students: StudentPerformanceSummary[];
}

function average(values: number[]): number | null {
  const valid = values.filter(Number.isFinite);

  if (valid.length === 0) return null;

  const total = valid.reduce(
    (sum, value) => sum + value,
    0
  );

  return Math.round((total / valid.length) * 100) / 100;
}

function calculateCompletionRate(
  total: number,
  completed: number
): number | null {
  if (total === 0) return null;

  return Math.round((completed / total) * 10000) / 100;
}

function calculateReadingMetrics(
  attempts: TeacherOralReadingAttemptSummary[]
) {
  return {
    readingAttempts: attempts.length,

    averagePronunciationAccuracy: average(
      attempts.map(
        (attempt) => attempt.pronunciationAccuracy
      )
    ),

    averageReadingSpeedWpm: average(
      attempts.map(
        (attempt) => attempt.readingSpeedWpm
      )
    ),
  };
}

export async function getStudentPerformance(loadQuizzes = getTeacherQuizAttempts, loadCompletion = getTeacherCompletionAnalytics, scope: AnalyticsScope = allTime): Promise<StudentPerformanceResult> {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    throw new Error(
      "Please sign in again to view student performance."
    );
  }

  const classrooms = (await getTeacherClassrooms(user.id)).filter(room => !scope.roomId || room.id === scope.roomId);

  const [
    enrollmentsByRoom,
    attempts,
    verifiedCompletion,
    quizzes,
  ] = await Promise.all([
    Promise.all(
      classrooms.map((room) =>
        getRoomEnrollments(room.id)
      )
    ),
    getTeacherOralReadingAttempts(),
    loadCompletion(),
    loadQuizzes(),
  ]);

  const verifiedStudents = new Map(
    verifiedCompletion.students.map(
      (student) => [student.studentId, student] as const
    )
  );

  const studentMap = new Map<
    string,
    StudentPerformanceSummary
  >();

  classrooms.forEach((room, index) => {
    const enrollments = [...new Map(enrollmentsByRoom[index].map(student => [student.student_id, student])).values()];

    enrollments.forEach((student) => {
      let summary = studentMap.get(student.student_id);

      if (!summary) {
        summary = {
          studentId: student.student_id,
          studentName: student.display_name,

          classrooms: [],

          totalAssignments: 0,
          completedAssignments: 0,
          inProgressAssignments: 0,
          completionRate: null,

          incompleteAssignments: 0,
          notStartedAssignments: 0,

          readingAttempts: 0,
          averagePronunciationAccuracy: null,
          averageReadingSpeedWpm: null,
          averageComprehensionScore: null,
          completedComprehensionAttempts: 0,
        };

        studentMap.set(student.student_id, summary);
      }

      const verifiedStudent = verifiedStudents.get(
        student.student_id
      );

      const verifiedRoom =
        verifiedStudent?.classrooms.find(
          (item) => item.roomId === room.id
        );

      // All counts come from the same evidence-derived backend snapshot.
      // A currently enrolled learner with no assignments has no summary row.
      const totalAssignments = verifiedRoom?.totalAssignments ?? 0;
      const completedAssignments = verifiedRoom?.completedAssignments ?? 0;
      const incompleteAssignments = verifiedRoom?.incompleteAssignments ?? 0;
      const inProgressAssignments = verifiedRoom?.inProgressAssignments ?? 0;
      const notStartedAssignments = verifiedRoom?.notStartedAssignments ?? 0;

      summary.classrooms.push({
        roomId: room.id,
        roomName: room.room_name,
        section: room.section,

        totalAssignments,
        completedAssignments,
        inProgressAssignments,
        incompleteAssignments,
        notStartedAssignments,

        completionRate: calculateCompletionRate(
          totalAssignments,
          completedAssignments
        ),
      });

      summary.totalAssignments += totalAssignments;
      summary.completedAssignments += completedAssignments;
      summary.inProgressAssignments += inProgressAssignments;
      summary.incompleteAssignments += incompleteAssignments;
      summary.notStartedAssignments += notStartedAssignments;
    });
  });

  const attemptsByStudent = new Map<
    string,
    TeacherOralReadingAttemptSummary[]
  >();

  filterRecords(attempts, scope).forEach((attempt) => {
    if (!studentMap.has(attempt.learnerId)) return;

    const existing =
      attemptsByStudent.get(attempt.learnerId) ?? [];

    existing.push(attempt);

    attemptsByStudent.set(attempt.learnerId, existing);
  });

  studentMap.forEach((student) => {
    student.completionRate = calculateCompletionRate(
      student.totalAssignments,
      student.completedAssignments
    );

    const studentAttempts =
      attemptsByStudent.get(student.studentId) ?? [];

    const readingMetrics =
      calculateReadingMetrics(studentAttempts);

    student.readingAttempts =
      readingMetrics.readingAttempts;

    student.averagePronunciationAccuracy =
      readingMetrics.averagePronunciationAccuracy;

    student.averageReadingSpeedWpm =
      readingMetrics.averageReadingSpeedWpm;

    Object.assign(student, quizMetrics(filterRecords(quizzes, scope).filter(quiz => quiz.studentId === student.studentId)));
  });

  const students = [...studentMap.values()].sort(
    (a, b) =>
      a.studentName.localeCompare(b.studentName)
  );

  return {
    totalStudents: students.length,
    students,
  };
}
