const { getSupabaseAdmin } = require("./supabaseAdmin");
const { getProfileDisplayName } = require("./profileNames");
const { DIAGNOSTIC_ASSESSMENTS } = require("./diagnosticAssessments");

const CODE_TITLES = new Map(Object.values(DIAGNOSTIC_ASSESSMENTS).map((a) => [`${a.id}@${a.version}`, a.title]));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// M2 F3: View Assessment Results and History. Read-only; scoring, classification, M3 placement, M7 and M8 are
// untouched. Only these columns are read and only the mapped fields below are returned: transcripts, word-level
// metrics (which hold the learner's comprehension answers), recording ids and answer keys never leave the server.
const HISTORY_COLUMNS = [
  "id", "user_id", "assessment_type", "language", "assessment_id", "assessment_version", "orv_score",
  "comprehension_score", "reading_level", "completed_at", "verification_status",
].join(", ");
const BATCH = 100;

class DiagnosticHistoryError extends Error {
  constructor(message = "Unable to load diagnostic results.", statusCode = 500) {
    super(message);
    this.name = "DiagnosticHistoryError";
    this.statusCode = statusCode;
  }
}

const finiteOrNull = (value) => {
  const number = typeof value === "string" ? Number(value) : value;
  return typeof number === "number" && Number.isFinite(number) ? number : null;
};

/** One assessment as shown in F3. assessmentType is the stored type ('initial' today; 'reassessment' later). */
function toHistoryEntry(row) {
  return {
    id: row.id,
    assessmentType: row.assessment_type,
    language: row.language,
    completedAt: row.completed_at,
    wordRecognitionScore: finiteOrNull(row.orv_score),
    comprehensionScore: finiteOrNull(row.comprehension_score),
    readingLevel: row.reading_level,
    assessmentId: row.assessment_id ?? null,
    assessmentVersion: row.assessment_version ?? null,
    // Initial: the code-defined diagnostic's title. Reassessment: the package title (added by withTitles).
    // (an activated initial version, F6, gets its own title from withTitles)
    assessmentTitle: row.assessment_type === "initial" ? CODE_TITLES.get(`${row.assessment_id}@${row.assessment_version}`) ?? null : null,
    // Rows written by the browser before server verification stay 'unverified' and are labelled as such.
    verified: row.verification_status === "server_verified",
  };
}

/**
 * F8: reassessment rows store the package id as assessment_id. Their titles are read only when such rows exist, so
 * databases without the reassessment foundation are never asked for the package tables. Only titles are read.
 */
async function withTitles(db, entries) {
  entries = await withActivatedInitialTitles(db, entries);
  const ids = [...new Set(entries.filter((e) => e.assessmentType === "reassessment" && UUID.test(e.assessmentId ?? ""))
    .map((e) => e.assessmentId))];
  if (!ids.length) return entries;
  const titles = new Map();
  for (let i = 0; i < ids.length; i += BATCH) {
    const { data, error } = await db.from("m2_assessment_packages").select("id, title").in("id", ids.slice(i, i + BATCH));
    if (error) break; // titles are cosmetic: history still shows without them
    for (const row of data ?? []) titles.set(row.id, row.title);
  }
  return entries.map((e) => (e.assessmentType === "reassessment" ? { ...e, assessmentTitle: titles.get(e.assessmentId) ?? null } : e));
}

/** Initial results taken on an activated version (not the built-in one): the version's passage title. Cosmetic. */
async function withActivatedInitialTitles(db, entries) {
  const pending = entries.filter((e) => e.assessmentType === "initial" && !e.assessmentTitle && e.assessmentId && e.assessmentVersion);
  if (!pending.length) return entries;
  const { data: packages, error } = await db.from("m2_assessment_packages").select("id, legacy_assessment_id")
    .in("legacy_assessment_id", [...new Set(pending.map((e) => e.assessmentId))]);
  if (error || !packages?.length) return entries;
  const { data: versions, error: ve } = await db.from("m2_assessment_package_versions").select("package_id, version_label, passage_title")
    .in("package_id", packages.map((p) => p.id));
  if (ve) return entries;
  const legacyOf = new Map(packages.map((p) => [p.id, p.legacy_assessment_id]));
  const titles = new Map((versions ?? []).map((v) => [`${legacyOf.get(v.package_id)}@${v.version_label}`, v.passage_title]));
  return entries.map((e) => (pending.includes(e) ? { ...e, assessmentTitle: titles.get(`${e.assessmentId}@${e.assessmentVersion}`) ?? null } : e));
}

/** Newest first; ties (same timestamp) keep a stable order by id. */
function newestFirst(a, b) {
  const time = Date.parse(b.completedAt) - Date.parse(a.completedAt);
  return Number.isNaN(time) || time === 0 ? String(b.id).localeCompare(String(a.id)) : time;
}

async function selectRows(query, label) {
  const { data, error } = await query;
  if (error) throw new DiagnosticHistoryError(`Unable to load ${label}.`);
  return data ?? [];
}

async function loadResultsFor(db, userIds) {
  const rows = [];
  for (let i = 0; i < userIds.length; i += BATCH) {
    rows.push(...await selectRows(
      db.from("diagnostic_results").select(HISTORY_COLUMNS).in("user_id", userIds.slice(i, i + BATCH)),
      "diagnostic results",
    ));
  }
  return rows;
}

/** Students and Independent Learners: the signed-in learner's own results only. */
async function listOwnDiagnosticHistory(userId, { getAdmin = getSupabaseAdmin } = {}) {
  if (!userId) throw new DiagnosticHistoryError("Learner access is required.", 403);
  const db = getAdmin();
  const rows = await selectRows(
    db.from("diagnostic_results").select(HISTORY_COLUMNS).eq("user_id", userId),
    "your diagnostic results",
  );
  // Defense in depth: the query is already limited to this learner.
  return (await withTitles(db, rows.filter((row) => row.user_id === userId).map(toHistoryEntry))).sort(newestFirst);
}

/**
 * Approved Teachers: Students with a CURRENT enrollment in one of the Teacher's own ACTIVE Learning Rooms
 * (rooms.teacher_id = Teacher and rooms.archived_at IS NULL). Archived rooms grant no access: their enrollments are
 * frozen by M4, so counting them would expose a former Student's new results indefinitely. A removed Student has no
 * enrollment row. Independent Learners, other Teachers' Students and unenrolled Students are never included.
 * (A Student hiding a room on their own side, m4_student_room_archives, does not end the Teacher's enrollment.)
 */
async function listTeacherDiagnosticResults(teacherId, { getAdmin = getSupabaseAdmin } = {}) {
  if (!teacherId) throw new DiagnosticHistoryError("Approved Teacher access is required.", 403);
  const db = getAdmin();
  const rooms = (await selectRows(
    db.from("rooms").select("id, room_name, teacher_id, archived_at").eq("teacher_id", teacherId).is("archived_at", null),
    "your Learning Rooms",
  )).filter((room) => room.teacher_id === teacherId && room.archived_at == null); // re-checked in code
  if (!rooms.length) return { students: [] };

  const roomById = new Map(rooms.map((room) => [room.id, room]));
  const enrollments = [];
  const roomIds = [...roomById.keys()];
  for (let i = 0; i < roomIds.length; i += BATCH) {
    enrollments.push(...await selectRows(
      db.from("enrollments").select("room_id, student_id").in("room_id", roomIds.slice(i, i + BATCH)),
      "Learning Room enrollments",
    ));
  }
  const roomsByStudent = new Map();
  for (const enrollment of enrollments) {
    const room = roomById.get(enrollment.room_id);
    if (!room) continue;
    const list = roomsByStudent.get(enrollment.student_id) ?? [];
    list.push({ id: room.id, name: room.room_name });
    roomsByStudent.set(enrollment.student_id, list);
  }
  const candidateIds = [...roomsByStudent.keys()];
  const profiles = [];
  for (let i = 0; i < candidateIds.length; i += BATCH) {
    profiles.push(...await selectRows(
      db.from("profiles").select("id, role, full_name, nickname").in("id", candidateIds.slice(i, i + BATCH)).eq("role", "student"),
      "Student profiles",
    ));
  }
  // Only Student accounts: an Independent Learner (or any other role) is never shown, even if it were enrolled.
  const students = profiles.filter((profile) => profile.role === "student" && roomsByStudent.has(profile.id));
  const allowed = new Set(students.map((student) => student.id));
  const resultsByStudent = new Map();
  const allowedRows = (await loadResultsFor(db, [...allowed])).filter((row) => allowed.has(row.user_id));
  const titled = await withTitles(db, allowedRows.map(toHistoryEntry));
  allowedRows.forEach((row, index) => {
    const list = resultsByStudent.get(row.user_id) ?? [];
    list.push(titled[index]);
    resultsByStudent.set(row.user_id, list);
  });

  return {
    students: students.map((student) => ({
      id: student.id,
      name: getProfileDisplayName({ role: student.role, nickname: student.nickname, fullName: student.full_name }) || "Student",
      rooms: roomsByStudent.get(student.id).sort((a, b) => a.name.localeCompare(b.name)),
      results: (resultsByStudent.get(student.id) ?? []).sort(newestFirst),
    })).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
  };
}

/**
 * School Admin: every Student of the School Admin's own school (M1 multi-tenancy; schoolId read from the database
 * profile) and their results. Independent Learners are excluded from school reporting. Fails closed without a school.
 */
async function listSchoolStudentResults({ getAdmin = getSupabaseAdmin, schoolId } = {}) {
  if (!schoolId) throw new DiagnosticHistoryError("Your School Admin account is not assigned to a school.", 403);
  const db = getAdmin();
  const profiles = (await selectRows(db.from("profiles").select("id, role, full_name, nickname, school_id").eq("role", "student").eq("school_id", schoolId), "Student profiles"))
    .filter((p) => p.role === "student" && p.school_id === schoolId);
  const allowed = new Set(profiles.map((p) => p.id));
  const rows = (await loadResultsFor(db, [...allowed])).filter((row) => allowed.has(row.user_id));
  const titled = await withTitles(db, rows.map(toHistoryEntry));
  const byStudent = new Map();
  rows.forEach((row, index) => {
    const list = byStudent.get(row.user_id) ?? [];
    list.push(titled[index]);
    byStudent.set(row.user_id, list);
  });
  // F3/F5 room filter: each Student's ACTIVE Learning Rooms (archived rooms are left out, as for Teachers). A Student
  // in no active room is still listed (rooms: []). Only room ids and names are read.
  const rooms = (await selectRows(db.from("rooms").select("id, room_name, archived_at, teacher_id").is("archived_at", null), "Learning Rooms"))
    .filter((room) => room.archived_at == null);
  // Only this school's rooms (their Teacher belongs to the school).
  const teachers = await require("./schoolScope").filterSchoolMembers(schoolId, rooms.map((room) => room.teacher_id), { getAdmin });
  const schoolRooms = rooms.filter((room) => teachers.has(room.teacher_id));
  const roomById = new Map(schoolRooms.map((room) => [room.id, room]));
  const roomsByStudent = new Map();
  const roomIds = [...roomById.keys()];
  for (let i = 0; i < roomIds.length; i += BATCH) {
    for (const enrollment of await selectRows(
      db.from("enrollments").select("room_id, student_id").in("room_id", roomIds.slice(i, i + BATCH)), "Learning Room enrollments")) {
      const room = roomById.get(enrollment.room_id);
      if (!room || !allowed.has(enrollment.student_id)) continue;
      const list = roomsByStudent.get(enrollment.student_id) ?? [];
      list.push({ id: room.id, name: room.room_name });
      roomsByStudent.set(enrollment.student_id, list);
    }
  }
  return profiles.map((p) => ({
    id: p.id,
    name: getProfileDisplayName({ role: p.role, nickname: p.nickname, fullName: p.full_name }) || "Student",
    rooms: (roomsByStudent.get(p.id) ?? []).sort((a, b) => a.name.localeCompare(b.name)),
    results: (byStudent.get(p.id) ?? []).sort(newestFirst),
  })).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

module.exports = {
  DiagnosticHistoryError,
  listSchoolStudentResults,
  HISTORY_COLUMNS,
  listOwnDiagnosticHistory,
  listTeacherDiagnosticResults,
  newestFirst,
  toHistoryEntry,
};
