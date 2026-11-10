const { reportRows } = require("./weeklyReportRows");
const { loadMaterialReadingSource } = require("./personalMaterialService");
const { ARCHIVED_CLASSROOM_CODE, ARCHIVED_CLASSROOM_MESSAGE, isArchivedRoomDatabaseError, isRoomArchived } = require("./roomArchive");
const { getReadingWords, scorePassage } = require("./oralReadingScoring");
const { loadComprehensionForOralAttempts } = require("./teacherComprehensionReview");
const { verifySavedReading } = require("./readingVerification");
const {
  SupabaseAuthenticationError,
  getAuthenticatedSupabaseUser,
  getSupabaseAdmin,
} = require("./supabaseAdmin");

const LEARNER_ROLES = Object.freeze(["student", "general_user"]);
const SELF_PRACTICE_ROLES = Object.freeze([...LEARNER_ROLES, "admin"]);
// M5/M6 reading practice also admits APPROVED Teachers (shared published catalog, own results only).
// M2 diagnostic speech keeps SELF_PRACTICE_ROLES, so Teachers gain no diagnostic access.
const READING_PRACTICE_ROLES = Object.freeze([...SELF_PRACTICE_ROLES, "teacher"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_RECORDING_SECONDS = 300;
const MAX_TRANSCRIPT_LENGTH = 100000;

class OralReadingAuthorizationError extends Error {
  constructor(message = "This oral-reading activity is not available to your account.") {
    super(message);
    this.name = "OralReadingAuthorizationError";
    this.statusCode = 403;
  }
}

class OralReadingPersistenceError extends Error {
  constructor(message, statusCode = 500, code = "ORAL_READING_OPERATION_FAILED") {
    super(message);
    this.name = "OralReadingPersistenceError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function requireUuid(value, label) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new OralReadingPersistenceError(`${label} is invalid.`, 400, "INVALID_ID");
  }
  return value;
}

function normalizeLanguage(value) {
  const language = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (["fil", "filipino", "tagalog", "fil-ph", "tl", "tl-ph"].includes(language)) return "fil";
  if (["en", "english"].includes(language)) return "en";
  throw new OralReadingPersistenceError(
    "The module language is not supported for oral reading.",
    422,
    "UNSUPPORTED_LANGUAGE",
  );
}

const getNormalizedWords = getReadingWords;

async function authorizeOralReadingRequest(req, dependencies = {}) {
  return authorizeRequesterRole(req, dependencies, LEARNER_ROLES);
}

// M5 self-practice only (own published-module read-alouds, results and recordings).
// Classroom, assigned-material and M6/M7 learner routes keep authorizeOralReadingRequest.
async function authorizeOralReadingPracticeRequest(req, dependencies = {}) {
  return authorizeRequesterRole(req, dependencies, SELF_PRACTICE_ROLES);
}

// M5 read-aloud and M6 comprehension practice: the self-practice roles plus APPROVED Teachers.
// Pending, rejected or other Teachers are refused here, before any module, attempt or speech call.
async function authorizeReadingPracticeRequest(req, dependencies = {}) {
  return authorizeRequesterRole(req, dependencies, READING_PRACTICE_ROLES);
}

const isApprovedTeacher = (requester) =>
  requester?.profile?.role === "teacher" && requester.profile.teacher_status === "approved";

async function authorizeRequesterRole(req, dependencies, roles) {
  const authenticate = dependencies.getAuthenticatedSupabaseUser
    ?? getAuthenticatedSupabaseUser;
  const getAdmin = dependencies.getSupabaseAdmin ?? getSupabaseAdmin;
  const user = await authenticate(req);
  const { data: profile, error } = await getAdmin()
    .from("profiles")
    .select("id, full_name, nickname, role, teacher_status")
    .eq("id", user.id)
    .single();

  if (error || !profile) {
    console.error("[M5 profile lookup failed]", {
      code: error?.code,
      message: error?.message,
      details: error?.details,
      profileFound: Boolean(profile),
    });
    throw new OralReadingPersistenceError(
      "Unable to load your account profile. Check the backend terminal.",
      500,
      "PROFILE_LOOKUP_FAILED",
    );
  }
  if (!roles.includes(profile.role)) throw new OralReadingAuthorizationError();
  if (profile.role === "teacher" && profile.teacher_status !== "approved") {
    throw new OralReadingAuthorizationError("Approved Teacher access is required.");
  }
  return { user, profile };
}

async function authorizeTeacherOralReadingRequest(req, dependencies = {}) {
  const authenticate = dependencies.getAuthenticatedSupabaseUser
    ?? getAuthenticatedSupabaseUser;
  const getAdmin = dependencies.getSupabaseAdmin ?? getSupabaseAdmin;
  const user = await authenticate(req);
  const { data: profile, error } = await getAdmin()
    .from("profiles")
    .select("id, full_name, nickname, role, teacher_status")
    .eq("id", user.id)
    .single();

  if (error || !profile) throw new SupabaseAuthenticationError();
  if (profile.role !== "teacher" || profile.teacher_status !== "approved") {
    throw new OralReadingAuthorizationError("Approved Teacher access is required.");
  }
  return { user, profile };
}

async function loadAccessiblePublishedModule(requester, moduleId, dependencies = {}, context = {}) {
  requireUuid(moduleId, "The module ID");
  const supabase = dependencies.getSupabaseAdmin?.() ?? getSupabaseAdmin();
  const { data: moduleRow, error } = await supabase
    .from("modules")
    .select("id, path_id, title, difficulty, status, passage, deleted_at, created_by")
    .eq("id", moduleId)
    .maybeSingle();

  if (error) throw new OralReadingPersistenceError("Unable to load the reading module.");
  if (!moduleRow) {
    throw new OralReadingPersistenceError("Reading module not found.", 404, "MODULE_NOT_FOUND");
  }
  if (moduleRow.deleted_at || moduleRow.status !== "published") {
    throw new OralReadingAuthorizationError("This reading module is not available for oral reading.");
  }

  let roomId = null;
  let assignmentId = null;
  if (requester.profile.role === "student") {
    const { data: enrolled, error: enrolledError } = await supabase.from("enrollments")
      .select("room_id").eq("student_id", requester.user.id);
    if (enrolledError) throw new OralReadingPersistenceError("Unable to verify classroom enrollment.");
    const rooms = (enrolled ?? []).map(row => row.room_id);
    if (context.roomId) requireUuid(context.roomId, "The classroom ID");
    if (context.assignmentId) requireUuid(context.assignmentId, "The assignment ID");
    if (!rooms.length || (context.roomId && !rooms.includes(context.roomId))) {
      throw new OralReadingAuthorizationError();
    }
    // "*" keeps working before and after the optional removed_at column exists.
    let query = supabase.from("room_modules").select("*")
      .eq("module_id", moduleId).in("room_id", rooms);
    if (context.roomId) query = query.eq("room_id", context.roomId);
    if (context.assignmentId) query = query.eq("id", context.assignmentId);
    const { data: rows, error: assignmentError } = await query;
    if (assignmentError) {
      throw new OralReadingPersistenceError("Unable to verify the classroom assignment.");
    }
    // A removed module cannot be started again; saved results stay in Reading History.
    const active = (rows ?? []).filter(row => !row.removed_at);
    if (rows?.length && !active.length) {
      throw new OralReadingAuthorizationError(
        "Your teacher removed this module from the classroom. Your saved results are still in Reading History.",
      );
    }
    // Selected-student assignments (proposed m4_module_recipients): only recipients may start them.
    // Rows have no targeting_mode before that migration, so nothing changes until it is installed;
    // the database also rejects a non-recipient's attempt for every writer.
    const targeted = active.filter(row => row.targeting_mode === "selected_students");
    let recipientOf = new Set();
    if (targeted.length) {
      const { data: recipients, error: recipientError } = await supabase.from("room_module_recipients")
        .select("room_module_id").eq("student_id", requester.user.id).in("room_module_id", targeted.map(row => row.id));
      if (recipientError) throw new OralReadingPersistenceError("Unable to verify the classroom assignment.");
      recipientOf = new Set((recipients ?? []).map(row => row.room_module_id));
    }
    const assignments = active.filter(row => row.targeting_mode !== "selected_students" || recipientOf.has(row.id));
    if (active.length && !assignments.length) {
      throw new OralReadingAuthorizationError(
        "Your teacher assigned this module to selected students only.",
      );
    }
    if (!assignments.length) {
      throw new OralReadingAuthorizationError(
        "This module must be assigned in a classroom where you are enrolled.",
      );
    }
    if (assignments.length > 1) {
      throw new OralReadingPersistenceError(
        "Open this activity from its classroom to select the assignment.",
        400,
        "CLASSROOM_REQUIRED",
      );
    }
    roomId = assignments[0].room_id;
    assignmentId = assignments[0].id;
  } else if (
    !(["general_user", "admin"].includes(requester.profile.role) || isApprovedTeacher(requester))
    || context.roomId || context.assignmentId
  ) {
    // Admin and approved-Teacher practice, like general users, read published modules outside any classroom.
    throw new OralReadingAuthorizationError();
  } else if (requester.profile.role === "admin" && moduleRow.created_by !== requester.user.id) {
    // Admin practice (M5 and M6) is a test of the Admin's own published modules only.
    throw new OralReadingAuthorizationError("Admin practice is available only for published modules you created.");
  }

  if (context.passageId) requireUuid(context.passageId, "The passage ID");
  const { data: passages, error: passageError } = await supabase.from("module_passages")
    .select("id, title, passage_text, display_order").eq("module_id", moduleId);

  // Only a genuinely absent legacy table permits fallback.
  if (passageError && !["42P01", "PGRST205"].includes(passageError.code)) {
    throw new OralReadingPersistenceError("Unable to load the selected passage.");
  }

  const available = passages ?? [];
  let selected = context.passageId ? available.find(row => row.id === context.passageId)
    : available.length === 1 ? available[0] : null;

  if (!selected && available.length) {
    throw new OralReadingPersistenceError(
      "Select a valid passage in this module.",
      400,
      "PASSAGE_REQUIRED",
    );
  }
  if (!selected && context.passageId && context.passageId !== moduleId) {
    throw new OralReadingAuthorizationError();
  }

  const passage = selected?.passage_text ?? moduleRow.passage;
  if (!passage?.trim()) {
    throw new OralReadingPersistenceError("The selected passage has no readable text.", 422);
  }

  const { data: path, error: pathError } = await supabase
    .from("learning_paths")
    .select("id, path_name, language")
    .eq("id", moduleRow.path_id)
    .maybeSingle();

  if (pathError || !path) {
    throw new OralReadingPersistenceError("Unable to load the module learning path.");
  }

  return {
    id: moduleRow.id,
    title: moduleRow.title,
    difficulty: moduleRow.difficulty,
    passage: passage.trim(),
    passageId: selected?.id ?? null,
    passageTitle: selected?.title ?? moduleRow.title,
    roomId,
    assignmentId,
    learningPath: path.path_name,
    language: normalizeLanguage(path.language),
  };
}

function buildAttemptInsert(requester, module, body) {
  const transcript = typeof body?.transcript === "string" ? body.transcript.trim() : "";
  const durationSeconds = Number(body?.durationSeconds);
  const sttConfidence = body?.sttConfidence == null ? null : Number(body.sttConfidence);

  if (!transcript || transcript.length > MAX_TRANSCRIPT_LENGTH) {
    throw new OralReadingPersistenceError(
      "A valid read-aloud transcript is required.",
      400,
      "INVALID_TRANSCRIPT",
    );
  }
  if (
    !Number.isFinite(durationSeconds)
    || durationSeconds <= 0
    || durationSeconds > MAX_RECORDING_SECONDS
  ) {
    throw new OralReadingPersistenceError(
      "Recording duration must be between 0 and 300 seconds.",
      400,
      "INVALID_DURATION",
    );
  }
  if (
    sttConfidence !== null
    && (!Number.isFinite(sttConfidence) || sttConfidence < 0 || sttConfidence > 1)
  ) {
    throw new OralReadingPersistenceError(
      "Speech-recognition confidence is invalid.",
      400,
      "INVALID_CONFIDENCE",
    );
  }

  let scoring;
  try {
    // The title the read-aloud screen shows (ReadAloudPage), so a title line it
    // hides from the story is not scored. passage_snapshot keeps the full text.
    scoring = scorePassage(module.passage, transcript, module.language, module.passageTitle || module.title);
  } catch (error) {
    if (error.code === "SCORING_LIMIT") {
      throw new OralReadingPersistenceError(error.message, 422, error.code);
    }
    throw error;
  }

  const { expectedWords, spokenWords, wordMetrics } = scoring;
  if (!spokenWords.length) {
    throw new OralReadingPersistenceError(
      "The transcript contains no recognized words.",
      400,
      "INVALID_TRANSCRIPT",
    );
  }
  if (expectedWords.length === 0) {
    throw new OralReadingPersistenceError("The selected module has no readable passage.", 422);
  }

  const detectedErrorCount = wordMetrics.filter((metric) => metric.type !== "match").length;
  const pronunciationAccuracy = Math.min(
    100,
    Math.max(0, ((expectedWords.length - detectedErrorCount) / expectedWords.length) * 100),
  );
  const readingSpeedWpm = (spokenWords.length / durationSeconds) * 60;

  return {
    user_id: requester.user.id,
    module_id: module.id,
    ...(module.materialId ? { material_id: module.materialId, activity_assignment_id: module.activityAssignmentId } : {}),
    passage_id: module.passageId ?? null,
    passage_title_snapshot: module.passageTitle ?? module.title,
    module_title_snapshot: module.title,
    language_snapshot: module.language,
    room_id: module.roomId ?? null,
    assignment_id: module.assignmentId ?? null,
    submission_id: body.submissionId == null
      ? null
      : requireUuid(body.submissionId, "The submission ID"),
    scoring_version: 2,
    passage_snapshot: module.passage,
    transcript,
    duration_seconds: durationSeconds,
    reading_speed_wpm: readingSpeedWpm,
    pronunciation_accuracy: pronunciationAccuracy,
    expected_word_count: expectedWords.length,
    detected_error_count: detectedErrorCount,
    word_metrics: wordMetrics,
    stt_confidence: sttConfidence,
  };
}

function toAttemptDto(row, module) {
  return {
    id: row.id,
    userId: row.user_id,
    moduleId: row.module_id,
    materialId: row.material_id ?? null,
    activityAssignmentId: row.activity_assignment_id ?? null,
    readAloudOnly: module.readAloudOnly === true,
    readAloudCompleted: module.readAloudOnly === true && module.activityStatus === "completed",
    moduleTitle: row.module_title_snapshot ?? module.title,
    language: row.language_snapshot ?? module.language,
    passageId: row.passage_id ?? null,
    passageTitle: row.passage_title_snapshot ?? module.title,
    passageSnapshot: row.passage_snapshot,
    roomId: row.room_id ?? null,
    assignmentId: row.assignment_id ?? null,
    scoringVersion: row.scoring_version ?? 1,
    transcript: row.transcript,
    durationSeconds: Number(row.duration_seconds),
    readingSpeedWpm: Number(row.reading_speed_wpm),
    pronunciationAccuracy: Number(row.pronunciation_accuracy),
    expectedWordCount: row.expected_word_count,
    detectedErrorCount: row.detected_error_count,
    wordMetrics: row.word_metrics,
    sttConfidence: row.stt_confidence == null ? null : Number(row.stt_confidence),
    completedAt: row.completed_at,
  };
}

// Called only after the attempt owner has been verified. Reading historical
// results does not require current enrollment and never changes assignments.
async function loadAttemptAssignmentMode(supabase, row, requester) {
  if (!row.material_id || !row.activity_assignment_id) return {};
  const { data: assignment, error } = await supabase.from("reading_activity_assignments")
    .select("read_aloud_only,status").eq("id", row.activity_assignment_id)
    .eq("student_id", requester.user.id).eq("material_id", row.material_id)
    .eq("room_id", row.room_id).maybeSingle();
  if (error) throw new OralReadingPersistenceError("Unable to verify the activity mode.");
  return { readAloudOnly: assignment?.read_aloud_only === true, activityStatus: assignment?.status };
}

async function createOralReadingAttempt(requester, body, dependencies = {}) {
  const materialId = body?.materialId;
  const moduleId = materialId ? null : requireUuid(body?.moduleId, "The module ID");
  if (materialId) requireUuid(materialId, "The material ID");
  if (!materialId && body.activityAssignmentId) {
    throw new OralReadingPersistenceError("Material and module references cannot be combined.", 400);
  }
  function verifyRetry(existing) {
    if (materialId && (existing.material_id !== materialId || (existing.activity_assignment_id ?? null) !== (body.activityAssignmentId ?? null) || (existing.room_id ?? null) !== (body.roomId ?? null) || body.moduleId || body.passageId || body.assignmentId)) {
      throw new OralReadingPersistenceError("This submission ID belongs to another activity.", 409);
    }
    if (!materialId && (existing.material_id || existing.module_id !== moduleId
      || (body.roomId && existing.room_id !== body.roomId)
      || (body.assignmentId && existing.assignment_id !== body.assignmentId)
      || (body.passageId && (existing.passage_id ?? moduleId) !== body.passageId))) {
      throw new OralReadingPersistenceError("This submission ID belongs to another activity.", 409);
    }
  }
  const supabase = dependencies.getSupabaseAdmin?.() ?? getSupabaseAdmin();
  const verifyReading = dependencies.verifySavedReading ?? verifySavedReading;

  if (body.submissionId != null) {
    requireUuid(body.submissionId, "The submission ID");
    const { data: existing, error: existingError } = await supabase
      .from("oral_reading_attempts")
      .select("*")
      .eq("user_id", requester.user.id)
      .eq("submission_id", body.submissionId)
      .maybeSingle();

    if (existingError) {
      throw new OralReadingPersistenceError("Unable to check the previous save.");
    }
    if (existing) {
      verifyRetry(existing);
      await verifyReading(requester, existing, dependencies);
      return toAttemptDto(existing, {
        title: existing.module_title_snapshot,
        language: existing.language_snapshot,
        ...await loadAttemptAssignmentMode(supabase, existing, requester),
      });
    }
  }

  const module = materialId
    ? await loadMaterialReadingSource(requester, materialId, body, dependencies)
    : await loadAccessiblePublishedModule(requester, moduleId, dependencies, body);
  if (materialId && body.passageRevision !== module.passageRevision) {
    throw new OralReadingPersistenceError("This story changed. Reload it and record the current story before saving.", 409);
  }
  // Checked on every save, so a reading page opened before the room was archived cannot save afterwards.
  if (await (dependencies.isRoomArchived ?? isRoomArchived)(supabase, module.roomId)) {
    throw new OralReadingPersistenceError(ARCHIVED_CLASSROOM_MESSAGE, 409, ARCHIVED_CLASSROOM_CODE);
  }
  const payload = buildAttemptInsert(requester, module, body);
  const { data, error } = await supabase
    .from("oral_reading_attempts")
    .insert(payload)
    .select("*")
    .single();

  if (error?.code === "23505" && body.submissionId) {
    const { data: existing, error: lookupError } = await supabase
      .from("oral_reading_attempts")
      .select("*")
      .eq("user_id", requester.user.id)
      .eq("submission_id", body.submissionId)
      .maybeSingle();

    if (!lookupError && existing) {
      verifyRetry(existing);
      await verifyReading(requester, existing, dependencies);
      return toAttemptDto(existing, module);
    }
  }

  // The database refused it: the room was archived while this request was in flight.
  if (isArchivedRoomDatabaseError(error)) {
    throw new OralReadingPersistenceError(ARCHIVED_CLASSROOM_MESSAGE, 409, ARCHIVED_CLASSROOM_CODE);
  }
  if (error || !data) {
    throw new OralReadingPersistenceError(
      "Your result could not be saved. Please try again.",
      500,
      "ATTEMPT_SAVE_FAILED",
    );
  }
  await verifyReading(requester, data, dependencies);
  return toAttemptDto(data, module);
}

async function loadAttemptModuleMetadata(supabase, moduleId) {
  const { data: moduleRow, error } = await supabase
    .from("modules")
    .select("id, path_id, title")
    .eq("id", moduleId)
    .maybeSingle();

  if (error || !moduleRow) {
    throw new OralReadingPersistenceError("Unable to load the result's reading module.");
  }

  const { data: path, error: pathError } = await supabase
    .from("learning_paths")
    .select("id, language")
    .eq("id", moduleRow.path_id)
    .maybeSingle();

  if (pathError || !path) {
    throw new OralReadingPersistenceError("Unable to load the result's module language.");
  }
  return { title: moduleRow.title, language: normalizeLanguage(path.language) };
}

// Every review read pages through all rows (M7) so a server row cap cannot truncate a class.
// Interactive review keeps the M5 error types and messages; weekly reports (`complete`) keep
// the report error so generation aborts instead of saving partial data.
async function selectReviewRows(supabase, complete, table, columns, filters, batchColumn, ids, message) {
  try {
    return await reportRows(supabase, table, columns, filters, batchColumn, ids);
  } catch (error) {
    if (complete) throw error;
    throw new OralReadingPersistenceError(message);
  }
}

async function loadTeacherStudentProfiles(supabase, teacherId, complete = false) {
  const rooms = await selectReviewRows(supabase, complete, "rooms", "id", { teacher_id: teacherId }, null, [],
    "Unable to load your classrooms.");

  const roomIds = (rooms ?? []).map((room) => room.id);
  if (roomIds.length === 0) return new Map();

  const enrollments = await selectReviewRows(supabase, complete, "enrollments", "id,student_id,room_id", {}, "room_id", roomIds,
    "Unable to load classroom enrollments.");

  const enrolledIds = [...new Set((enrollments ?? []).map((row) => row.student_id))];
  if (enrolledIds.length === 0) return new Map();

  const profiles = await selectReviewRows(supabase, complete, "profiles", "id,full_name,nickname,role", {}, "id", enrolledIds,
    "Unable to load enrolled student profiles.");

  const result = new Map(
    (profiles ?? [])
      .filter((profile) => profile.role === "student")
      .map((profile) => [profile.id, profile]),
  );
  result.roomsByStudent = new Map();
  for (const enrollment of enrollments ?? []) {
    if (!result.has(enrollment.student_id)) continue;
    const rooms = result.roomsByStudent.get(enrollment.student_id) ?? new Set();
    rooms.add(enrollment.room_id);
    result.roomsByStudent.set(enrollment.student_id, rooms);
  }
  return result;
}

async function loadModuleReviewMetadata(supabase, moduleIds, complete = false) {
  if (moduleIds.length === 0) return new Map();

  const modules = await selectReviewRows(supabase, complete, "modules", "id,title,difficulty", {}, "id", moduleIds,
    "Unable to load attempt module details.");
  return new Map((modules ?? []).map((module) => [module.id, module]));
}

function toTeacherAttemptSummary(row, student, module) {
  return {
    id: row.id,
    learnerId: student.id,
    roomId: row.room_id ?? null,
    learnerName: student.nickname?.trim() || student.full_name?.trim() || "Unnamed student",
    moduleId: row.module_id,
    moduleTitle: row.module_title_snapshot ?? module.title,
    passageTitle: row.passage_title_snapshot ?? null,
    scoringVersion: row.scoring_version ?? 1,
    pronunciationAccuracy: Number(row.pronunciation_accuracy),
    readingSpeedWpm: Number(row.reading_speed_wpm),
    detectedErrorCount: row.detected_error_count,
    completedAt: row.completed_at,
  };
}

async function listTeacherOralReadingAttempts(requester, dependencies = {}) {
  const supabase = dependencies.getSupabaseAdmin?.() ?? getSupabaseAdmin();
  const students = await loadTeacherStudentProfiles(supabase, requester.user.id, dependencies.weeklyReportStrict === true);
  const studentIds = [...students.keys()];
  if (studentIds.length === 0) return [];

  const attempts = await selectReviewRows(supabase, dependencies.weeklyReportStrict === true,
    "oral_reading_attempts", "*", {}, "user_id", studentIds, "Unable to load student oral-reading results.");
  attempts.sort((a, b) => Date.parse(b.completed_at) - Date.parse(a.completed_at) || a.id.localeCompare(b.id));
  const moduleIds = [...new Set((attempts ?? []).map((attempt) => attempt.module_id).filter(Boolean))];
  const modules = await loadModuleReviewMetadata(supabase, moduleIds, dependencies.weeklyReportStrict === true);

  const visible = (attempts ?? []).flatMap((attempt) => {
    const student = students.get(attempt.user_id);
    const module = attempt.material_id
      ? { title: attempt.module_title_snapshot, difficulty: "" }
      : modules.get(attempt.module_id);
    if (dependencies.weeklyReportStrict && student && !module && (!attempt.room_id || students.roomsByStudent?.get(attempt.user_id)?.has(attempt.room_id))) {
      throw new OralReadingPersistenceError("Required report module metadata is missing.");
    }
    return student && module && (!attempt.room_id || students.roomsByStudent?.get(attempt.user_id)?.has(attempt.room_id))
      ? [{ attempt, student, module }]
      : [];
  });
  // Only already-authorized attempts are passed to the comprehension lookup.
  const comprehension = dependencies.weeklyReportSeparateQuizzes ? new Map() : await loadComprehensionForOralAttempts(
    supabase, visible.map(({ attempt }) => attempt), { strict: dependencies.weeklyReportStrict === true },
  );
  return visible.map(({ attempt, student, module }) => ({
    ...toTeacherAttemptSummary(attempt, student, module),
    comprehension: comprehension.get(attempt.id) ?? { status: dependencies.weeklyReportSeparateQuizzes ? "not_applicable" : "unavailable" },
  }));
}

async function getTeacherOralReadingAttempt(requester, attemptId, dependencies = {}) {
  if (typeof attemptId !== "string" || !UUID_PATTERN.test(attemptId)) {
    throw new OralReadingPersistenceError(
      "Oral-reading result not found.",
      404,
      "ATTEMPT_NOT_FOUND",
    );
  }

  const supabase = dependencies.getSupabaseAdmin?.() ?? getSupabaseAdmin();
  const students = await loadTeacherStudentProfiles(supabase, requester.user.id);
  const { data: attempt, error } = await supabase
    .from("oral_reading_attempts")
    .select("*")
    .eq("id", attemptId)
    .maybeSingle();

  if (error) {
    throw new OralReadingPersistenceError("Unable to load the oral-reading result.");
  }

  const student = attempt ? students.get(attempt.user_id) : undefined;
  if (!attempt || !student || (attempt.room_id && !students.roomsByStudent?.get(attempt.user_id)?.has(attempt.room_id))) {
    throw new OralReadingPersistenceError(
      "Oral-reading result not found.",
      404,
      "ATTEMPT_NOT_FOUND",
    );
  }

  const modules = await loadModuleReviewMetadata(supabase, attempt.module_id ? [attempt.module_id] : []);
  const module = attempt.material_id ? { title: attempt.module_title_snapshot, difficulty: "" } : modules.get(attempt.module_id);
  if (!module) {
    throw new OralReadingPersistenceError("Unable to load the attempt module details.");
  }

  const comprehension = await loadComprehensionForOralAttempts(
    supabase, [attempt], { includeDetail: true },
  );
  return {
    ...toTeacherAttemptSummary(attempt, student, module),
    comprehension: comprehension.get(attempt.id) ?? { status: "unavailable" },
    difficulty: module.difficulty,
    // Null for attempts saved before the language snapshot existed.
    language: attempt.language_snapshot === "fil" || attempt.language_snapshot === "en" ? attempt.language_snapshot : null,
    expectedWordCount: attempt.expected_word_count,
    passageSnapshot: attempt.passage_snapshot,
    transcript: attempt.transcript,
    wordMetrics: attempt.word_metrics,
  };
}

async function getOralReadingAttempt(requester, attemptId, dependencies = {}) {
  requireUuid(attemptId, "The attempt ID");
  const supabase = dependencies.getSupabaseAdmin?.() ?? getSupabaseAdmin();
  const { data: row, error } = await supabase
    .from("oral_reading_attempts")
    .select("*")
    .eq("id", attemptId)
    .maybeSingle();

  if (error) {
    throw new OralReadingPersistenceError("Unable to load the oral-reading result.");
  }
  if (!row) {
    throw new OralReadingPersistenceError(
      "Oral-reading result not found.",
      404,
      "ATTEMPT_NOT_FOUND",
    );
  }
  if (row.user_id !== requester.user.id) {
    throw new OralReadingAuthorizationError(
      "This oral-reading result is not available to your account.",
    );
  }

  const module = row.module_title_snapshot && row.language_snapshot
    ? { title: row.module_title_snapshot, language: row.language_snapshot }
    : await loadAttemptModuleMetadata(supabase, row.module_id);

  Object.assign(module, await loadAttemptAssignmentMode(supabase, row, requester));
  return toAttemptDto(row, module);
}

async function listOwnOralReadingAttempts(requester, moduleId, dependencies = {}, context = {}) {
  if (context.materialId) requireUuid(context.materialId, "The material ID");
  if (context.activityAssignmentId) requireUuid(context.activityAssignmentId, "The reading assignment ID");
  if (moduleId !== undefined) requireUuid(moduleId, "The module ID");
  const supabase = dependencies.getSupabaseAdmin?.() ?? getSupabaseAdmin();
  const rows = [];
  const pageSize = 100;
  for (let offset = 0; ; offset += pageSize) {
    let query = supabase.from("oral_reading_attempts")
      .select("id, module_id, material_id, activity_assignment_id, passage_id, room_id, assignment_id, module_title_snapshot, passage_title_snapshot, language_snapshot, completed_at, pronunciation_accuracy, reading_speed_wpm, detected_error_count")
      .eq("user_id", requester.user.id);
    if (moduleId) query = query.eq("module_id", moduleId);
    if (context.materialId) query = query.eq("material_id", context.materialId);
    if (context.activityAssignmentId) query = query.eq("activity_assignment_id", context.activityAssignmentId);
    const { data, error } = await query.order("completed_at", { ascending: false })
      .order("id", { ascending: false }).range(offset, offset + pageSize - 1);
    if (error) throw new OralReadingPersistenceError("Unable to load your saved results.");
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
  }
  // F7: saved English pronunciation-check scores. Optional: history still loads
  // without them (for example before the pronunciation-check table exists).
  const english = rows.filter(row => row.language_snapshot !== "fil").map(row => row.id);
  const { loadSavedPronunciationScores } = require("./pronunciationCheckService");
  const pronunciation = english.length
    ? await loadSavedPronunciationScores(supabase, requester.user.id, english)
    : new Map();
  return rows.map(row => ({
    id: row.id,
    moduleId: row.module_id,
    // The saved reading's source, used to reopen its comprehension activity.
    materialId: row.material_id ?? null,
    activityAssignmentId: row.activity_assignment_id ?? null,
    passageId: row.passage_id ?? null,
    roomId: row.room_id ?? null,
    assignmentId: row.assignment_id ?? null,
    moduleTitle: row.module_title_snapshot ?? "Reading module",
    passageTitle: row.passage_title_snapshot ?? "Reading result",
    language: row.language_snapshot === "fil" || row.language_snapshot === "en" ? row.language_snapshot : null,
    pronunciationAccuracy: Number(row.pronunciation_accuracy),
    readingSpeedWpm: Number(row.reading_speed_wpm),
    detectedErrorCount: row.detected_error_count,
    completedAt: row.completed_at,
    ...(pronunciation?.has(row.id) ? { pronunciationCheck: pronunciation.get(row.id) } : {}),
  }));
}

module.exports = {
  toAttemptDto,
  loadTeacherStudentProfiles,
  listOwnOralReadingAttempts,
  OralReadingAuthorizationError,
  OralReadingPersistenceError,
  authorizeOralReadingRequest,
  authorizeOralReadingPracticeRequest,
  authorizeReadingPracticeRequest,
  authorizeTeacherOralReadingRequest,
  isApprovedTeacher,
  buildAttemptInsert,
  normalizeLanguage,
  createOralReadingAttempt,
  getOralReadingAttempt,
  getTeacherOralReadingAttempt,
  getNormalizedWords,
  loadAccessiblePublishedModule,
  listTeacherOralReadingAttempts,
};
