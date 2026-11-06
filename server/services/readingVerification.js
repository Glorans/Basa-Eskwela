const { createHash } = require("node:crypto");
const { getSupabaseAdmin } = require("./supabaseAdmin");

// M8 F1 reading evidence. The browser sends the transcript when it saves a reading, so a saved
// reading alone proves nothing. /api/read-aloud/audio records a hash of what Azure returned, bound
// to the signed-in learner, the source and text the server loaded after checking that learner's
// access, and the reading's submission ID. The save consumes one receipt matching all of them, once
// (supabase/proposed/m8_f1_xp_rewards_v1_PROPOSED.sql). A reading without a match is still saved and
// shown; it just earns no XP. Nothing here can stop M5: every failure is logged by class and
// swallowed. Hashes only, so no transcript is stored twice.
const LEARNER_ROLES = new Set(["student", "general_user"]);
// The proposal is not installed yet. Expected before the migration; not worth a log line.
const NOT_INSTALLED_CODES = new Set(["42P01", "42883", "PGRST202", "PGRST205"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTEXT_FIELDS = Object.freeze(["moduleId", "passageId", "roomId", "assignmentId", "materialId", "activityAssignmentId", "submissionId"]);

/** The same text the browser sends back: it collapses whitespace and trims (oralReadingProcessing.ts). */
function transcriptSha256(text) {
  return createHash("sha256").update(String(text).replace(/\s+/g, " ").trim(), "utf8").digest("hex");
}

/** The IDs the page names in the upload's query string. A declaration only; never trusted as access. */
function parseReadingContext(query) {
  const context = {};
  for (const field of CONTEXT_FIELDS) {
    const value = query?.[field];
    if (value === undefined) continue;
    if (typeof value !== "string" || !UUID.test(value)) return null;
    context[field] = value;
  }
  return context.submissionId && (context.materialId || context.moduleId) ? context : null;
}

/** The server's own copy of the passage, through the same access checks as saving a reading. */
async function loadReadingSource(requester, context, dependencies) {
  // Loaded here because oralReadingAttemptService requires this file.
  const { loadAccessiblePublishedModule } = require("./oralReadingAttemptService");
  const { loadAssignedReadingSource } = require("./assignedReadingSource");
  return context.materialId
    ? loadAssignedReadingSource(requester, context.materialId, {
      roomId: context.roomId, activityAssignmentId: context.activityAssignmentId,
    }, dependencies)
    : loadAccessiblePublishedModule(requester, context.moduleId, dependencies, {
      passageId: context.passageId, roomId: context.roomId, assignmentId: context.assignmentId,
    });
}

function reportFailure(log, action, error) {
  if (NOT_INSTALLED_CODES.has(error?.code)) return;
  log(`M5 reading verification: ${action} failed`, { code: error?.code, name: error?.name });
}

/**
 * After a successful M5 transcription, before the reply. Never throws. No receipt without a valid
 * context the learner may access, so an older page or a crafted upload earns no XP but still reads.
 */
async function recordTranscriptReceipt(requester, { language, query }, text, dependencies = {}) {
  const log = dependencies.log ?? console.error;
  try {
    if (!LEARNER_ROLES.has(requester?.profile?.role)) return false;
    const context = parseReadingContext(query);
    if (!context) return false;
    const source = await (dependencies.loadReadingSource ?? loadReadingSource)(requester, context, dependencies);
    if (source.language !== language) return false;
    const supabase = dependencies.getSupabaseAdmin?.() ?? getSupabaseAdmin();
    const { error } = await supabase.rpc("m5_record_transcript_receipt", {
      p_user: requester.user.id,
      p_language: language,
      p_sha256: transcriptSha256(text),
      p_source: source.materialId ?? source.passageId ?? source.id,
      p_passage_text: source.passage,
      p_submission: context.submissionId,
    });
    if (error) { reportFailure(log, "receipt", error); return false; }
    return true;
  } catch (error) {
    // A refused context (403, 404, wrong passage) is an expected "no receipt", not a fault.
    if (error?.statusCode && error.statusCode < 500) return false;
    reportFailure(log, "receipt", error);
    return false;
  }
}

/** After a reading is saved, and again on a save retry (the database call is idempotent). Never throws. */
async function verifySavedReading(requester, attempt, dependencies = {}) {
  const log = dependencies.log ?? console.error;
  try {
    if (!LEARNER_ROLES.has(requester?.profile?.role)) return { verified: false, reason: "not_learner" };
    const supabase = dependencies.getSupabaseAdmin?.() ?? getSupabaseAdmin();
    if (typeof supabase.rpc !== "function") return { verified: false, reason: "unavailable" };
    const { data, error } = await supabase.rpc("m5_verify_reading", {
      p_attempt: attempt.id, p_user: requester.user.id, p_sha256: transcriptSha256(attempt.transcript),
    });
    if (error) { reportFailure(log, "save", error); return { verified: false, reason: "unavailable" }; }
    return data ?? { verified: false, reason: "unavailable" };
  } catch (error) {
    reportFailure(log, "save", error);
    return { verified: false, reason: "unavailable" };
  }
}

module.exports = { parseReadingContext, recordTranscriptReceipt, transcriptSha256, verifySavedReading };
