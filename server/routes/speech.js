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
const { authorizeDiagnosticSpeechRequest, authorizeReadingPracticeRequest } = require("../services/oralReadingAttemptService");
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
// M5 read-aloud transcription and TTS (used by M5 feedback) also admit APPROVED Teachers
// for reading practice. The M2 diagnostic upload admits learners (official diagnostic) and staff
// (F7 Practice Mode: System Admin, School Admin, APPROVED Teachers); the official result endpoint stays learner-only.
function createSpeechRouter({
  uploadDirectory = path.join(__dirname, "..", "uploads"),
  authorize,
  // An injected `authorize` (tests) keeps applying to every endpoint unless this is given too.
  authorizeReadAloud = authorize ?? ((req) => authorizeReadingPracticeRequest(req)),
  authorizeDiagnosticAudio = authorize ?? ((req) => authorizeDiagnosticSpeechRequest(req)),
  rateLimits,
  now,
  transcribe,
  synthesize = synthesizeSpeech,
  receipts = createTranscriptReceiptService(),
  resolveBinding,
  log = console.error,
} = {}) {
  fs.mkdirSync(uploadDirectory, { recursive: true });

  const router = express.Router();
  const upload = createSpeechUpload(uploadDirectory);
  const { requireSpeechAccess } = createSpeechAccess({ authorize, rateLimits, now, log });
  const diagnosticAudioHandler = createDiagnosticAudioHandler({
    ...(transcribe ? { transcribe } : {}),
    ...(resolveBinding ? { resolveBinding } : {}),
    receipts,
    log,
  });
  const readAloudAudioHandler = createReadAloudAudioHandler({
    ...(transcribe ? { transcribe } : {}),
    log,
  });

  router.post("/api/tts", requireSpeechAccess("tts", { authorize: authorizeReadAloud }), async (req, res) => {
    const { text, language, voiceProfile } = req.body || {};

    // M5 feedback asks for "philippine", M5 "Hear American English" for "american"
    // (English only); omitted keeps the configured default voice.
    if (voiceProfile !== undefined && voiceProfile !== "philippine" && !(voiceProfile === "american" && language === "en")) {
      return res.status(400).json({
        success: false,
        message: "Voice profile is not supported.",
      });
    }

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
      let audio;
      if (voiceProfile) {
        try {
          audio = await synthesize(text.trim(), languageCode, { voiceProfile });
        } catch (voiceError) {
          // A Philippine voice the Speech resource cannot use falls back once to the
          // default voice. Missing configuration, permission, quota and timeouts do not.
          const code = voiceError && typeof voiceError === "object" ? voiceError.code : undefined;
          // "American English" is never replaced by another voice: the default may not be en-US.
          if (voiceProfile === "american" || voiceError instanceof SpeechConfigurationError
            || !["STT_INVALID_AUDIO", "STT_PROVIDER_ERROR"].includes(code)) {
            throw voiceError;
          }
          log("Philippine feedback voice unavailable; using the default voice", { code });
          audio = await synthesize(text.trim(), languageCode);
        }
      } else {
        audio = await synthesize(text.trim(), languageCode);
      }

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

  router.post("/api/diagnostic/audio", requireSpeechAccess("stt", { authorize: authorizeDiagnosticAudio }), (req, res) => {
    upload.single("audio")(req, res, (error) => diagnosticAudioHandler(req, res, error));
  });

  // M5 read-aloud: one request per reading, for the whole continuous recording.
  router.post("/api/read-aloud/audio", requireSpeechAccess("stt", { authorize: authorizeReadAloud }), (req, res) => {
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
