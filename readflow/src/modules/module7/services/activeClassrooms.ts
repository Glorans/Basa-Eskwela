import type { TeacherCompletionAnalytics } from "./teacherAnalyticsService";

/**
 * Teacher Analytics shows active classrooms only (rooms.archived_at is null).
 * Archived rooms and their saved results are untouched; they stay in Archived Classrooms.
 */
export interface ActiveClassroomScope {
  /** Active rooms owned by the Teacher, newest first, as the classroom service returns them. */
  rooms: { id: string; name: string; code?: string }[];
  roomIds: Set<string>;
  /** Learners currently enrolled in at least one active room. */
  studentIds: Set<string>;
}

export const isActiveClassroom = (room: { archived_at?: string | null }) => !room.archived_at;

const rate = (total: number, completed: number) => total === 0 ? null : Math.round((completed / total) * 10000) / 100;

/**
 * A record saved to a room counts only when that room is active. A record without a room
 * (independent or older unattributed work) counts only for a learner still enrolled in an
 * active room, matching how the endpoints already scope it by current enrollment.
 */
export function activeRecords<T extends { roomId?: string | null }>(records: T[], active: ActiveClassroomScope, learnerOf: (record: T) => string): T[] {
  return records.filter(record => record.roomId ? active.roomIds.has(record.roomId) : active.studentIds.has(learnerOf(record)));
}

type Counts = { totalAssignments: number; completedAssignments: number; inProgressAssignments: number; notStartedAssignments: number; incompleteAssignments: number };
function sum(rows: Counts[]) {
  const total = (key: keyof Counts) => rows.reduce((value, row) => value + row[key], 0);
  const totalAssignments = total("totalAssignments"), completedAssignments = total("completedAssignments");
  return {
    totalAssignments, completedAssignments,
    inProgressAssignments: total("inProgressAssignments"), notStartedAssignments: total("notStartedAssignments"),
    incompleteAssignments: total("incompleteAssignments"), completionRate: rate(totalAssignments, completedAssignments),
  };
}

/** Keeps only active rooms in the completion snapshot. Totals are the same sums the backend uses. */
export function activeCompletion(completion: TeacherCompletionAnalytics, active: ActiveClassroomScope): TeacherCompletionAnalytics {
  const classrooms = completion.classrooms.filter(room => active.roomIds.has(room.roomId));
  const students = completion.students.flatMap(student => {
    const rooms = student.classrooms.filter(room => active.roomIds.has(room.roomId));
    return rooms.length ? [{ ...student, ...sum(rooms), classrooms: rooms }] : [];
  });
  return { ...completion, ...sum(classrooms), totalClassrooms: classrooms.length, classrooms, students };
}
