// M1 F8 Create School (Appendix N): System Admin only. Schools are created, renamed and activated/deactivated through
// database functions that re-check the System Admin and enforce unique names and codes
// (supabase/proposed/m1_multi_tenancy_PROPOSED.sql). Schools are never deleted.
const { getSupabaseAdmin } = require("./supabaseAdmin");
const { AdminUserOperationError } = require("./adminUserService");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE = /^[A-Z0-9][A-Z0-9-]{0,30}[A-Z0-9]$/;
const STATUSES = new Set(["active", "inactive"]);

class SchoolError extends AdminUserOperationError {
  constructor(message, statusCode = 400) { super(message, statusCode); }
}

const name = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const code = (value) => String(value ?? "").trim().toUpperCase();

function readSchoolInput(input, { partial = false } = {}) {
  const out = {};
  if (!partial || input?.name !== undefined) {
    out.name = name(input?.name);
    if (out.name.length < 2 || out.name.length > 120) throw new SchoolError("Enter the school name (2 to 120 characters).");
  }
  if (!partial) {
    out.code = code(input?.code);
    if (!CODE.test(out.code)) throw new SchoolError("Enter a school code of 2 to 32 letters, numbers or hyphens (for example SCHOOL-2).");
  }
  if (!partial || input?.status !== undefined) {
    out.status = input?.status === undefined && !partial ? "active" : String(input?.status ?? "");
    if (!STATUSES.has(out.status)) throw new SchoolError("Choose Active or Inactive.");
  }
  return out;
}

function databaseError(error) {
  const text = `${error?.code ?? ""} ${error?.message ?? ""}`;
  if (/PGRST202|Could not find the function|PGRST205|Could not find the table|42P01/i.test(text)) {
    return new SchoolError("School management needs the M1 multi-tenancy database update. No change was made.", 503);
  }
  const known = {
    m1_school_actor_not_system_admin: ["Only an active System Admin can manage schools.", 403],
    m1_school_duplicate_code: ["A school with this code already exists. Choose a different code.", 409],
    m1_school_duplicate_name: ["A school with this name already exists.", 409],
    m1_school_invalid_name: ["Enter the school name (2 to 120 characters).", 400],
    m1_school_invalid_code: ["Enter a school code of 2 to 32 letters, numbers or hyphens.", 400],
    m1_school_invalid_status: ["Choose Active or Inactive.", 400],
    m1_school_missing: ["School not found.", 404],
  };
  const key = Object.keys(known).find((k) => text.includes(k));
  return key ? new SchoolError(...known[key]) : new SchoolError("The school could not be saved. No change was made.", 502);
}

/** Every school with its account counts (System Admin view). */
async function listSchools(dependencies = {}) {
  const db = (dependencies.getSupabaseAdmin ?? getSupabaseAdmin)();
  const [schools, profiles] = await Promise.all([
    db.from("schools").select("id, name, code, status, is_legacy, created_at, updated_at").order("created_at", { ascending: true }),
    db.from("profiles").select("school_id, role").not("school_id", "is", null),
  ]);
  if (schools.error) throw databaseError(schools.error);
  if (profiles.error) throw new SchoolError("Unable to load school accounts.", 502);
  const counts = new Map();
  for (const p of profiles.data ?? []) {
    const c = counts.get(p.school_id) ?? { schoolAdmins: 0, teachers: 0, students: 0 };
    if (p.role === "admin") c.schoolAdmins += 1; else if (p.role === "teacher") c.teachers += 1; else if (p.role === "student") c.students += 1;
    counts.set(p.school_id, c);
  }
  return (schools.data ?? []).map((s) => ({
    id: s.id, name: s.name, code: s.code, status: s.status, isLegacy: s.is_legacy, createdAt: s.created_at, updatedAt: s.updated_at,
    ...(counts.get(s.id) ?? { schoolAdmins: 0, teachers: 0, students: 0 }),
  }));
}

async function createSchool(actorId, input, dependencies = {}) {
  const school = readSchoolInput(input);
  const db = (dependencies.getSupabaseAdmin ?? getSupabaseAdmin)();
  const { data, error } = await db.rpc("m1_create_school", { p_actor: actorId, p_name: school.name, p_code: school.code, p_status: school.status });
  if (error || !data) throw databaseError(error);
  return (await listSchools(dependencies)).find((s) => s.id === data) ?? { id: data, ...school };
}

async function updateSchool(actorId, schoolId, input, dependencies = {}) {
  if (!UUID.test(String(schoolId ?? ""))) throw new SchoolError("School not found.", 404);
  const changes = readSchoolInput(input, { partial: true });
  if (changes.name === undefined && changes.status === undefined) throw new SchoolError("Nothing to change.");
  const db = (dependencies.getSupabaseAdmin ?? getSupabaseAdmin)();
  const { error } = await db.rpc("m1_update_school", { p_actor: actorId, p_school: schoolId, p_name: changes.name ?? null, p_status: changes.status ?? null });
  if (error) throw databaseError(error);
  const found = (await listSchools(dependencies)).find((s) => s.id === schoolId);
  if (!found) throw new SchoolError("School not found.", 404);
  return found;
}

module.exports = { SchoolError, createSchool, listSchools, readSchoolInput, updateSchool };
