const { reportRows } = require("./weeklyReportRows");

const { getSupabaseAdmin } = require("./supabaseAdmin");

const {
  loadTeacherStudentProfiles,
  OralReadingAuthorizationError,
  OralReadingPersistenceError,
} = require("./oralReadingAttemptService");

const {
  deriveAssignedProgress,
} = require("./assignedReadingProgress");

const PAGE_SIZE = 100;

async function fetchAllRows(
  db,
  table,
  columns,
  filterColumn,
  filterValue,
  complete = false
) {
  if (complete) return reportRows(db, table, columns, { [filterColumn]: filterValue });
  const results = [];

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await db
      .from(table)
      .select(columns)
      .eq(filterColumn, filterValue)
      .order("id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      throw new OralReadingPersistenceError(
        "Unable to load classroom completion analytics. Please retry."
      );
    }

    results.push(...(data ?? []));

    if (!data || data.length < PAGE_SIZE) {
      return results;
    }
  }
}

function calculateCompletionRate(total, completed) {
  return total === 0
    ? null
    : Math.round((completed / total) * 10000) / 100;
}

async function getTeacherCompletionAnalytics(
  requester,
  dependencies = {}
) {
  if (
    requester?.profile?.role !== "teacher" ||
    requester.profile.teacher_status !== "approved"
  ) {
    throw new OralReadingAuthorizationError(
      "Approved Teacher access is required."
    );
  }

  const db =
    dependencies.getSupabaseAdmin?.() ?? getSupabaseAdmin();

  const rooms = await fetchAllRows(
    db,
    "rooms",
    "id,room_name,teacher_id",
    "teacher_id",
    requester.user.id,
    dependencies.weeklyReportStrict === true
  );

  // Use the same current student/classroom scope as attempt review. Saved report
  // snapshots remain historical; live completion metrics use current enrollment.
  const authorizedStudents = await loadTeacherStudentProfiles(db, requester.user.id, true);
  const classrooms = [];
  const studentMap = new Map();

  for (const room of rooms) {
    const [
      assignments,
      readings,
      comprehensions,
    ] = await Promise.all([
      fetchAllRows(
        db,
        "reading_activity_assignments",
        "id,student_id,material_id,room_id,read_aloud_only,status",
        "room_id",
        room.id,
        dependencies.weeklyReportStrict === true
      ),
      fetchAllRows(
        db,
        "oral_reading_attempts",
        "id,user_id,material_id,room_id,activity_assignment_id,completed_at",
        "room_id",
        room.id,
        dependencies.weeklyReportStrict === true
      ),
      fetchAllRows(
        db,
        "m6_comprehension_attempts",
        "id,user_id,material_id,room_id,activity_assignment_id,oral_reading_attempt_id,status,created_at",
        "room_id",
        room.id,
        dependencies.weeklyReportStrict === true
      ),
    ]);

    const authorizedAssignments = assignments.filter((assignment) =>
      authorizedStudents.roomsByStudent?.get(assignment.student_id)?.has(room.id)
    );
    const progress = authorizedAssignments.map((assignment) => {
      const studentReadings = readings.filter(
        (reading) =>
          reading.user_id === assignment.student_id
      );

      const studentComprehensions = comprehensions.filter(
        (attempt) =>
          attempt.user_id === assignment.student_id
      );

      const result = deriveAssignedProgress(
        assignment,
        studentReadings,
        studentComprehensions
      );

      return {
        studentId: assignment.student_id,
        roomId: room.id,
        status: result.status,
      };
    });

    const completedAssignments = progress.filter(
      (item) => item.status === "Completed"
    ).length;

    const totalAssignments = authorizedAssignments.length;

    classrooms.push({
      roomId: room.id,
      roomName: room.room_name,
      totalAssignments,
      completedAssignments,
      incompleteAssignments:
        totalAssignments - completedAssignments,
      completionRate: calculateCompletionRate(
        totalAssignments,
        completedAssignments
      ),
    });

    for (const item of progress) {
      let student = studentMap.get(item.studentId);

      if (!student) {
        student = {
          studentId: item.studentId,
          totalAssignments: 0,
          completedAssignments: 0,
          incompleteAssignments: 0,
          completionRate: null,
          classrooms: [],
        };

        studentMap.set(item.studentId, student);
      }

      let studentRoom = student.classrooms.find(
        (entry) => entry.roomId === item.roomId
      );

      if (!studentRoom) {
        studentRoom = {
          roomId: room.id,
          roomName: room.room_name,
          totalAssignments: 0,
          completedAssignments: 0,
          incompleteAssignments: 0,
          completionRate: null,
        };

        student.classrooms.push(studentRoom);
      }

      student.totalAssignments += 1;
      studentRoom.totalAssignments += 1;

      if (item.status === "Completed") {
        student.completedAssignments += 1;
        studentRoom.completedAssignments += 1;
      }
    }
  }

  const students = [...studentMap.values()].map(
    (student) => {
      student.incompleteAssignments =
        student.totalAssignments -
        student.completedAssignments;

      student.completionRate = calculateCompletionRate(
        student.totalAssignments,
        student.completedAssignments
      );

      student.classrooms = student.classrooms.map(
        (room) => ({
          ...room,
          incompleteAssignments:
            room.totalAssignments -
            room.completedAssignments,
          completionRate: calculateCompletionRate(
            room.totalAssignments,
            room.completedAssignments
          ),
        })
      );

      return student;
    }
  );

  const totalAssignments = classrooms.reduce(
    (sum, room) => sum + room.totalAssignments,
    0
  );

  const completedAssignments = classrooms.reduce(
    (sum, room) => sum + room.completedAssignments,
    0
  );

  return {
    totalClassrooms: classrooms.length,
    totalAssignments,
    completedAssignments,
    incompleteAssignments:
      totalAssignments - completedAssignments,
    completionRate: calculateCompletionRate(
      totalAssignments,
      completedAssignments
    ),
    classrooms,
    students,
  };
}

module.exports = {
  getTeacherCompletionAnalytics,
};
