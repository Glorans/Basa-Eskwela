const { unlink } = require("node:fs/promises");
const { getSpeechLanguageCode } = require("../services/diagnosticLanguage");
const { transcribeWav } = require("../services/azureSpeechService");
const { getSpeechErrorResponse, SpeechTranscriptionError } = require("../services/speechErrors");
const { prepareTranscriptReceipt, recordTranscriptReceipt } = require("../services/readingVerification");
const { ARCHIVED_CLASSROOM_CODE, ARCHIVED_CLASSROOM_MESSAGE, isArchivedReadingContext } = require("../services/roomArchive");

// An archived classroom accepts no new reading: refuse before the paid speech-to-text call.
async function readingContextArchived(query) {
  const context = { roomId: query?.roomId, activityAssignmentId: query?.activityAssignmentId, assignmentId: query?.assignmentId };
  // No classroom context (Independent Learner, Admin practice): nothing to check, no database call.
  if (!Object.values(context).some((value) => typeof value === "string" && value)) return false;
  const { getSupabaseAdmin } = require("../services/supabaseAdmin");
  return isArchivedReadingContext(getSupabaseAdmin(), context);
}

const UPLOAD_TOO_LARGE_CODES = new Set(["LIMIT_FILE_SIZE", "LIMIT_FIELD_VALUE"]);

// Story names that help speech-to-text recognize them (a phrase list). Kept
// small and to names only: a phrase list biases recognition toward these
// words, so it must never hold the whole story (that would hide real
// misreadings). Sent in the query string (?name=Santos), which older servers
// ignore, so a newer browser never breaks an older server.
const MAX_PHRASE_HINTS = 10;
const PHRASE_HINT = /^\p{Lu}[\p{L}'’-]{1,29}$/u;

/** Valid, distinct story names from the query; anything else is dropped, never an error. */
function parsePhraseHints(value) {
  const values = Array.isArray(value) ? value : value === undefined ? [] : [value];
  const hints = [];
  for (const item of values) {
    if (typeof item !== "string") continue;
    const name = item.trim();
    if (PHRASE_HINT.test(name) && !hints.includes(name)) hints.push(name);
    if (hints.length === MAX_PHRASE_HINTS) break;
  }
  return hints;
}

// Durations and sizes only: never audio, transcripts, tokens or user IDs.
function developmentTiming(details) {
  if (process.env.NODE_ENV === "development") console.info("[ReadAloud] timing", details);
}

/**
 * Module 5 only: speech-to-text for one entire read-aloud, sent once after the
 * learner presses Stop as a single 16 kHz mono PCM WAV of the same continuous
 * recording that is saved for playback. Azure hears it in one
 * continuous-recognition session, so there are no part boundaries. Only the
 * language field is accepted; Module 2 diagnostics keep /api/diagnostic/audio
 * and their signed transcript receipts.
 */
function createReadAloudAudioHandler({
  transcribe = transcribeWav, remove = unlink, log = console.error, timing = developmentTiming, now = Date.now,
  recordReceipt = recordTranscriptReceipt, contextArchived = readingContextArchived,
  // Pairs with the default receipt only; a substituted recordReceipt gets no early source load.
  prepareReceipt = recordReceipt === recordTranscriptReceipt ? prepareTranscriptReceipt : null,
} = {}) {
  return async function readAloudAudio(req, res, uploadError) {
    // Set by the route before the upload is read (routes/speech.js).
    const receivedAt = req.readAloudReceivedAt ?? now();
    const uploadMs = now() - receivedAt;
    let recognitionMs;
    let recognition;
    // A browser that gives up closes the request; stop recognizing for it.
    const abandoned = new AbortController();
    res.on("close", () => { if (!res.writableFinished) abandoned.abort(); });
    try {
      if (UPLOAD_TOO_LARGE_CODES.has(uploadError?.code)) {
        return res.status(413).json({ success: false, code: "AUDIO_TOO_LARGE", message: "This recording is too large to process. Please record it again." });
      }
      if (uploadError || !req.file) {
        return res.status(400).json({ success: false, code: "STT_INVALID_AUDIO", message: "Audio upload failed. Please try recording again." });
      }
      if (!["audio/wav", "audio/x-wav"].includes(req.file.mimetype.split(";", 1)[0].trim().toLowerCase())) {
        return res.status(415).json({ success: false, code: "STT_INVALID_AUDIO", message: "This recording format cannot be transcribed. Please record it again." });
      }
      if (Object.keys(req.body ?? {}).some((field) => field !== "language")) {
        return res.status(400).json({ success: false, code: "STT_INVALID_AUDIO", message: "Audio upload failed. Please try recording again." });
      }
      let languageCode;
      try { languageCode = getSpeechLanguageCode(req.body?.language); }
      catch { return res.status(400).json({ success: false, message: "Language must be either 'en' or 'fil'." }); }
      // transcribeWav() verifies the WAV container and its duration itself.
      // English only: phrase lists are used where the recognizer is tested (en-US).
      const phrases = languageCode === "en-US" ? parsePhraseHints(req.query?.name) : [];
      // Classroom readings only (the context names a room or assignment): an archived room gets no transcription.
      if (await contextArchived(req.query)) {
        return res.status(409).json({ success: false, code: ARCHIVED_CLASSROOM_CODE, message: ARCHIVED_CLASSROOM_MESSAGE });
      }
      // Starts the receipt's read-only source lookup while Azure recognizes the speech (see readingVerification.js).
      const preparedSource = prepareReceipt?.(res.locals?.speechRequester, { language: req.body.language, query: req.query }) ?? null;
      const recognitionStartedAt = now();
      let transcription;
      try {
        transcription = await transcribe(req.file.path, languageCode, {
          wholeRecording: true, signal: abandoned.signal, onDiagnostics: (details) => { recognition = details; },
          ...(phrases.length ? { phrases } : {}),
        });
      } finally {
        recognitionMs = now() - recognitionStartedAt;
      }
      // Lets the browser's network panel show where the time went.
      res.set("Server-Timing", `upload;dur=${uploadMs}, recognition;dur=${recognitionMs}`);
      if (typeof transcription?.text !== "string" || !transcription.text.trim()) throw new SpeechTranscriptionError("STT_PROVIDER_ERROR");
      // Awaited so the save that follows can find it. M5 continues if this fails: the reading
      // is saved and simply earns no M8 XP (services/readingVerification.js).
      await recordReceipt(res.locals?.speechRequester, { language: req.body.language, query: req.query }, transcription.text,
        ...(preparedSource ? [{ preparedSource }] : []));
      res.set("Cache-Control", "no-store");
      return res.json({ success: true, message: "Audio transcribed successfully.", transcription });
    } catch (error) {
      const safeError = getSpeechErrorResponse(error);
      log("Read-aloud transcription failed", { code: safeError.code });
      return res.status(safeError.status).json({ success: false, code: safeError.code, message: safeError.message });
    } finally {
      timing({
        uploadMs, recognitionMs, audioBytes: req.file?.size, status: res.statusCode, abandoned: abandoned.signal.aborted,
        ...(recognition ? { recognition } : {}),
      });
      if (req.file?.path) {
        try { await remove(req.file.path); }
        catch (error) {
          if (error.code !== "ENOENT") log("Read-aloud temporary audio cleanup failed", { code: error.code });
        }
      }
    }
  };
}

module.exports = { MAX_PHRASE_HINTS, createReadAloudAudioHandler, parsePhraseHints };
