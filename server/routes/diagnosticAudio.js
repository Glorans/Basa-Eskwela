const { unlink } = require("node:fs/promises");
const { getSpeechLanguageCode } = require("../services/diagnosticLanguage");
const { transcribeWav } = require("../services/azureSpeechService");
const { getSpeechErrorResponse, SpeechTranscriptionError } = require("../services/speechErrors");
const { isUuid } = require("../services/diagnosticTranscriptReceipts");
const { getDiagnosticAssessmentBinding } = require("../services/diagnosticAssessments");
const { MAX_SEGMENTS } = require("../services/diagnosticResultService");

// Multer limit codes. Size limits are 413; count limits mean a malformed request.
const UPLOAD_TOO_LARGE_CODES = new Set(["LIMIT_FILE_SIZE", "LIMIT_FIELD_VALUE"]);
const UNAVAILABLE_MESSAGE = "Speech processing is temporarily unavailable. Please try again later.";

const DIAGNOSTIC_FIELDS = ["recordingId", "segmentIndex", "assessmentId", "assessmentVersion"];
// Roles first admitted here by M2 F7 Practice Mode (System Admin, approved Teachers) may upload DIAGNOSTIC parts only,
// never plain (non-diagnostic) transcription. Roles that could upload before F7 keep their previous behavior.
const DIAGNOSTIC_ONLY_ROLES = new Set(["system_admin", "teacher"]);

// M2 diagnostic parts name the active diagnostic, their recording and their
// position; M5 read-alouds send none of these and receive no receipt.
// Returns null for an M5 request.
function readDiagnosticSegment(body) {
  if (DIAGNOSTIC_FIELDS.every((field) => body?.[field] === undefined)) return null;
  const segmentIndex = Number(body.segmentIndex);
  if (!isUuid(body.recordingId) || !/^\d{1,2}$/.test(String(body.segmentIndex))
    || segmentIndex < 1 || segmentIndex > MAX_SEGMENTS) {
    return { invalid: true };
  }
  const binding = getDiagnosticAssessmentBinding(body.language, body.assessmentId, body.assessmentVersion);
  if (!binding) return { invalid: true, stale: true };
  return { recordingId: body.recordingId.toLowerCase(), segmentIndex, binding };
}

/** Only Module 2's synchronous fallback owns these temporary uploads. */
function createDiagnosticAudioHandler({ transcribe = transcribeWav, remove = unlink, receipts, log = console.error } = {}) {
  return async function diagnosticAudio(req, res, uploadError) {
    try {
      if (UPLOAD_TOO_LARGE_CODES.has(uploadError?.code)) {
        return res.status(413).json({ success: false, code: "AUDIO_TOO_LARGE", message: "This part of the recording is too large to process. Please record it again." });
      }
      if (uploadError || !req.file) {
        return res.status(400).json({ success: false, code: "STT_INVALID_AUDIO", message: "Audio upload failed. Please try recording again." });
      }
      // The browser converts each recorded part to mono 16 kHz PCM WAV for Azure;
      // transcribeWav() verifies the container itself.
      if (!["audio/wav", "audio/x-wav"].includes(req.file.mimetype.split(";", 1)[0].trim().toLowerCase())) {
        return res.status(415).json({ success: false, code: "STT_INVALID_AUDIO", message: "This recording format cannot be transcribed. Please record it again." });
      }
      let languageCode;
      try { languageCode = getSpeechLanguageCode(req.body?.language); }
      catch { return res.status(400).json({ success: false, message: "Language must be either 'en' or 'fil'." }); }
      const segment = readDiagnosticSegment(req.body);
      if (segment?.invalid) {
        return res.status(400).json({
          success: false,
          code: "STT_INVALID_AUDIO",
          message: segment.stale
            ? "This diagnostic was updated. Please reload the page and start again."
            : "Audio upload failed. Please try recording again.",
        });
      }
      if (!segment && DIAGNOSTIC_ONLY_ROLES.has(res.locals?.speechRequester?.profile?.role)) {
        return res.status(403).json({ success: false, code: "DIAGNOSTIC_ONLY", message: "This upload is available for the diagnostic assessment only." });
      }
      // A diagnostic part that cannot be signed would be unusable, so the paid
      // provider is not called for it.
      if (segment) {
        try { receipts.assertConfigured(); }
        catch {
          log("Diagnostic transcript receipts are not configured");
          return res.status(503).json({ success: false, code: "STT_PERMISSION", message: UNAVAILABLE_MESSAGE });
        }
      }
      let transcription;
      try {
        transcription = await transcribe(req.file.path, languageCode);
      } catch (error) {
        // M2 uploads a long reading in ~25-second parts. A part with only silence or background noise (for example
        // the pause after the learner finished) is not an error: it gets a signed, empty receipt so the rest of the
        // reading can still be scored. The result service still refuses a recording with no reading words at all.
        // Speech that Azure heard but could not recognize is never treated this way (it stays NO_SPEECH).
        if (!(segment && error?.code === "NO_SPEECH" && error.silenceOnly === true)) throw error;
        log("Diagnostic part had no speech (silence or noise only)", { segmentIndex: segment.segmentIndex });
        const receipt = receipts.issue({
          userId: res.locals.speechRequester.user.id,
          language: req.body.language,
          binding: segment.binding,
          recordingId: segment.recordingId,
          segmentIndex: segment.segmentIndex,
          source: "upload",
          text: "",
          noSpeech: true,
        });
        return res.json({ success: true, message: "This part had no speech.", transcription: { text: "", receipt, noSpeech: true } });
      }
      if (typeof transcription?.text !== "string" || !transcription.text.trim()) throw new SpeechTranscriptionError("STT_PROVIDER_ERROR");
      const receipt = segment
        ? receipts.issue({
            userId: res.locals.speechRequester.user.id,
            language: req.body.language,
            binding: segment.binding,
            recordingId: segment.recordingId,
            segmentIndex: segment.segmentIndex,
            source: "upload",
            text: transcription.text,
            confidence: transcription.confidence,
          })
        : undefined;
      return res.json({
        success: true,
        message: "Audio transcribed successfully.",
        transcription: receipt ? { ...transcription, receipt } : transcription,
      });
    } catch (error) {
      const safeError = getSpeechErrorResponse(error);
      log("Diagnostic transcription failed", { code: safeError.code });
      return res.status(safeError.status).json({ success: false, code: safeError.code, message: safeError.message });
    } finally {
      if (req.file?.path) {
        try { await remove(req.file.path); }
        catch (error) {
          if (error.code !== "ENOENT") log("Diagnostic temporary audio cleanup failed", { code: error.code });
        }
      }
    }
  };
}

module.exports = { createDiagnosticAudioHandler };
