const { unlink } = require("node:fs/promises");
const { getGoogleSpeechLanguageCode } = require("../services/diagnosticLanguage");
const { transcribeWebm, getSpeechErrorResponse } = require("../services/googleSpeechService");

// Multer limit codes. Size limits are 413; count limits mean a malformed request.
const UPLOAD_TOO_LARGE_CODES = new Set(["LIMIT_FILE_SIZE", "LIMIT_FIELD_VALUE"]);

/** Only Module 2's synchronous fallback owns these temporary uploads. */
function createDiagnosticAudioHandler({ transcribe = transcribeWebm, remove = unlink, log = console.error } = {}) {
  return async function diagnosticAudio(req, res, uploadError) {
    try {
      if (UPLOAD_TOO_LARGE_CODES.has(uploadError?.code)) {
        return res.status(413).json({ success: false, code: "AUDIO_TOO_LARGE", message: "This part of the recording is too large to process. Please record it again." });
      }
      if (uploadError || !req.file) {
        return res.status(400).json({ success: false, code: "STT_INVALID_AUDIO", message: "Audio upload failed. Please try recording again." });
      }
      if (req.file.mimetype.split(";", 1)[0].trim().toLowerCase() !== "audio/webm") {
        return res.status(415).json({ success: false, code: "STT_INVALID_AUDIO", message: "This recording format cannot be transcribed. Please use WebM audio." });
      }
      let languageCode;
      try { languageCode = getGoogleSpeechLanguageCode(req.body?.language); }
      catch { return res.status(400).json({ success: false, message: "Language must be either 'en' or 'fil'." }); }
      const transcription = await transcribe(req.file.path, languageCode);
      if (!transcription.text) return res.status(422).json({ success: false, code: "NO_SPEECH", message: "No speech could be recognized from the recording." });
      return res.json({ success: true, message: "Audio transcribed successfully.", transcription });
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
