// M5 English pronunciation check: one saved, server-computed result per
// oral-reading attempt (table oral_reading_pronunciation_checks, proposed in
// supabase/proposed/m5_pronunciation_checks_PROPOSED.sql).
//
//  - The summary is computed here from the speech service's replies, never
//    from scores sent by the browser.
//  - A "running" claim row is inserted BEFORE the paid assessment. The primary
//    key on attempt_id makes a second, simultaneous request fail to claim, so
//    it never pays for a duplicate assessment.
//  - A completed row is reused and never overwritten (the database also
//    rejects changes to it). A failed or abandoned claim holds no results and
//    may be taken over later.
//  - Before the table exists (migration pending) checks still run, but each
//    result is reported as not saved.
const { randomUUID } = require("node:crypto");
const { OralReadingPersistenceError } = require("./oralReadingAttemptService");

const TABLE = "oral_reading_pronunciation_checks";
const RECORDINGS_TABLE = "oral_reading_recordings";
const SUMMARY_VERSION = 1;
// A running claim is a lease. claimed_at is set when the claim is taken and
// renewed before each further recording part is sent for assessment, so the
// longest legitimate gap between renewals is ONE part's assessment deadline:
// the configured provider timeout (at most 120 s, azureSpeechConfig.js) plus
// half the part's length (at most 305 s / 2, wavAudio.js) = about 273 s, plus
// the final save. A lease not renewed for STALE_CLAIM_MS (over twice that) is
// abandoned, for example after a server crash, and may be taken over.
const MAX_PART_ASSESSMENT_MS = 120_000 + Math.ceil(305_000 / 2);
const STALE_CLAIM_MS = 10 * 60 * 1000;
// Saved recordings hold at most 32 files (oral_reading_recordings check constraint).
const MAX_RECORDING_PARTS = 32;
const MISSING_TABLE_CODES = ["42P01", "PGRST205"];
const PRACTICE_THRESHOLD = 60;
const MAX_PRACTICE_WORDS = 10;
const HISTORY_BATCH = 50;
const SUMMARY_COLUMNS = "attempt_id,user_id,status,claim_id,claimed_at,language,part_count,utterance_count,accuracy,fluency,"
  + "words_to_practice,assessed_seconds,complete,unassessed_seconds,completed_at";

const NOT_SAVED_MESSAGE = "Your pronunciation check finished, but its result could not be saved. "
  + "It is shown here until you leave this page.";
const IN_PROGRESS_MESSAGE = "A pronunciation check for this reading is already running. Please wait a moment.";
const STORE_UNAVAILABLE_MESSAGE = "Saved pronunciation results cannot be checked right now. Please try again.";

class PronunciationCheckInProgressError extends OralReadingPersistenceError {
  constructor() {
    super(IN_PROGRESS_MESSAGE, 409, "PRONUNCIATION_CHECK_IN_PROGRESS");
    this.name = "PronunciationCheckInProgressError";
  }
}

/** The lease could not be renewed: stop before paying for another part. */
class PronunciationCheckInterruptedError extends OralReadingPersistenceError {
  constructor() {
    super("Your pronunciation check was interrupted. Please try again.", 503, "PRONUNCIATION_CHECK_INTERRUPTED");
    this.name = "PronunciationCheckInterruptedError";
  }
}

const RECORDING_MISMATCH_MESSAGE = "Your saved recording could not be matched. Reload this page and try again.";

function storeUnavailable() {
  return new OralReadingPersistenceError(STORE_UNAVAILABLE_MESSAGE, 503, "PRONUNCIATION_STORE_UNAVAILABLE");
}

const isMissingTable = (error) => Boolean(error && MISSING_TABLE_CODES.includes(error.code));

function finiteOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// --- Summary: the same rules the result screen used before results were saved ---

function weightedMean(utterances, pick) {
  let total = 0;
  let weight = 0;
  for (const utterance of utterances) {
    const value = pick(utterance);
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    const words = Math.max(1, utterance.words.length);
    total += value * words;
    weight += words;
  }
  return weight ? Math.round(total / weight) : null;
}

/** Keeps only the known fields of one part's assessment, for storage. */
function sanitizePart(part) {
  const utterances = (Array.isArray(part?.utterances) ? part.utterances : []).map((utterance) => ({
    text: typeof utterance?.text === "string" ? utterance.text.slice(0, 2000) : "",
    accuracy: finiteOrNull(utterance?.accuracy),
    fluency: finiteOrNull(utterance?.fluency),
    words: (Array.isArray(utterance?.words) ? utterance.words : []).map((word) => ({
      word: typeof word?.word === "string" ? word.word.slice(0, 100) : "",
      accuracy: finiteOrNull(word?.accuracy),
      errorType: ["None", "Mispronunciation", "Omission", "Insertion"].includes(word?.errorType) ? word.errorType : null,
    })),
  }));
  const sanitized = { utterances, complete: part?.complete !== false };
  if (finiteOrNull(part?.durationSeconds) !== null) sanitized.durationSeconds = part.durationSeconds;
  if (part?.complete === false) {
    sanitized.unassessedSegments = Number.isInteger(part.unassessedSegments) ? part.unassessedSegments : 0;
    sanitized.unassessedSeconds = finiteOrNull(part.unassessedSeconds);
  }
  return sanitized;
}

/**
 * The learner-facing summary of a whole reading's parts. `partBytes` are the
 * uploaded WAV sizes, used for a part's length only when the service gave none.
 */
function summarizePronunciationParts(parts, partBytes = []) {
  const utterances = parts.flatMap((part) => part.utterances ?? []);
  const practice = new Set();
  for (const utterance of utterances) {
    for (const word of utterance.words) {
      const text = String(word.word ?? "").normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}'-]/gu, "");
      if (!text) continue;
      if (word.errorType === "Mispronunciation"
        || (typeof word.accuracy === "number" && word.accuracy < PRACTICE_THRESHOLD)) practice.add(text);
    }
  }
  let assessedSeconds = 0;
  let unassessedSeconds = 0;
  let unassessedSegments = 0;
  parts.forEach((part, index) => {
    if (part.complete === false) {
      unassessedSegments += part.unassessedSegments ?? 0;
      unassessedSeconds = unassessedSeconds === null || typeof part.unassessedSeconds !== "number"
        ? null : unassessedSeconds + part.unassessedSeconds;
    }
    assessedSeconds += part.durationSeconds ?? Math.max(0, (partBytes[index] ?? 44) - 44) / 32000;
  });
  return {
    parts: parts.length,
    utterances: utterances.length,
    accuracy: weightedMean(utterances, (utterance) => utterance.accuracy),
    fluency: weightedMean(utterances, (utterance) => utterance.fluency),
    wordsToPractice: [...practice].slice(0, MAX_PRACTICE_WORDS),
    assessedSeconds: Math.round(assessedSeconds),
    complete: parts.every((part) => part.complete !== false),
    unassessedSeconds: unassessedSeconds === null ? null : Math.round(unassessedSeconds),
    unassessedSegments,
  };
}

function rowSummary(row) {
  return {
    parts: row.part_count,
    utterances: row.utterance_count,
    accuracy: row.accuracy == null ? null : Number(row.accuracy),
    fluency: row.fluency == null ? null : Number(row.fluency),
    wordsToPractice: Array.isArray(row.words_to_practice) ? row.words_to_practice : [],
    assessedSeconds: Number(row.assessed_seconds),
    complete: row.complete === true,
    unassessedSeconds: row.unassessed_seconds == null ? null : Number(row.unassessed_seconds),
  };
}

/** What learners and Teachers receive: the summary only, never raw parts or the provider. */
function toCheckDto(row) {
  return { status: "completed", saved: true, checkedAt: row.completed_at, language: "en", summary: rowSummary(row) };
}

function publicSummary(summary) {
  const { unassessedSegments, ...rest } = summary;
  return rest;
}

function isStale(row, now) {
  const claimedAt = Date.parse(row.claimed_at);
  return !Number.isFinite(claimedAt) || now - claimedAt > STALE_CLAIM_MS;
}

// --- Saved recording: the trusted part count ---

/**
 * How many files the attempt's saved recording has, from the server-written
 * oral_reading_recordings row (never from the browser). 0 when there is no
 * saved recording. Call only for an already-authorized attempt.
 */
async function loadRecordingPartCount(supabase, attemptId) {
  const { data, error } = await supabase.from(RECORDINGS_TABLE).select("segments").eq("attempt_id", attemptId).maybeSingle();
  if (isMissingTable(error)) return 0;
  if (error) {
    throw new OralReadingPersistenceError("Your saved recording cannot be checked right now. Please try again.", 503,
      "RECORDING_STORAGE_UNAVAILABLE");
  }
  if (!data) return 0;
  const segments = data.segments;
  if (!Array.isArray(segments) || segments.length < 1 || segments.length > MAX_RECORDING_PARTS
    || segments.some((path) => typeof path !== "string" || !path) || new Set(segments).size !== segments.length) {
    throw new OralReadingPersistenceError(RECORDING_MISMATCH_MESSAGE, 422, "PRONUNCIATION_RECORDING_MISMATCH");
  }
  return segments.length;
}

/**
 * The upload must be exactly one WAV per saved recording file, in recorder
 * order: part-0.wav, part-1.wav, ... A single-file recording also accepts the
 * older "part.wav" name. Missing, extra, duplicated or reordered parts are
 * refused. The count comes from the saved recording, not from the browser.
 * Returns an error message, or null when the upload matches.
 */
function recordingPartsMismatch(files, expectedParts) {
  if (!Number.isInteger(expectedParts) || expectedParts < 1) return "There is no saved recording to check yet.";
  if (files.length !== expectedParts) return RECORDING_MISMATCH_MESSAGE;
  const names = files.map((file) => file.originalname);
  const ordered = names.every((name, index) => name === `part-${index}.wav`);
  const legacySingle = expectedParts === 1 && names[0] === "part.wav";
  return ordered || legacySingle ? null : RECORDING_MISMATCH_MESSAGE;
}

// --- Persistence ---

/** { installed, row }: installed is false only when the table does not exist yet. */
async function loadPronunciationCheckRow(supabase, attemptId, columns = SUMMARY_COLUMNS) {
  const { data, error } = await supabase.from(TABLE).select(columns).eq("attempt_id", attemptId).maybeSingle();
  if (isMissingTable(error)) return { installed: false, row: null };
  if (error) throw storeUnavailable();
  return { installed: true, row: data ?? null };
}

/**
 * The saved state of one already-authorized attempt, for the read endpoints.
 * Never calls the speech service.
 */
async function getSavedPronunciationCheck(supabase, attempt, now = Date.now()) {
  if (attempt.language === "fil") return { status: "unsupported", check: null };
  const { installed, row } = await loadPronunciationCheckRow(supabase, attempt.id);
  if (!installed) return { status: "unavailable", check: null };
  if (row?.status === "completed") return { status: "completed", check: toCheckDto(row) };
  if (row?.status === "running" && !isStale(row, now)) return { status: "running", check: null };
  return { status: "none", check: null };
}

/**
 * Claims the attempt's check for this request. Returns { claimed, claimId },
 * { completed: row } or throws PronunciationCheckInProgressError.
 */
async function claimPronunciationCheck(supabase, attempt, userId, now) {
  const claimId = randomUUID();
  const claimedAt = new Date(now).toISOString();
  const { error } = await supabase.from(TABLE).insert({
    attempt_id: attempt.id, user_id: userId, status: "running", claim_id: claimId, claimed_at: claimedAt, language: "en",
  });
  if (!error) return { claimed: true, claimId };
  if (isMissingTable(error)) return { installed: false };
  if (error.code !== "23505") throw storeUnavailable();

  const { row } = await loadPronunciationCheckRow(supabase, attempt.id);
  if (!row) throw storeUnavailable();
  if (row.status === "completed") return { completed: row };
  if (row.status === "running" && !isStale(row, now)) throw new PronunciationCheckInProgressError();
  // A failed or abandoned claim: take it over only if it is still exactly the row
  // read above. Matching claimed_at too means a lease renewed in the meantime
  // (the first request is still alive) is never taken over.
  const { data, error: takeoverError } = await supabase.from(TABLE)
    .update({ status: "running", claim_id: claimId, claimed_at: claimedAt, failure_code: null })
    .eq("attempt_id", attempt.id).eq("claim_id", row.claim_id).eq("status", row.status).eq("claimed_at", row.claimed_at)
    .select("attempt_id");
  if (takeoverError) throw storeUnavailable();
  if (!data?.length) throw new PronunciationCheckInProgressError();
  return { claimed: true, claimId };
}

/** Renews this request's lease. False if it failed or the claim is no longer ours. */
async function renewClaim(supabase, attemptId, claimId, now) {
  try {
    const { data, error } = await supabase.from(TABLE)
      .update({ claimed_at: new Date(now).toISOString() })
      .eq("attempt_id", attemptId).eq("claim_id", claimId).eq("status", "running")
      .select("attempt_id");
    return !error && data?.length === 1;
  } catch {
    return false;
  }
}

async function releaseClaim(supabase, attemptId, claimId, failureCode) {
  try {
    await supabase.from(TABLE)
      .update({ status: "failed", failure_code: /^[A-Z][A-Z0-9_]{0,63}$/.test(failureCode ?? "") ? failureCode : "CHECK_FAILED" })
      .eq("attempt_id", attemptId).eq("claim_id", claimId).eq("status", "running");
  } catch {
    // Best effort: an unreleased claim expires after STALE_CLAIM_MS.
  }
}

async function saveCompletedCheck(supabase, attemptId, claimId, parts, summary, now) {
  const { data, error } = await supabase.from(TABLE).update({
    status: "completed",
    locale: "en-US",
    score_scale: "0-100",
    provider: "azure",
    summary_version: SUMMARY_VERSION,
    part_count: parts.length,
    utterance_count: summary.utterances,
    accuracy: summary.accuracy,
    fluency: summary.fluency,
    words_to_practice: summary.wordsToPractice,
    assessed_seconds: summary.assessedSeconds,
    complete: summary.complete,
    unassessed_seconds: summary.complete ? 0 : summary.unassessedSeconds,
    unassessed_segments: summary.complete ? 0 : summary.unassessedSegments,
    parts,
    completed_at: new Date(now).toISOString(),
  }).eq("attempt_id", attemptId).eq("claim_id", claimId).eq("status", "running")
    .select(SUMMARY_COLUMNS).maybeSingle();
  return error || !data ? null : data;
}

/**
 * Runs (or reuses) the pronunciation check for one already-authorized English
 * attempt. `assessParts` is the paid call; it runs only after a claim is held
 * (or, before the migration, without one). Resolves with
 *   { saved: true, reused, check } | { saved: false, code, message, check }.
 */
async function runPronunciationCheck({ supabase, attempt, userId, assessParts, now = Date.now, persisted }) {
  let claim = { installed: false };
  if (persisted !== false) claim = await claimPronunciationCheck(supabase, attempt, userId, now());
  if (claim.completed) return { saved: true, reused: true, check: toCheckDto(claim.completed) };

  // Called before each part after the first: renews the lease, or stops before
  // paying for another part when the claim was lost (it is then someone else's).
  const beforeNextPart = async () => {
    if (claim.claimed && !(await renewClaim(supabase, attempt.id, claim.claimId, now()))) {
      throw new PronunciationCheckInterruptedError();
    }
  };
  let assessed;
  try {
    assessed = await assessParts({ persisted: Boolean(claim.claimed), beforeNextPart });
  } catch (error) {
    if (claim.claimed) await releaseClaim(supabase, attempt.id, claim.claimId, error?.code);
    throw error;
  }
  const parts = assessed.parts.map(sanitizePart);
  const summary = summarizePronunciationParts(parts, assessed.partBytes);
  const unsaved = { status: "completed", saved: false, checkedAt: null, language: "en", summary: publicSummary(summary) };
  if (!claim.claimed) {
    return { saved: false, code: "PRONUNCIATION_NOT_SAVED", message: NOT_SAVED_MESSAGE, check: unsaved, parts };
  }
  let row = null;
  try {
    row = await saveCompletedCheck(supabase, attempt.id, claim.claimId, parts, summary, now());
  } catch {
    row = null;
  }
  if (!row) {
    await releaseClaim(supabase, attempt.id, claim.claimId, "SAVE_FAILED");
    return { saved: false, code: "PRONUNCIATION_NOT_SAVED", message: NOT_SAVED_MESSAGE, check: unsaved, parts };
  }
  return { saved: true, reused: false, check: toCheckDto(row), parts };
}

/**
 * Reading History (F7): saved scores for the learner's own English attempts,
 * keyed by attempt ID. Never fails the history: returns null when unavailable.
 */
async function loadSavedPronunciationScores(supabase, userId, attemptIds) {
  const scores = new Map();
  const ids = [...new Set(attemptIds)];
  try {
    for (let index = 0; index < ids.length; index += HISTORY_BATCH) {
      const { data, error } = await supabase.from(TABLE)
        .select("attempt_id,accuracy,fluency,complete,completed_at")
        .eq("user_id", userId).eq("status", "completed")
        .in("attempt_id", ids.slice(index, index + HISTORY_BATCH));
      if (error) return null;
      for (const row of data ?? []) {
        scores.set(row.attempt_id, {
          accuracy: row.accuracy == null ? null : Number(row.accuracy),
          fluency: row.fluency == null ? null : Number(row.fluency),
          complete: row.complete === true,
          checkedAt: row.completed_at,
        });
      }
    }
  } catch {
    return null;
  }
  return scores;
}

module.exports = {
  IN_PROGRESS_MESSAGE,
  NOT_SAVED_MESSAGE,
  MAX_PART_ASSESSMENT_MS,
  PronunciationCheckInProgressError,
  PronunciationCheckInterruptedError,
  STALE_CLAIM_MS,
  SUMMARY_COLUMNS,
  SUMMARY_VERSION,
  TABLE,
  claimPronunciationCheck,
  getSavedPronunciationCheck,
  isStale,
  loadPronunciationCheckRow,
  loadRecordingPartCount,
  recordingPartsMismatch,
  renewClaim,
  loadSavedPronunciationScores,
  runPronunciationCheck,
  sanitizePart,
  summarizePronunciationParts,
  toCheckDto,
};
