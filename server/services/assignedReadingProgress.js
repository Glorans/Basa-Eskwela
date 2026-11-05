const { getSupabaseAdmin } = require("./supabaseAdmin");
const { OralReadingAuthorizationError, OralReadingPersistenceError } = require("./oralReadingAttemptService");
const { chooseActivityAttempt } = require("./comprehensionActivity");

// Assessment completion describes saved work, not passage mastery or a passing grade.
function deriveAssignedProgress(assignment, readings, comprehensions) {
  const oral = readings.filter(row => row.activity_assignment_id === assignment.id
    && row.material_id === assignment.material_id && row.room_id === assignment.room_id);
  const linked = comprehensions.filter(row => row.activity_assignment_id === assignment.id
    && row.material_id === assignment.material_id && row.room_id === assignment.room_id
    && oral.some(reading => reading.id === row.oral_reading_attempt_id));
  const assessment = linked.find(row => row.status === "completed") ?? linked[0];
  return {
    activityAssignmentId: assignment.id,
    materialId: assignment.material_id,
    roomId: assignment.room_id,
    readAloudOnly: assignment.read_aloud_only === true,
    status: assignment.read_aloud_only === true
      ? (oral.length && assignment.status === "completed" ? "Completed" : oral.length ? "Oral Reading Saved" : "Not Started")
      : assessment?.status === "completed" ? "Completed"
      : assessment ? "Comprehension In Progress" : oral.length ? "Oral Reading Saved" : "Not Started",
    oralReadingAttemptId: assessment?.oral_reading_attempt_id ?? oral[0]?.id ?? null,
    comprehensionAttemptId: assignment.read_aloud_only === true ? null : assessment?.id ?? null,
  };
}

/**
 * Assigned activities a learner still has. A Teacher's removed activity leaves the Learning Room,
 * so it is not owed work; its saved readings and assessments stay in history.
 */
function activeMaterialAssignments(assignments) {
  return assignments.filter((assignment) => !assignment.removed_at);
}

/**
 * Module assignments a learner can still open: M4 hides a module once it is deleted or no longer
 * published. Saved results stay in history.
 */
function activeRoomModules(roomModules, modules) {
  const open = new Set(modules.filter((module) => module.status === "published" && !module.deleted_at).map((module) => module.id));
  return roomModules.filter((assignment) => open.has(assignment.module_id));
}

/**
 * M6 starts only for a passage with reviewed questions, so a passage without them cannot need an
 * assessment. `reviewedQuestions` are rows with passage_id and review_status "reviewed".
 */
function withAssessmentRequirement(passages, reviewedQuestions) {
  const withQuestions = new Set(reviewedQuestions.map((question) => question.passage_id));
  return passages.map((passage) => ({ ...passage, requiresAssessment: withQuestions.has(passage.id) }));
}

/**
 * One row per learner for each active classroom module assignment: selected recipients, or
 * everyone currently enrolled. Removed assignments are not counted. Same shape as a material
 * assignment, plus kind "module" and the module's passages. A passage is read-aloud-only only when
 * it is explicitly known to have no reviewed questions; otherwise the assessment stays required.
 */
function expandModuleAssignments(roomModules, recipients, passages, enrolledIn) {
  const rows = [];
  for (const assignment of roomModules) {
    if (assignment.removed_at) continue;
    const selected = assignment.targeting_mode === "selected_students"
      ? new Set(recipients.filter((row) => row.room_module_id === assignment.id).map((row) => row.student_id)) : null;
    const modulePassages = passages.filter((passage) => passage.module_id === assignment.module_id);
    const passageIds = modulePassages.map((passage) => passage.id);
    const readAloudOnlyPassageIds = modulePassages.filter((passage) => passage.requiresAssessment === false).map((passage) => passage.id);
    for (const studentId of new Set(enrolledIn(assignment.room_id))) {
      if (selected && !selected.has(studentId)) continue;
      rows.push({ kind: "module", id: assignment.id, student_id: studentId, room_id: assignment.room_id,
        module_id: assignment.module_id, assigned_at: assignment.assigned_at, passageIds, readAloudOnlyPassageIds });
    }
  }
  return rows;
}

/**
 * Completed when every passage has its evidence for this assignment: the completed assessment or,
 * for a passage without reviewed questions, a saved reading. M4 keeps no module record, so this is
 * read from saved work. Each passage is one learning activity, so repeated readings and extra attempts
 * count once. A module with no passages is never completed.
 */
function deriveModuleProgress(assignment, readings, comprehensions) {
  const inAssignment = (row) => row.module_id === assignment.module_id && row.assignment_id === assignment.id && row.room_id === assignment.room_id;
  const attempts = comprehensions.filter((row) => inAssignment(row) && assignment.passageIds.includes(row.passage_id));
  const assignedReadings = readings.filter(inAssignment);
  const readAloudOnly = new Set(assignment.readAloudOnlyPassageIds ?? []);
  const passageDone = (passageId) => chooseActivityAttempt(attempts.filter((row) => row.passage_id === passageId))?.status === "completed"
    || (readAloudOnly.has(passageId) && assignedReadings.some((row) => row.passage_id === passageId));
  const passagesCompleted = assignment.passageIds.filter(passageDone).length;
  const passagesTotal = assignment.passageIds.length;
  return {
    kind: "module", activityAssignmentId: assignment.id, moduleId: assignment.module_id, roomId: assignment.room_id,
    readAloudOnly: false, passagesCompleted, passagesTotal,
    status: passagesTotal > 0 && passagesCompleted === passagesTotal ? "Completed"
      : attempts.length || assignedReadings.length ? "In Progress" : "Not Started",
    oralReadingAttemptId: null, comprehensionAttemptId: null,
  };
}

/** Status of either assignment type, from saved evidence only. */
function deriveActivityProgress(assignment, readings, comprehensions) {
  return assignment.kind === "module" ? deriveModuleProgress(assignment, readings, comprehensions)
    : deriveAssignedProgress(assignment, readings, comprehensions);
}

async function getAssignedReadingProgress(requester, roomId, dependencies = {}) {
  if (requester.profile.role !== "student") throw new OralReadingAuthorizationError();
  if (typeof roomId !== "string" || !/^[0-9a-f-]{36}$/i.test(roomId)) {
    throw new OralReadingPersistenceError("Invalid Learning Room.", 400);
  }
  const db = dependencies.getSupabaseAdmin?.() ?? getSupabaseAdmin();
  const { data: enrollment, error } = await db.from("enrollments").select("room_id")
    .eq("room_id", roomId).eq("student_id", requester.user.id).maybeSingle();
  if (error) throw new OralReadingPersistenceError("Unable to verify classroom enrollment.");
  if (!enrollment) throw new OralReadingAuthorizationError();
  async function rows(table, columns, ownerColumn) {
    const all = [];
    for (let offset = 0; ; offset += 100) {
      const { data, error: queryError } = await db.from(table).select(columns)
        .eq(ownerColumn, requester.user.id).eq("room_id", roomId)
        .order("id", { ascending: false }).range(offset, offset + 99);
      if (queryError) throw new OralReadingPersistenceError("Unable to load assessment progress. Please retry.");
      all.push(...(data ?? []));
      if (!data || data.length < 100) return all;
    }
  }
  const [assignments, readings, comprehensions] = await Promise.all([
    rows("reading_activity_assignments", "id,material_id,room_id,read_aloud_only,status", "student_id"),
    rows("oral_reading_attempts", "id,material_id,room_id,activity_assignment_id,completed_at", "user_id"),
    rows("m6_comprehension_attempts", "id,material_id,room_id,activity_assignment_id,oral_reading_attempt_id,status,created_at", "user_id"),
  ]);
  readings.sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? ""));
  comprehensions.sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
  return assignments.map(assignment => deriveAssignedProgress(assignment, readings, comprehensions));
}

module.exports = { activeMaterialAssignments, activeRoomModules, withAssessmentRequirement, deriveAssignedProgress, deriveModuleProgress, deriveActivityProgress, expandModuleAssignments, getAssignedReadingProgress };
