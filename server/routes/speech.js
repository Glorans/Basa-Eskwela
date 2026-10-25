const express = require("express");
const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");
const multer = require("multer");

const { createDiagnosticAudioHandler } = require("./diagnosticAudio");
const { createReadAloudAudioHandler } = require("./readAloudAudio");
const { synthesizeSpeech } = require("../services/azureSpeechService");
const { getSpeechLanguageCode } = require("../services/diagnosticLanguage");
const { SpeechConfigurationError, SAFE_SPEECH_ERRORS } = require("../services/speechErrors");
const { createSpeechAccess } = require("../services/speechAccess");
const { createTranscriptReceiptService } = require("../services/diagnosticTranscriptReceipts");

// Words and short passages; Azure neural TTS is also capped at 1,000 characters
// per request in the Speech Lab. Longer text is rejected with a clear message.
const MAX_TTS_TEXT_LENGTH = 1000;

// One audio file per request. 10 MB matches the WAV limit in wavAudio.js: an M2
// 25-second 16 kHz PCM WAV part is about 800 KB, and an M5 whole read-aloud of
// at most five minutes is about 9.6 MB.
// Fields: language, plus M2's recordingId, segmentIndex, assessmentId and assessmentVersion.
const SPEECH_UPLOAD_LIMITS = Object.freeze({
  fileSize: 10 * 1024 * 1024,
  files: 1,
  fields: 5,
  fieldSize: 1024,
  parts: 6,
});

const audioExtensionsByMimeType = {
  "audio/aac": ".aac",
  "audio/flac": ".flac",
  "audio/mp4": ".m4a",
  "audio/mpeg": ".mp3",
  "audio/ogg": ".ogg",
  "audio/wav": ".wav",
  "audio/webm": ".webm",
  "audio/x-wav": ".wav",
};

function getBaseMimeType(mimeType = "") {
  return mimeType.split(";", 1)[0].trim().toLowerCase();
}

function createSpeechUpload(uploadDirectory) {
  return multer({
    storage: multer.diskStorage({
      destination: uploadDirectory,
      filename: (req, file, callback) => {
        const originalExtension = path.extname(file.originalname).toLowerCase();
        const baseMimeType = getBaseMimeType(file.mimetype);
        const safeExtension = /^\.[a-z0-9]{1,10}$/.test(originalExtension)
          ? originalExtension
          : audioExtensionsByMimeType[baseMimeType] || "";

        callback(null, `${randomUUID()}${safeExtension}`);
      },
    }),
    limits: SPEECH_UPLOAD_LIMITS,
    fileFilter: (req, file, callback) => {
      const baseMimeType = getBaseMimeType(file.mimetype);

      if (audioExtensionsByMimeType[baseMimeType]) {
        callback(null, true);
        return;
      }

      const error = new Error("Unsupported diagnostic audio type.");
      error.code = "UNSUPPORTED_AUDIO_TYPE";
      callback(error);
    },
  });
}

// Azure STT (M2 diagnostic fallback, M5 read-aloud) and Azure neural TTS. Both
// require an authenticated student, independent learner or admin; access is
// checked and throttled before any upload is written or provider is called.
function createSpeechRouter({
  uploadDirectory = path.join(__dirname, "..", "uploads"),
  authorize,
  rateLimits,
  now,
  transcribe,
  synthesize = synthesizeSpeech,
  receipts = createTranscriptReceiptService(),
  log = console.error,
} = {}) {
  fs.mkdirSync(uploadDirectory, { recursive: true });

  const router = express.Router();
  const upload = createSpeechUpload(uploadDirectory);
  const { requireSpeechAccess } = createSpeechAccess({ authorize, rateLimits, now, log });
  const diagnosticAudioHandler = createDiagnosticAudioHandler({
    ...(transcribe ? { transcribe } : {}),
    receipts,
    log,
  });
  const readAloudAudioHandler = createReadAloudAudioHandler({
    ...(transcribe ? { transcribe } : {}),
    log,
  });

  router.post("/api/tts", requireSpeechAccess("tts"), async (req, res) => {
    const { text, language } = req.body || {};

    if (typeof text !== "string" || text.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: "Text is required for speech synthesis.",
      });
    }

    if (text.trim().length > MAX_TTS_TEXT_LENGTH) {
      return res.status(400).json({
        success: false,
        message: `Text must be ${MAX_TTS_TEXT_LENGTH} characters or fewer.`,
      });
    }

    let languageCode;

    try {
      languageCode = getSpeechLanguageCode(language);
    } catch {
      return res.status(400).json({
        success: false,
        message: "Language must be either 'en' or 'fil'.",
      });
    }

    try {
      const audio = await synthesize(text.trim(), languageCode);

      res.set({
        "Cache-Control": "no-store",
        "Content-Type": "audio/mpeg",
      });
      return res.send(audio);
    } catch (error) {
      // Log the failure class only, not the requested text or provider payloads.
      log("Diagnostic text-to-speech synthesis failed", {
        name: error instanceof Error ? error.name : "UnknownError",
        code: error && typeof error === "object" ? error.code : undefined,
      });

      if (error instanceof SpeechConfigurationError) {
        return res.status(503).json({
          success: false,
          code: "SPEECH_NOT_CONFIGURED",
          message: SAFE_SPEECH_ERRORS.SPEECH_NOT_CONFIGURED.message,
        });
      }

      return res.status(500).json({
        success: false,
        message: "Unable to generate pronunciation audio. Please try again.",
      });
    }
  });

  router.post("/api/diagnostic/audio", requireSpeechAccess("stt"), (req, res) => {
    upload.single("audio")(req, res, (error) => diagnosticAudioHandler(req, res, error));
  });

  // M5 read-aloud: one request per reading, for the whole continuous recording.
  router.post("/api/read-aloud/audio", requireSpeechAccess("stt"), (req, res) => {
    req.readAloudReceivedAt = Date.now();
    upload.single("audio")(req, res, (error) => readAloudAudioHandler(req, res, error));
  });

  return router;
}

module.exports = {
  MAX_TTS_TEXT_LENGTH,
  SPEECH_UPLOAD_LIMITS,
  createSpeechRouter,
};
