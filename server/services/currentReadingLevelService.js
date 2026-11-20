// M2: latest OFFICIAL reading classification per learner and language (foundation; not wired into M3 or M8 yet).
// Reads m2_current_reading_level() / m2_initial_diagnostic_completed() from m2_reassessment_foundation_PROPOSED.sql:
//   * only server-verified results count (unverified browser rows, practice and unapproved content never do);
//   * the latest of the initial result and any recorded official reassessment is current, per language;
//   * initial completion means "any server-verified initial result in that language" (no version match), so a future
//     initial version never forces existing learners to retake.
// While no reassessment exists the result equals today's M3 placement source (the server-verified 3.0 initial row).
// M8 keeps reading m2_trusted_reading_level() (initial only) until the adviser decides how reassessments affect M8.
const { getSupabaseAdmin } = require("./supabaseAdmin");

const LANGUAGES = Object.freeze(["en", "fil"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class CurrentReadingLevelError extends Error {
  constructor(message, statusCode = 500, code = "READING_LEVEL_UNAVAILABLE") {
    super(message);
    this.name = "CurrentReadingLevelError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

// PostgREST "function not found" (PGRST202) / Postgres undefined_function (42883): the migration is not applied.
const notInstalled = (error) => error?.code === "PGRST202" || error?.code === "42883";

function validate(userId, language) {
  if (typeof userId !== "string" || !UUID.test(userId)) throw new CurrentReadingLevelError("A learner is required.", 400, "INVALID_LEARNER");
  if (!LANGUAGES.includes(language)) throw new CurrentReadingLevelError("Choose English or Filipino.", 400, "INVALID_LANGUAGE");
}

async function rpc(getAdmin, name, args) {
  const { data, error } = await getAdmin().rpc(name, args);
  if (error) {
    throw notInstalled(error)
      ? new CurrentReadingLevelError("The reading-level lookup is not installed yet.", 503, "READING_LEVEL_NOT_INSTALLED")
      : new CurrentReadingLevelError("Unable to load the reading level.");
  }
  return data;
}

function toLevel(row) {
  if (!row) return null;
  return {
    resultId: row.result_id,
    assessmentType: row.assessment_type,
    readingLevel: row.reading_level,
    difficultyTier: row.difficulty_tier,
    assessmentId: row.assessment_id,
    assessmentVersion: row.assessment_version,
    packageVersionId: row.package_version_id ?? null,
    verifiedAt: row.verified_at,
  };
}

/** The learner's current official classification in one language, or null when there is no verified result. */
async function getCurrentReadingLevel(userId, language, { getAdmin = getSupabaseAdmin } = {}) {
  validate(userId, language);
  const data = await rpc(getAdmin, "m2_current_reading_level", { p_user: userId, p_language: language });
  const row = Array.isArray(data) ? data[0] : data;
  return toLevel(row ?? null);
}

/** Has the learner completed an initial diagnostic in this language (any server-verified version)? */
async function hasCompletedInitialDiagnostic(userId, language, { getAdmin = getSupabaseAdmin } = {}) {
  validate(userId, language);
  return (await rpc(getAdmin, "m2_initial_diagnostic_completed", { p_user: userId, p_language: language })) === true;
}

const ABSENT_COLUMN_CODES = new Set(["42703", "PGRST204", "42P01", "PGRST205"]);
/** The placement switch (adviser decision D1). Not installed or OFF -> false (initial-based placement). */
async function readPlacementSwitch(db) {
  const settings = await db.from("m2_reassessment_settings").select("placement_follows_reassessment").maybeSingle();
  if (settings.error && !ABSENT_COLUMN_CODES.has(settings.error.code)) throw new CurrentReadingLevelError("Unable to load the reading level.");
  return !settings.error && settings.data?.placement_follows_reassessment === true;
}

const PLACEMENT_COLUMNS = "id, user_id, assessment_type, language, assessment_id, assessment_version, reading_level, difficulty_tier, verification_status, verified_at";

/**
 * M3 placement for one language (the learner's own). Today's behaviour is kept exactly while the placement switch
 * (m2_reassessment_settings.placement_follows_reassessment, adviser decision D1) is OFF or not installed:
 *   * completion = an official initial result (the active version, or a permanently valid one such as 3.0);
 *   * level and tier = the latest official INITIAL result in that language.
 * Only when the switch is ON may a recorded official reassessment (m2_current_reading_level) become the placement.
 * F7 Practice Mode stores nothing, so it can never affect this. English and Filipino are always separate.
 */
async function getPlacement(userId, language, { getAdmin = getSupabaseAdmin } = {}) {
  validate(userId, language);
  const { isOfficialInitialResult } = require("./initialDiagnosticCompletion");
  const db = getAdmin();
  const { data: rows, error } = await db.from("diagnostic_results").select(PLACEMENT_COLUMNS)
    .eq("user_id", userId).eq("language", language).eq("assessment_type", "initial").eq("verification_status", "server_verified");
  if (error) throw new CurrentReadingLevelError("Unable to load the reading level.");
  const initial = (rows ?? []).filter((row) => row.user_id === userId && isOfficialInitialResult(row))
    .sort((a, b) => String(b.verified_at).localeCompare(String(a.verified_at)) || String(b.id).localeCompare(String(a.id)))[0];
  if (!initial) return { status: "missing", language };

  const followsReassessment = await readPlacementSwitch(db);

  let source = { row: initial, type: "initial" };
  if (followsReassessment) {
    const current = await getCurrentReadingLevel(userId, language, { getAdmin });
    if (current?.assessmentType === "reassessment") {
      source = { row: { id: current.resultId, reading_level: current.readingLevel, difficulty_tier: current.difficultyTier,
        assessment_id: current.assessmentId, assessment_version: current.assessmentVersion }, type: "reassessment" };
    }
  }
  const { row } = source;
  if (!["Independent", "Instructional", "Frustration"].includes(row.reading_level) || !["Easy", "Medium", "Hard"].includes(row.difficulty_tier)) {
    return { status: "missing", language };
  }
  return {
    status: "ready",
    language,
    readingLevel: row.reading_level,
    difficultyTier: row.difficulty_tier,
    assessmentId: row.assessment_id,
    assessmentVersion: row.assessment_version,
    source: source.type,
    followsReassessment,
  };
}

module.exports = { CurrentReadingLevelError, getCurrentReadingLevel, getPlacement, hasCompletedInitialDiagnostic, readPlacementSwitch, toLevel };
