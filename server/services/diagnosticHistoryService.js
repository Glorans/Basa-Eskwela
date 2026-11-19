const { getSupabaseAdmin } = require("./supabaseAdmin");
const { getProfileDisplayName } = require("./profileNames");

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
    // Rows written by the browser before server verification stay 'unverified' and are labelled as such.
    verified: row.verification_status === "server_verified",
  };
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
  const rows = await selectRows(
    getAdmin().from("diagnostic_results").select(HISTORY_COLUMNS).eq("user_id", userId),
    "your diagnostic results",
  );
  // Defense in depth: the query is already limited to this learner.
  return rows.filter((row) => row.user_id === userId).map(toHistoryEntry).sort(newestFirst);
}

/**
 * Approved Teachers: Students enrolled in the Teacher's own Learning Rooms (including archived rooms, which stay
 * read-only and visible to their Teacher). Independent Learners, other Teachers' Students and unenrolled Students
 * are never included. Rooms are matched on rooms.teacher_id, the same ownership rule M4 and M7 use.
 */
async function listTeacherDiagnosticResults(teacherId, { getAdmin = getSupabaseAdmin } = {}) {
  if (!teacherId) throw new DiagnosticHistoryError("Approved Teacher access is required.", 403);
  const db = getAdmin();
  const rooms = (await selectRows(
    db.from("rooms").select("id, room_name, teacher_id, archived_at").eq("teacher_id", teacherId),
    "your Learning Rooms",
  )).filter((room) => room.teacher_id === teacherId);
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
    list.push({ id: room.id, name: room.room_name, archived: Boolean(room.archived_at) });
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
  for (const row of await loadResultsFor(db, [...allowed])) {
    if (!allowed.has(row.user_id)) continue;
    const list = resultsByStudent.get(row.user_id) ?? [];
    list.push(toHistoryEntry(row));
    resultsByStudent.set(row.user_id, list);
  }

  return {
    students: students.map((student) => ({
      id: student.id,
      name: getProfileDisplayName({ role: student.role, nickname: student.nickname, fullName: student.full_name }) || "Student",
      rooms: roomsByStudent.get(student.id).sort((a, b) => a.name.localeCompare(b.name)),
      results: (resultsByStudent.get(student.id) ?? []).sort(newestFirst),
    })).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
  };
}

module.exports = {
  DiagnosticHistoryError,
  HISTORY_COLUMNS,
  listOwnDiagnosticHistory,
  listTeacherDiagnosticResults,
  newestFirst,
  toHistoryEntry,
};
