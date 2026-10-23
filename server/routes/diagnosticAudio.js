const { unlink } = require("node:fs/promises");
const { getSpeechLanguageCode } = require("../services/diagnosticLanguage");
const { transcribeWav } = require("../services/azureSpeechService");
const { getSpeechErrorResponse } = require("../services/speechErrors");
const { isUuid } = require("../services/diagnosticTranscriptReceipts");
const { getDiagnosticAssessmentBinding } = require("../services/diagnosticAssessments");
const { MAX_SEGMENTS } = require("../services/diagnosticResultService");

// Multer limit codes. Size limits are 413; count limits mean a malformed request.
const UPLOAD_TOO_LARGE_CODES = new Set(["LIMIT_FILE_SIZE", "LIMIT_FIELD_VALUE"]);
const UNAVAILABLE_MESSAGE = "Speech processing is temporarily unavailable. Please try again later.";

const DIAGNOSTIC_FIELDS = ["recordingId", "segmentIndex", "assessmentId", "assessmentVersion"];

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
      // A diagnostic part that cannot be signed would be unusable, so the paid
      // provider is not called for it.
      if (segment) {
        try { receipts.assertConfigured(); }
        catch {
          log("Diagnostic transcript receipts are not configured");
          return res.status(503).json({ success: false, code: "STT_PERMISSION", message: UNAVAILABLE_MESSAGE });
        }
      }
      const transcription = await transcribe(req.file.path, languageCode);
      if (!transcription.text) return res.status(422).json({ success: false, code: "NO_SPEECH", message: "No speech could be recognized from the recording." });
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
