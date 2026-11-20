const { getSupabaseAdmin } = require("./supabaseAdmin");
const {
  getActiveDiagnosticAssessment,
} = require("./diagnosticAssessments");
const { DIAGNOSTIC_SCORING_RULE, getReadingWords, scoreDiagnostic } = require("./diagnosticScoring");
const { DiagnosticReceiptError } = require("./diagnosticTranscriptReceipts");
const { createCodeOnlyInitialDiagnostics } = require("./initialDiagnosticService");

const INITIAL_ASSESSMENT_TYPE = "initial";
const VERIFICATION_METHOD = "server_stt_receipt_v1";
const SEGMENT_SECONDS = 25;
// Five minutes in 25-second parts (diagnosticRecording.ts).
const MAX_SEGMENTS = 12;
const MAX_RECORDING_SECONDS = 301;
// MediaRecorder segment boundaries are approximate; this only bounds WPM input.
const SEGMENT_DURATION_TOLERANCE_SECONDS = 5;

class DiagnosticSubmissionError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.name = "DiagnosticSubmissionError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

const READING_NOT_VERIFIED = "We couldn't verify your reading. Please go back to the story and record it again.";

function rejectReading() {
  return new DiagnosticSubmissionError(422, "READING_NOT_VERIFIED", READING_NOT_VERIFIED);
}

/**
 * Turns the submitted receipts into one server-verified transcript. Every
 * receipt must be valid, belong to this learner, language and diagnostic
 * (assessment id/version and passage hash), and come from one recording: one
 * streaming receipt, or upload segments 1..n in order.
 */
function verifyReading({ tokens, userId, language, binding, receiptService }) {
  if (!Array.isArray(tokens) || tokens.length < 1 || tokens.length > MAX_SEGMENTS) throw rejectReading();
  let claims;
  try { claims = tokens.map((token) => receiptService.verify(token)); }
  catch (error) {
    if (error instanceof DiagnosticReceiptError) throw rejectReading();
    throw error;
  }
  const [first] = claims;
  const sameRecording = claims.every((claim, index) => claim.sub === userId && claim.lang === language
    && claim.aid === binding.assessmentId && claim.aver === binding.assessmentVersion
    && claim.ph === binding.passageHash
    && claim.rid === first.rid && claim.src === first.src && claim.seg === index + 1);
  if (!sameRecording || (first.src === "stream" && claims.length !== 1)) throw rejectReading();

  // A part may be empty only when the server confirmed that Azure heard nothing but silence or noise in it (signed
  // receipt flag ns). Such parts may appear anywhere, e.g. a long pause between sentences; they add no words, so
  // the speech before and after the pause is scored exactly as if there had been no pause. Missing, unsigned or
  // out-of-order parts are refused above, and a recording with no reading words at all is refused below.
  if (claims.some((claim) => !claim.text.trim() && claim.ns !== true)) throw rejectReading();
  const text = claims.map((claim) => claim.text.trim()).filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  if (!getReadingWords(text, language).length) {
    throw new DiagnosticSubmissionError(422, "NO_SPEECH", "No speech could be recognized from the recording.");
  }
  const confidences = claims.map((claim) => claim.conf).filter(Number.isFinite);
  return {
    recordingId: first.rid,
    source: first.src,
    segments: claims.length,
    text,
    confidence: confidences.length ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length : null,
    serverAudioSeconds: first.src === "stream" ? first.secs : undefined,
  };
}

// Duration only changes WPM, never the reading level. Streaming duration is the
// server-counted PCM length; upload duration is browser-reported and bounded by
// the verified segment count, or dropped.
function resolveDuration(reading, reportedSeconds) {
  if (Number.isFinite(reading.serverAudioSeconds) && reading.serverAudioSeconds > 0) {
    return { seconds: Math.min(reading.serverAudioSeconds, MAX_RECORDING_SECONDS), source: "server_audio" };
  }
  const limit = Math.min(MAX_RECORDING_SECONDS, reading.segments * SEGMENT_SECONDS + SEGMENT_DURATION_TOLERANCE_SECONDS);
  if (typeof reportedSeconds === "number" && Number.isFinite(reportedSeconds) && reportedSeconds > 0 && reportedSeconds <= limit) {
    return { seconds: reportedSeconds, source: "client_reported" };
  }
  return { seconds: undefined, source: "unavailable" };
}

function finiteOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function buildVerifiedRow({ userId, assessment, reading, duration, score, now }) {
  const { alignment, ...counts } = score.oralReadingMetrics;
  return {
    user_id: userId,
    assessment_type: INITIAL_ASSESSMENT_TYPE,
    language: assessment.language,
    assessment_id: assessment.id,
    assessment_version: assessment.version,
    orv_score: score.orvScore,
    comprehension_score: score.comprehensionScore,
    reading_level: score.readingLevel,
    difficulty_tier: score.difficultyTier,
    reading_speed_wpm: finiteOrNull(score.readingSpeedWpm),
    transcript: reading.text,
    stt_confidence: finiteOrNull(reading.confidence),
    oral_reading_metrics: {
      alignment: alignment.map((word) => ({ ...word })),
      ...counts,
      // Which scoring rule produced this result (counts includes titleWordsExcluded, 0 when no title was read).
      scoringRule: DIAGNOSTIC_SCORING_RULE,
      comprehensionAnswers: score.comprehensionAnswers,
      transcriptSource: reading.source,
      transcriptSegments: reading.segments,
      durationSource: duration.source,
    },
    completed_at: now,
    updated_at: now,
    verification_status: "server_verified",
    verification_method: VERIFICATION_METHOD,
    verification_recording_id: reading.recordingId,
    verified_at: now,
  };
}

function createDiagnosticResultService({
  receipts,
  getAdmin = getSupabaseAdmin,
  now = () => new Date().toISOString(),
  // M2 F6: which initial diagnostic versions are accepted. Default: the code-defined version only (unchanged behaviour);
  // server.js passes the activation-aware service (initialDiagnosticService).
  initialAssessments = createCodeOnlyInitialDiagnostics(),
} = {}) {
  if (!receipts) throw new Error("A transcript receipt service is required.");

  async function findVerified(supabase, userId, assessment) {
    const { data, error } = await supabase
      .from("diagnostic_results")
      .select("*")
      .eq("user_id", userId)
      .eq("assessment_type", INITIAL_ASSESSMENT_TYPE)
      .eq("language", assessment.language)
      .eq("assessment_id", assessment.id)
      .eq("assessment_version", assessment.version)
      .eq("verification_status", "server_verified")
      .maybeSingle();
    if (error) throw new DiagnosticSubmissionError(500, "DIAGNOSTIC_SAVE_FAILED", "We couldn't save your diagnostic result. Please try again.");
    return data;
  }

  // The initial diagnostic is taken once per active version. Retrying the same
  // recording returns the stored result; a different recording is refused, so
  // a learner cannot re-read until a better level is stored.
  function resolveExisting(existing, recordingId) {
    if (existing.verification_recording_id === recordingId) return { row: existing, replayed: true };
    throw new DiagnosticSubmissionError(409, "DIAGNOSTIC_ALREADY_COMPLETED", "This diagnostic is already completed.");
  }

  async function submitInitialDiagnostic(requester, body) {
    const userId = requester.user.id;
    const language = body?.language;
    const builtIn = getActiveDiagnosticAssessment(language);
    if (!builtIn || builtIn.contentStatus !== "active") {
      throw new DiagnosticSubmissionError(400, "INVALID_ASSESSMENT", "This diagnostic is not available.");
    }
    // The exact version delivered: the active one, or one replaced within the reading-receipt lifetime.
    const assessment = await initialAssessments.resolve(language, body.assessmentId, body.assessmentVersion);
    if (!assessment) {
      throw new DiagnosticSubmissionError(409, "ASSESSMENT_CHANGED", "This diagnostic was updated. Please reload it and start again.");
    }
    const answers = body.answers;
    if (!answers || typeof answers !== "object" || Array.isArray(answers)
      || assessment.questions.some((question) => !question.choiceIds.includes(answers[question.id]))) {
      throw new DiagnosticSubmissionError(400, "INVALID_ANSWERS", "Read the story and answer every question first.");
    }

    // Client-supplied scores, levels, tiers and transcripts are never read.
    const binding = initialAssessments.binding(assessment);
    const reading = verifyReading({ tokens: body.transcriptReceipts, userId, language, binding, receiptService: receipts });
    const supabase = getAdmin();
    const existing = await findVerified(supabase, userId, assessment);
    if (existing) return resolveExisting(existing, reading.recordingId);
    // One official initial diagnostic per language: a learner who completed another version never takes this one.
    if (await initialAssessments.hasOtherOfficialInitial(supabase, userId, language, assessment)) {
      throw new DiagnosticSubmissionError(409, "DIAGNOSTIC_ALREADY_COMPLETED", "This diagnostic is already completed.");
    }

    const duration = resolveDuration(reading, body.recordingDurationSeconds);
    const score = scoreDiagnostic({
      assessment,
      passageText: assessment.paragraphs.join(" "),
      transcript: reading.text,
      recordingDurationSeconds: duration.seconds,
      answers,
    });
    const row = buildVerifiedRow({ userId, assessment, reading, duration, score, now: now() });
    const { data, error } = await supabase.from("diagnostic_results").insert(row).select("*").single();

    if (error?.code === "23505") {
      // A concurrent submission won the one verified row for this version.
      const winner = await findVerified(supabase, userId, assessment);
      if (winner) return resolveExisting(winner, reading.recordingId);
      if (await initialAssessments.hasOtherOfficialInitial(supabase, userId, language, assessment)) {
        throw new DiagnosticSubmissionError(409, "DIAGNOSTIC_ALREADY_COMPLETED", "This diagnostic is already completed.");
      }
      // Otherwise this recording already produced another verified result.
      throw rejectReading();
    }
    if (error || !data) {
      throw new DiagnosticSubmissionError(500, "DIAGNOSTIC_SAVE_FAILED", "We couldn't save your diagnostic result. Please try again.");
    }
    return { row: data, replayed: false };
  }

  return { submitInitialDiagnostic };
}

module.exports = {
  DiagnosticSubmissionError,
  MAX_SEGMENTS,
  VERIFICATION_METHOD,
  createDiagnosticResultService,
  resolveDuration,
  verifyReading,
};
