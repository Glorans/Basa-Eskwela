// Admin "Student Reading Assessments": read-only review of students' saved M5
// oral-reading assessments. See docs/M5_ADMIN_STUDENT_READING_REVIEW.md.
//
// Scope (single-school prototype): every account whose database role is
// "student", enrolled in a classroom or not. Independent Learners, Teachers and
// other Admins are out of scope, and their attempts look exactly like attempts
// that do not exist. This does not define access across schools or organizations.
//
// Every read of one attempt goes through getStudentAttempt, which checks the
// owner's role in the database on each request. Nothing here writes, and nothing
// calls a speech service; reading a saved check never starts a new one.
const { getSupabaseAdmin } = require("./supabaseAdmin");
const { getProfileDisplayName } = require("./profileNames");
const {
  OralReadingPersistenceError,
  toAttemptDto,
} = require("./oralReadingAttemptService");
const { getOralReadingRecording } = require("./oralReadingRecordingService");
const { getSavedPronunciationCheck, loadSavedPronunciationScores } = require("./pronunciationCheckService");

const STUDENT_ROLE = "student";
const PAGE_SIZE = 500;
const PROFILE_BATCH = 100;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SUMMARY_COLUMNS = "id,user_id,module_id,material_id,activity_assignment_id,passage_id,room_id,assignment_id,"
  + "module_title_snapshot,passage_title_snapshot,language_snapshot,completed_at,pronunciation_accuracy,reading_speed_wpm,detected_error_count";

const database = (dependencies) => dependencies.getSupabaseAdmin?.() ?? getSupabaseAdmin();

/** One answer for "malformed", "missing" and "out of scope", so an ID reveals nothing. */
function notFound() {
  return new OralReadingPersistenceError("This saved assessment is not available.", 404, "ASSESSMENT_NOT_FOUND");
}

function unavailable() {
  return new OralReadingPersistenceError("Student reading assessments could not be loaded. Please try again.", 503,
    "STUDENT_READINGS_UNAVAILABLE");
}

async function readAll(build) {
  const rows = [];
  for (let start = 0; ; start += PAGE_SIZE) {
    const { data, error } = await build().range(start, start + PAGE_SIZE - 1);
    if (error) throw unavailable();
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) return rows;
  }
}

const displayName = (profile) => getProfileDisplayName({
  role: profile.role, nickname: profile.nickname, fullName: profile.full_name,
}) || "Unnamed student";

/** The profile of an in-scope student, or null. The role always comes from the database. */
async function loadStudentProfile(supabase, userId) {
  const { data, error } = await supabase.from("profiles").select("id,role,full_name,nickname").eq("id", userId).maybeSingle();
  if (error) throw unavailable();
  return data?.role === STUDENT_ROLE ? data : null;
}

/** Students with at least one saved reading: name and counts only, never emails. */
async function listStudentsWithReadings(dependencies = {}) {
  const supabase = database(dependencies);
  const attempts = await readAll(() => supabase.from("oral_reading_attempts").select("user_id,completed_at").order("id", { ascending: true }));
  const byUser = new Map();
  for (const attempt of attempts) {
    const entry = byUser.get(attempt.user_id) ?? { readingCount: 0, latestCompletedAt: attempt.completed_at };
    entry.readingCount += 1;
    if (Date.parse(attempt.completed_at) > Date.parse(entry.latestCompletedAt)) entry.latestCompletedAt = attempt.completed_at;
    byUser.set(attempt.user_id, entry);
  }
  const ids = [...byUser.keys()];
  const students = [];
  for (let index = 0; index < ids.length; index += PROFILE_BATCH) {
    const { data, error } = await supabase.from("profiles").select("id,role,full_name,nickname")
      .eq("role", STUDENT_ROLE).in("id", ids.slice(index, index + PROFILE_BATCH));
    if (error) throw unavailable();
    // Checked again here, so a query change can never widen the list.
    for (const profile of data ?? []) {
      if (profile.role === STUDENT_ROLE) students.push({ id: profile.id, name: displayName(profile), ...byUser.get(profile.id) });
    }
  }
  return students.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/** One student's saved readings, newest first, in the shape Reading History cards use. */
async function listStudentReadings(studentId, dependencies = {}) {
  if (typeof studentId !== "string" || !UUID_PATTERN.test(studentId)) throw notFound();
  const supabase = database(dependencies);
  const student = await loadStudentProfile(supabase, studentId);
  if (!student) throw notFound();
  const rows = await readAll(() => supabase.from("oral_reading_attempts").select(SUMMARY_COLUMNS)
    .eq("user_id", studentId).order("completed_at", { ascending: false }));
  const scores = await loadSavedPronunciationScores(supabase, studentId, rows.map((row) => row.id));
  return {
    student: { id: student.id, name: displayName(student) },
    attempts: rows.map((row) => ({
      id: row.id,
      moduleId: row.module_id,
      materialId: row.material_id ?? null,
      activityAssignmentId: row.activity_assignment_id ?? null,
      passageId: row.passage_id ?? null,
      roomId: row.room_id ?? null,
      assignmentId: row.assignment_id ?? null,
      moduleTitle: row.module_title_snapshot ?? "Reading module",
      passageTitle: row.passage_title_snapshot ?? "Reading result",
      language: row.language_snapshot === "fil" || row.language_snapshot === "en" ? row.language_snapshot : null,
      completedAt: row.completed_at,
      pronunciationAccuracy: Number(row.pronunciation_accuracy),
      readingSpeedWpm: Number(row.reading_speed_wpm),
      detectedErrorCount: row.detected_error_count,
      ...(scores?.has(row.id) ? { pronunciationCheck: scores.get(row.id) } : {}),
    })),
  };
}

/**
 * The single gate for one attempt: it must exist and its owner's database role
 * must be "student". Otherwise the caller gets the same 404.
 */
async function getStudentAttempt(attemptId, dependencies = {}) {
  if (typeof attemptId !== "string" || !UUID_PATTERN.test(attemptId)) throw notFound();
  const supabase = database(dependencies);
  const { data: row, error } = await supabase.from("oral_reading_attempts").select("*").eq("id", attemptId).maybeSingle();
  if (error) throw unavailable();
  if (!row) throw notFound();
  const student = await loadStudentProfile(supabase, row.user_id);
  if (!student) throw notFound();
  // Saved snapshots only, so a reading still opens after its module is removed. A
  // language that was never saved stays unknown instead of being guessed.
  const attempt = toAttemptDto(row, { title: row.module_title_snapshot ?? "Reading module", language: null });
  return { ...attempt, learnerName: displayName(student) };
}

/** The saved check only. Reading it never starts a new assessment. */
async function getStudentPronunciationCheck(attemptId, dependencies = {}) {
  const attempt = await getStudentAttempt(attemptId, dependencies);
  return getSavedPronunciationCheck(database(dependencies), attempt, (dependencies.now ?? Date.now)());
}

/** Short-lived signed links (existing recording service), issued only after the gate passes. */
async function getStudentRecording(requester, attemptId, dependencies = {}) {
  const load = dependencies.getOralReadingRecording ?? getOralReadingRecording;
  return load(requester, attemptId, true, {
    ...dependencies,
    getTeacherOralReadingAttempt: (_requester, id) => getStudentAttempt(id, dependencies),
  });
}

module.exports = {
  STUDENT_ROLE,
  getStudentAttempt,
  getStudentPronunciationCheck,
  getStudentRecording,
  listStudentReadings,
  listStudentsWithReadings,
};
