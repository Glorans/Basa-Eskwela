
import { supabase } from "../../../lib/supabaseClient";

import {
  getTeacherClassrooms,
  getRoomEnrollments,
  getClassroomReadingActivities,
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
  const completedComprehension = attempts.filter(
    (attempt) => attempt.comprehension.status === "completed"
  );

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

    averageComprehensionScore: average(
      completedComprehension.map((attempt) =>
        attempt.comprehension.status === "completed"
          ? attempt.comprehension.firstAttemptPercentage
          : NaN
      )
    ),

    completedComprehensionAttempts:
      completedComprehension.length,
  };
}

export async function getStudentPerformance(): Promise<StudentPerformanceResult> {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    throw new Error(
      "Please sign in again to view student performance."
    );
  }

  const classrooms = await getTeacherClassrooms(user.id);

  const [
    enrollmentsByRoom,
    assignmentsByRoom,
    attempts,
    verifiedCompletion,
  ] = await Promise.all([
    Promise.all(
      classrooms.map((room) =>
        getRoomEnrollments(room.id)
      )
    ),
    Promise.all(
      classrooms.map((room) =>
        getClassroomReadingActivities(room.id)
      )
    ),
    getTeacherOralReadingAttempts(),
    getTeacherCompletionAnalytics(),
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
    const enrollments = enrollmentsByRoom[index];
    const assignments = assignmentsByRoom[index];

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

      const studentAssignments = assignments.filter(
        (assignment) =>
          assignment.student_id === student.student_id
      );

      const storedInProgress = studentAssignments.filter(
        (assignment) =>
          assignment.status === "in_progress"
      ).length;

      const verifiedStudent = verifiedStudents.get(
        student.student_id
      );

      const verifiedRoom =
        verifiedStudent?.classrooms.find(
          (item) => item.roomId === room.id
        );

      const totalAssignments =
        verifiedRoom?.totalAssignments ??
        studentAssignments.length;

      const completedAssignments =
        verifiedRoom?.completedAssignments ?? 0;

      const incompleteAssignments =
        verifiedRoom?.incompleteAssignments ??
        totalAssignments;

      // In-progress counts remain based on stored statuses.
      // Do not treat an unverified "completed" status as
      // evidence that the assessment was completed.
      const inProgressAssignments =
        storedInProgress;

      // This is a derived residual count, not an M6 status.
      // It represents assignments that are incomplete and
      // not marked "in_progress" in the stored records.
      const notStartedAssignments = Math.max(
        0,
        incompleteAssignments - inProgressAssignments
      );

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

  attempts.forEach((attempt) => {
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

    student.averageComprehensionScore =
      readingMetrics.averageComprehensionScore;

    student.completedComprehensionAttempts =
      readingMetrics.completedComprehensionAttempts;
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
