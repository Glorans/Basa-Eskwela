const { reportRows, recipientRows } = require("./weeklyReportRows");

const { getSupabaseAdmin } = require("./supabaseAdmin");

const {
  loadTeacherStudentProfiles,
  OralReadingAuthorizationError,
  OralReadingPersistenceError,
} = require("./oralReadingAttemptService");

const {
  activeMaterialAssignments,
  activeRoomModules,
  deriveActivityProgress,
  withAssessmentRequirement,
  expandModuleAssignments,
} = require("./assignedReadingProgress");

async function fetchAllRows(db, table, columns, filterColumn, filterValue, complete = false) {
  try {
    // Continue keyset reads to an empty page, even under a reduced server cap.
    return await reportRows(db, table, columns, { [filterColumn]: filterValue });
  } catch (error) {
    if (complete) throw error;
    throw new OralReadingPersistenceError(
      "Unable to load classroom completion analytics. Please retry."
    );
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
  const roomProgress = [];

  for (const room of rooms) {
    const [
      assignments,
      readings,
      comprehensions,
    ] = await Promise.all([
      fetchAllRows(
        db,
        "reading_activity_assignments",
        "*",
        "room_id",
        room.id,
        dependencies.weeklyReportStrict === true
      ),
      fetchAllRows(
        db,
        "oral_reading_attempts",
        "id,user_id,module_id,passage_id,assignment_id,material_id,room_id,activity_assignment_id,completed_at",
        "room_id",
        room.id,
        dependencies.weeklyReportStrict === true
      ),
      fetchAllRows(
        db,
        "m6_comprehension_attempts",
        "id,user_id,module_id,passage_id,assignment_id,material_id,room_id,activity_assignment_id,oral_reading_attempt_id,status,created_at,completed_at",
        "room_id",
        room.id,
        dependencies.weeklyReportStrict === true
      ),
    ]);

    const moduleAssignments = await loadRoomModuleAssignments(db, room, authorizedStudents, dependencies.weeklyReportStrict === true);
    roomProgress.push({
      room,
      progress: completionProgress(room, [...activeMaterialAssignments(assignments), ...moduleAssignments], readings, comprehensions, authorizedStudents),
    });
  }

  return summarizeCompletion(roomProgress);
}

/** Active classroom module assignments in one room, one row per learner currently enrolled there. */
async function loadRoomModuleAssignments(db, room, authorizedStudents, complete) {
  const assigned = await fetchAllRows(db, "room_modules", "*", "room_id", room.id, complete);
  if (!assigned.length) return [];
  try {
    const moduleIds = assigned.map((row) => row.module_id);
    const roomModules = activeRoomModules(assigned, await reportRows(db, "modules", "id,status,deleted_at", {}, "id", moduleIds));
    if (!roomModules.length) return [];
    const [recipients, passages, questions] = await Promise.all([
      recipientRows(db, roomModules.map((row) => row.id)),
      reportRows(db, "module_passages", "id,module_id", {}, "module_id", roomModules.map((row) => row.module_id)),
      reportRows(db, "comprehension_questions", "id,passage_id", { review_status: "reviewed" }, "module_id", roomModules.map((row) => row.module_id)),
    ]);
    const enrolled = [...(authorizedStudents.roomsByStudent?.entries() ?? [])].filter(([, rooms]) => rooms.has(room.id)).map(([id]) => id);
    return expandModuleAssignments(roomModules, recipients, withAssessmentRequirement(passages, questions), () => enrolled);
  } catch (error) {
    if (complete) throw error;
    throw new OralReadingPersistenceError("Unable to load classroom completion analytics. Please retry.");
  }
}

/**
 * Current status of each assignment in one classroom, for students currently enrolled
 * there (authorizedStudents.roomsByStudent). Shared by the Teacher and Admin views.
 */
function completionProgress(room, assignments, readings, comprehensions, authorizedStudents) {
    const authorizedAssignments = [...new Map(assignments.filter((assignment) =>
      authorizedStudents.roomsByStudent?.get(assignment.student_id)?.has(room.id)
    ).map(assignment => [`${assignment.kind ?? "material"}:${assignment.id}:${assignment.student_id}`, assignment])).values()];
    const progress = authorizedAssignments.map((assignment) => {
      const studentReadings = readings.filter(
        (reading) =>
          reading.user_id === assignment.student_id
      );

      const studentComprehensions = comprehensions.filter(
        (attempt) =>
          attempt.user_id === assignment.student_id
      );

      const result = deriveActivityProgress(
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

    return progress;
}

/** Classroom and student completion totals from completionProgress results. */
function summarizeCompletion(roomProgress) {
  const classrooms = [];
  const studentMap = new Map();

  for (const { room, progress } of roomProgress) {
    const completedAssignments = progress.filter(
      (item) => item.status === "Completed"
    ).length;

    // Collapse the shared detailed stages into the three dashboard buckets.
    const notStartedAssignments = progress.filter(item => item.status === "Not Started").length;
    const inProgressAssignments = progress.length - completedAssignments - notStartedAssignments;
    const totalAssignments = progress.length;

    classrooms.push({
      roomId: room.id,
      roomName: room.room_name,
      totalAssignments,
      completedAssignments,
      inProgressAssignments,
      notStartedAssignments,
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
          inProgressAssignments: 0,
          notStartedAssignments: 0,
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
          inProgressAssignments: 0,
          notStartedAssignments: 0,
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
      } else if (item.status === "Not Started") {
        student.notStartedAssignments += 1;
        studentRoom.notStartedAssignments += 1;
      } else {
        student.inProgressAssignments += 1;
        studentRoom.inProgressAssignments += 1;
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
    inProgressAssignments: classrooms.reduce((sum, room) => sum + room.inProgressAssignments, 0),
    notStartedAssignments: classrooms.reduce((sum, room) => sum + room.notStartedAssignments, 0),
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
  completionProgress,
  summarizeCompletion,
};
