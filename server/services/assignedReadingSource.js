const { createHash } = require("node:crypto");
const { getSupabaseAdmin } = require("./supabaseAdmin");

function passageRevision(text) {
  return createHash("sha256").update(text.trim()).digest("hex");
}

// Read existing M4 relationships only. Never update classroom completion.
async function loadAssignedReadingSource(requester, materialId, context, dependencies = {}) {
  const { OralReadingAuthorizationError, OralReadingPersistenceError } = require("./oralReadingAttemptService");
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  for (const value of [materialId, context.roomId, context.activityAssignmentId]) {
    if (typeof value !== "string" || !uuid.test(value)) {
      throw new OralReadingPersistenceError("Open this story from its Learning Room.", 400);
    }
  }
  if (requester.profile.role !== "student" || context.moduleId || context.passageId || context.assignmentId) {
    throw new OralReadingAuthorizationError();
  }
  const db = dependencies.getSupabaseAdmin?.() ?? getSupabaseAdmin();
  const { data: assignment, error } = await db.from("reading_activity_assignments")
    .select("id,room_id,material_id,student_id,question_set_id,read_aloud_only").eq("id", context.activityAssignmentId)
    .eq("material_id", materialId).eq("room_id", context.roomId)
    .eq("student_id", requester.user.id).maybeSingle();
  if (error) throw new OralReadingPersistenceError("Unable to verify the reading assignment.");
  if (!assignment) throw new OralReadingAuthorizationError();
  const { data: enrollment, error: enrollmentError } = await db.from("enrollments")
    .select("room_id").eq("room_id", assignment.room_id).eq("student_id", requester.user.id).maybeSingle();
  if (enrollmentError) throw new OralReadingPersistenceError("Unable to verify classroom enrollment.");
  if (!enrollment) throw new OralReadingAuthorizationError();
  const { data: material, error: materialError } = await db.from("uploaded_materials")
    .select("id,title,content_text,language,extraction_status").eq("id", materialId).maybeSingle();
  if (materialError) throw new OralReadingPersistenceError("Unable to load the assigned story.");
  if (!material) throw new OralReadingAuthorizationError();
  const language = { en: "en", english: "en", fil: "fil", filipino: "fil", tagalog: "fil", "fil-ph": "fil", tl: "fil", "tl-ph": "fil" }[material.language?.trim().toLowerCase()];
  if (material.extraction_status !== "completed" || !material.content_text?.trim() || !language) {
    throw new OralReadingPersistenceError("This story is not ready for oral reading yet. It needs readable English or Filipino text.", 422);
  }
  return {
    id: null, materialId, activityAssignmentId: assignment.id, questionSetId: assignment.question_set_id ?? null,
    readAloudOnly: assignment.read_aloud_only === true,
    roomId: assignment.room_id, assignmentId: null, passageId: null,
    title: material.title, passageTitle: material.title, passage: material.content_text.trim(),
    passageRevision: passageRevision(material.content_text), language, difficulty: "", learningPath: "",
  };
}

module.exports = { loadAssignedReadingSource, passageRevision };
