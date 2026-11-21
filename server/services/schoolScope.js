// M1 multi-tenancy (Appendix N F7-F11): one database, many schools.
//
// Each School Admin, Teacher and school Student has ONE primary school: profiles.school_id (database-protected; it
// can never be set by the browser and never changes once set). Every other school-owned record belongs to the
// school of the account that owns it (rooms.teacher_id, modules.created_by, m2_assessment_packages.owner_id,
// diagnostic_results.user_id, ...). System Admins and Independent Learners have no school.
//
// The backend reads with the service role, which bypasses row-level security, so every School Admin read or write
// is limited HERE to the requester's own school. The school is always read from the database profile of the
// verified user, never from the request. Deny by default: a School Admin without a school sees nothing.
const { getSupabaseAdmin } = require("./supabaseAdmin");

const BATCH = 200;
const PAGE = 1000;

class SchoolScopeError extends Error {
  constructor(message = "This record is outside your school.", statusCode = 403) {
    super(message);
    this.name = "SchoolScopeError";
    this.statusCode = statusCode;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const db = (dependencies = {}) => (dependencies.getSupabaseAdmin ?? dependencies.getAdmin ?? getSupabaseAdmin)();

/**
 * The requester's school id, read from their database profile (cached on the requester object for this request).
 * Throws 403 when the account has no school, so a School Admin path can never run unscoped.
 */
async function requireRequesterSchool(requester, dependencies = {}) {
  const userId = requester?.user?.id ?? requester?.profile?.id;
  if (!userId) throw new SchoolScopeError("School access is required.");
  if (requester.schoolId) return requester.schoolId;
  let schoolId = requester.profile?.school_id;
  if (schoolId === undefined) {
    const { data, error } = await db(dependencies).from("profiles").select("school_id").eq("id", userId).maybeSingle();
    if (error) throw new SchoolScopeError("Unable to verify your school. Try again.", 503);
    schoolId = data?.school_id ?? null;
  }
  if (!schoolId || !UUID.test(schoolId)) throw new SchoolScopeError("Your account is not assigned to a school. Contact your System Admin.");
  requester.schoolId = schoolId;
  return schoolId;
}

/** Every account id in the school (School Admins, Teachers, Students). */
async function schoolMemberIds(schoolId, dependencies = {}) {
  if (!schoolId) throw new SchoolScopeError();
  const ids = new Set();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db(dependencies).from("profiles").select("id").eq("school_id", schoolId)
      .order("id", { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw new SchoolScopeError("Unable to load your school's accounts.", 503);
    (data ?? []).forEach((row) => ids.add(row.id));
    if (!data || data.length < PAGE) return ids;
  }
}

/** The subset of ids that belong to the school (one query per 200 ids). */
async function filterSchoolMembers(schoolId, ids, dependencies = {}) {
  if (!schoolId) throw new SchoolScopeError();
  const unique = [...new Set((ids ?? []).filter((id) => typeof id === "string" && UUID.test(id)))];
  const members = new Set();
  for (let i = 0; i < unique.length; i += BATCH) {
    const { data, error } = await db(dependencies).from("profiles").select("id").eq("school_id", schoolId).in("id", unique.slice(i, i + BATCH));
    if (error) throw new SchoolScopeError("Unable to verify school membership.", 503);
    (data ?? []).forEach((row) => members.add(row.id));
  }
  return members;
}

/** Throws (404 by default, so a guessed id from another school reveals nothing) unless userId is in the school. */
async function assertSchoolMember(schoolId, userId, dependencies = {}, { message = "Not found.", statusCode = 404 } = {}) {
  if (!(await filterSchoolMembers(schoolId, [userId], dependencies)).has(userId)) throw new SchoolScopeError(message, statusCode);
}

/** The requester's school members, for a School Admin request (requireRequesterSchool + schoolMemberIds). */
async function requesterSchoolMembers(requester, dependencies = {}) {
  const schoolId = await requireRequesterSchool(requester, dependencies);
  return { schoolId, members: await schoolMemberIds(schoolId, dependencies) };
}

/** The requester's school, or null for accounts without one (System Admin, Independent Learner). Never throws for null. */
async function requesterSchoolOrNull(requester, dependencies = {}) {
  const userId = requester?.user?.id ?? requester?.profile?.id;
  if (!userId) return null;
  if (requester.schoolId !== undefined) return requester.schoolId;
  let schoolId = requester.profile?.school_id;
  if (schoolId === undefined) {
    const { data, error } = await db(dependencies).from("profiles").select("school_id").eq("id", userId).maybeSingle();
    if (error) throw new SchoolScopeError("Unable to verify your school. Try again.", 503);
    schoolId = data?.school_id ?? null;
  }
  requester.schoolId = schoolId ?? null;
  return requester.schoolId;
}

/**
 * Shared content (published modules, catalog passages): the owner ids among ownerIds that belong to ANOTHER school
 * than the requester's. Platform content (owners without a school) is never in this set. Empty for requesters without
 * a school, whose access is unchanged.
 */
async function foreignSchoolOwners(requester, ownerIds, dependencies = {}) {
  const unique = [...new Set((ownerIds ?? []).filter((id) => typeof id === "string" && UUID.test(id)))];
  const foreign = new Set();
  if (!unique.length) return foreign;
  const schoolId = await requesterSchoolOrNull(requester, dependencies);
  if (!schoolId) return foreign;
  for (let i = 0; i < unique.length; i += BATCH) {
    const { data, error } = await db(dependencies).from("profiles").select("id, school_id").in("id", unique.slice(i, i + BATCH));
    if (error) throw new SchoolScopeError("Unable to verify school membership.", 503);
    (data ?? []).forEach((row) => { if (row.school_id && row.school_id !== schoolId) foreign.add(row.id); });
  }
  return foreign;
}

module.exports = {
  SchoolScopeError,
  assertSchoolMember,
  foreignSchoolOwners,
  requesterSchoolOrNull,
  filterSchoolMembers,
  requesterSchoolMembers,
  requireRequesterSchool,
  schoolMemberIds,
};
