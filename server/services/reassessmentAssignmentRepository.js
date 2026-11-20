// Supabase (service role) data access for M2 F9 reassessment assignments. The backend authorizes every call
// (reassessmentAssignmentService); browser roles have no access to these tables. The database guard
// (m2_guard_reassessment_assignment) re-checks gates, eligibility, ownership and enrollment on every insert.
const { getSupabaseAdmin } = require("./supabaseAdmin");

const ASSIGNMENT_COLUMNS = [
  "id", "package_version_id", "package_id", "language", "kind", "room_id", "student_id", "assigned_by", "assigned_at",
  "due_at", "status", "result_id", "completed_at", "cancelled_by", "cancelled_at", "cancel_reason",
].join(", ");
const BATCH = 100;

function raise(error) {
  throw Object.assign(new Error(error?.message || "Database request failed."), { code: error?.code });
}
async function rows(query) {
  const { data, error } = await query;
  if (error) raise(error);
  return data ?? [];
}
async function batched(ids, make) {
  const out = [];
  for (let i = 0; i < ids.length; i += BATCH) out.push(...await rows(make(ids.slice(i, i + BATCH))));
  return out;
}

function createSupabaseReassessmentRepository({ getAdmin = getSupabaseAdmin } = {}) {
  const db = () => getAdmin();
  return {
    async getSettings() {
      const { data, error } = await db().from("m2_reassessment_settings").select("official_reassessment_enabled").maybeSingle();
      if (error) raise(error);
      return data ?? null;
    },
    listActiveRooms: ({ teacherId } = {}) => {
      let query = db().from("rooms").select("id, room_name, subject, teacher_id, archived_at").is("archived_at", null);
      if (teacherId) query = query.eq("teacher_id", teacherId);
      return rows(query);
    },
    listEnrollments: (roomIds) => (roomIds.length
      ? batched(roomIds, (ids) => db().from("enrollments").select("room_id, student_id").in("room_id", ids)) : []),
    loadProfiles: (ids) => (ids.length
      ? batched(ids, (part) => db().from("profiles").select("id, role, teacher_status, full_name, nickname").in("id", part)) : []),
    listPackages: ({ scopes, ownerId }) => {
      let query = db().from("m2_assessment_packages")
        .select("id, kind, audience, scope, owner_id, language, title, archived_at")
        .eq("kind", "reassessment").eq("audience", "classroom").in("scope", scopes);
      if (ownerId) query = query.eq("owner_id", ownerId);
      return rows(query);
    },
    listVersions: (packageIds) => (packageIds.length
      ? batched(packageIds, (ids) => db().from("m2_assessment_package_versions")
        .select("id, package_id, version_label, status").in("package_id", ids)) : []),
    listReviews: (versionIds) => (versionIds.length
      ? batched(versionIds, (ids) => db().from("m2_assessment_educator_reviews")
        .select("id, version_id, outcome, reviewed_on, recorded_at").in("version_id", ids)) : []),
    listAssignments: async ({ roomIds, studentIds, statuses } = {}) => {
      // A fresh builder per request: Supabase query builders are mutable.
      const base = () => {
        const query = db().from("m2_reassessment_assignments").select(ASSIGNMENT_COLUMNS).eq("kind", "classroom");
        return statuses ? query.in("status", statuses) : query;
      };
      if (roomIds) return roomIds.length ? batched(roomIds, (ids) => base().in("room_id", ids)) : [];
      if (studentIds) return studentIds.length ? batched(studentIds, (ids) => base().in("student_id", ids)) : [];
      return rows(base());
    },
    loadRooms: (ids) => (ids.length
      ? batched(ids, (part) => db().from("rooms").select("id, room_name, subject, teacher_id, archived_at").in("id", part)) : []),
    loadPackages: (ids) => (ids.length
      ? batched(ids, (part) => db().from("m2_assessment_packages").select("id, kind, audience, scope, owner_id, language, title, archived_at").in("id", part)) : []),
    loadVersions: (ids) => (ids.length
      ? batched(ids, (part) => db().from("m2_assessment_package_versions").select("id, package_id, version_label, status").in("id", part)) : []),
    async getAssignment(id) {
      const { data, error } = await db().from("m2_reassessment_assignments").select(ASSIGNMENT_COLUMNS).eq("id", id).maybeSingle();
      if (error) raise(error);
      return data ?? null;
    },
    /** ONE multi-row insert = one statement = one transaction: the whole batch is created or none of it. */
    insertAssignments: (list) => rows(db().from("m2_reassessment_assignments").insert(list).select(ASSIGNMENT_COLUMNS)),
    /** Cancels only while still active (a concurrent completion or cancellation wins and this returns nothing). */
    cancelAssignment: (id, by, reason) => rows(db().from("m2_reassessment_assignments")
      .update({ status: "cancelled", cancelled_by: by, cancel_reason: reason }).eq("id", id).eq("status", "active")
      .select(ASSIGNMENT_COLUMNS)),
  };
}

module.exports = { createSupabaseReassessmentRepository };
