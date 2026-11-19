// Supabase (service role) data access for M2 F8 (Student reassessment delivery and official results).
// Results are written ONLY through m2_record_reassessment_result (security definer; the database refuses any other
// reassessment insert), which re-checks the gate, assignment, enrollment and version in one transaction.
const { getSupabaseAdmin } = require("./supabaseAdmin");

const ASSIGNMENT_COLUMNS = [
  "id", "package_version_id", "package_id", "language", "kind", "room_id", "student_id", "assigned_at", "due_at",
  "status", "result_id", "completed_at",
].join(", ");
const RESULT_COLUMNS = "id, user_id, assessment_type, language, orv_score, comprehension_score, reading_level, reading_speed_wpm, oral_reading_metrics, completed_at, verification_recording_id, package_version_id, reassessment_assignment_id";

function raise(error) {
  throw Object.assign(new Error(error?.message || "Database request failed."), { code: error?.code });
}
async function rows(query) {
  const { data, error } = await query;
  if (error) raise(error);
  return data ?? [];
}
async function one(query) {
  const { data, error } = await query;
  if (error) raise(error);
  return data ?? null;
}

function createSupabaseReassessmentDeliveryRepository({ getAdmin = getSupabaseAdmin } = {}) {
  const db = () => getAdmin();
  return {
    getSettings: () => one(db().from("m2_reassessment_settings")
      .select("official_reassessment_enabled, independent_learner_enabled, independent_min_days_between").maybeSingle()),
    getAssignment: (id) => one(db().from("m2_reassessment_assignments").select(ASSIGNMENT_COLUMNS).eq("id", id).maybeSingle()),
    listMyAssignments: (studentId, kind = "classroom") => rows(db().from("m2_reassessment_assignments").select(ASSIGNMENT_COLUMNS)
      .eq("student_id", studentId).eq("kind", kind)),
    /** Centrally approved Independent Learner packages only; classroom packages are never read here. */
    listIndependentPackages: () => rows(db().from("m2_assessment_packages").select("id, kind, audience, scope, language, title, archived_at")
      .eq("kind", "reassessment").eq("audience", "independent_learners").eq("scope", "platform").is("archived_at", null)),
    listPublishedVersions: (packageIds) => (packageIds.length ? rows(db().from("m2_assessment_package_versions")
      .select("id, package_id, version_label, status").in("package_id", packageIds).eq("status", "published")) : []),
    async hasInitialDiagnostic(userId, language) {
      const { data, error } = await db().rpc("m2_initial_diagnostic_completed", { p_user: userId, p_language: language });
      if (error) raise(error);
      return data === true;
    },
    /** When the learner's latest official result in this language was verified (initial or recorded reassessment). */
    async latestOfficialResultAt(userId, language) {
      const found = await rows(db().from("diagnostic_results").select("verified_at").eq("user_id", userId).eq("language", language)
        .eq("verification_status", "server_verified").in("assessment_type", ["initial", "reassessment"])
        .order("verified_at", { ascending: false }).limit(1));
      return found[0]?.verified_at ?? null;
    },
    /** ONE insert; the database guard and the eligibility trigger re-check every rule. */
    insertIndependentAssignment: (row) => one(db().from("m2_reassessment_assignments").insert(row).select(ASSIGNMENT_COLUMNS).single()),
    closeWithdrawn: (id, userId) => rows(db().from("m2_reassessment_assignments")
      .update({ status: "cancelled", cancelled_by: userId, cancel_reason: "The reassessment version was withdrawn." })
      .eq("id", id).eq("student_id", userId).eq("kind", "independent").eq("status", "active").select("id")),
    getRoom: (id) => one(db().from("rooms").select("id, room_name, archived_at").eq("id", id).maybeSingle()),
    async isEnrolled(roomId, studentId) {
      const found = await rows(db().from("enrollments").select("room_id").eq("room_id", roomId).eq("student_id", studentId).limit(1));
      return found.length > 0;
    },
    getVersion: (id) => one(db().from("m2_assessment_package_versions")
      .select("id, package_id, version_label, status, passage_title, paragraphs, questions, content_sha256").eq("id", id).maybeSingle()),
    getPackage: (id) => one(db().from("m2_assessment_packages").select("id, kind, audience, scope, language, title, archived_at").eq("id", id).maybeSingle()),
    async isEndorsed(versionId) {
      const { data, error } = await db().rpc("m2_version_educator_endorsed", { p_version: versionId });
      if (error) raise(error);
      return data === true;
    },
    loadPackages: (ids) => (ids.length ? rows(db().from("m2_assessment_packages").select("id, kind, audience, scope, language, title, archived_at").in("id", ids)) : []),
    loadVersions: (ids) => (ids.length ? rows(db().from("m2_assessment_package_versions").select("id, package_id, version_label, status").in("id", ids)) : []),
    loadRooms: (ids) => (ids.length ? rows(db().from("rooms").select("id, room_name, archived_at").in("id", ids)) : []),
    /** Only this learner's rows, whatever ids are asked for. */
    loadResults: (ids, userId) => (ids.length
      ? rows(db().from("diagnostic_results").select(RESULT_COLUMNS).in("id", ids).eq("user_id", userId)) : []),
    async recordResult(assignmentId, userId, payload) {
      const { data, error } = await db().rpc("m2_record_reassessment_result", { p_assignment: assignmentId, p_user: userId, p_result: payload });
      if (error) raise(error);
      return data;
    },
  };
}

module.exports = { createSupabaseReassessmentDeliveryRepository };
