const { getSupabaseAdmin } = require("./supabaseAdmin");
const { OralReadingAuthorizationError, OralReadingPersistenceError } = require("./oralReadingAttemptService");

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

module.exports = { deriveAssignedProgress, getAssignedReadingProgress };
