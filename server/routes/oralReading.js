const { loadAssignedReadingSource } = require("../services/assignedReadingSource");
const {
  getTeacherCompletionAnalytics,
} = require("../services/teacherCompletionAnalytics");
const express = require("express");
const multer = require("multer");
const {
  SupabaseAuthenticationError,
  SupabaseServerConfigurationError,
} = require("../services/supabaseAdmin");
const {
  OralReadingAuthorizationError,
  OralReadingPersistenceError,
  authorizeOralReadingRequest,
  authorizeOralReadingPracticeRequest,
  authorizeTeacherOralReadingRequest,
  createOralReadingAttempt,
  getOralReadingAttempt,
  getTeacherOralReadingAttempt,
  listTeacherOralReadingAttempts,
  loadAccessiblePublishedModule,
  listOwnOralReadingAttempts,
} = require("../services/oralReadingAttemptService");
const {
  MAX_SEGMENTS,
  getOralReadingRecording,
  saveOralReadingRecording,
} = require("../services/oralReadingRecordingService");
const { assessPronunciationWav } = require("../services/azureSpeechService");
const { getSpeechErrorResponse, SAFE_SPEECH_ERRORS } = require("../services/speechErrors");
const { MAX_WAV_BYTES } = require("../services/wavAudio");
const { RATE_LIMITED_MESSAGE, SPEECH_RATE_LIMITS, createRequestLimiter } = require("../services/speechAccess");

function sendOralReadingError(res, error, fallbackMessage) {
  if (error instanceof SupabaseAuthenticationError) {
    return res.status(401).json({ success: false, message: error.message });
  }
  if (error instanceof OralReadingAuthorizationError || error instanceof OralReadingPersistenceError) {
    if (error.statusCode >= 500) console.error("M5 oral-reading operation failed:", error);
    return res.status(error.statusCode).json({ success: false, message: error.message, code: error.code });
  }
  if (error instanceof SupabaseServerConfigurationError) {
    console.error("M5 oral-reading persistence is not configured.");
    return res.status(503).json({ success: false, message: error.message });
  }
  console.error("Unexpected M5 oral-reading failure:", error);
  return res.status(500).json({ success: false, message: fallbackMessage });
}

function createOralReadingRouter(dependencies = {}) {
  const router = express.Router();
  const authorize = dependencies.authorizeOralReadingRequest ?? authorizeOralReadingRequest;
  // Self-practice routes (published modules, own results and recordings) also admit admins.
  const authorizePractice = dependencies.authorizeOralReadingPracticeRequest
    ?? dependencies.authorizeOralReadingRequest
    ?? authorizeOralReadingPracticeRequest;
  const loadModule = dependencies.loadAccessiblePublishedModule ?? loadAccessiblePublishedModule;
  const createAttempt = dependencies.createOralReadingAttempt ?? createOralReadingAttempt;
  const getAttempt = dependencies.getOralReadingAttempt ?? getOralReadingAttempt;
  const authorizeTeacher = dependencies.authorizeTeacherOralReadingRequest
    ?? authorizeTeacherOralReadingRequest;
  const listTeacherAttempts = dependencies.listTeacherOralReadingAttempts
    ?? listTeacherOralReadingAttempts;
  const getTeacherAttempt = dependencies.getTeacherOralReadingAttempt
    ?? getTeacherOralReadingAttempt;
  const saveRecording = dependencies.saveOralReadingRecording ?? saveOralReadingRecording;
  const loadRecording = dependencies.getOralReadingRecording ?? getOralReadingRecording;
  const uploadRecording = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 2 * 1024 * 1024, files: MAX_SEGMENTS, fields: 0, parts: MAX_SEGMENTS },
  }).array("audio", MAX_SEGMENTS);
  const assessPronunciation = dependencies.assessPronunciation ?? assessPronunciationWav;
  // Shares the per-user speech-to-text budget size (speechAccess.js); a full
  // five-minute reading is at most 12 parts.
  const pronunciationLimiter = dependencies.pronunciationLimiter
    ?? createRequestLimiter({ ...SPEECH_RATE_LIMITS.stt });
  const uploadPronunciationPart = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_WAV_BYTES, files: 1, fields: 0, parts: 1 },
  }).single("audio");

  router.get("/rooms/:roomId/progress", async (req, res) => {
    try {
      const requester = await authorize(req, dependencies);
      const { getAssignedReadingProgress } = require("../services/assignedReadingProgress");
      const progress = await getAssignedReadingProgress(requester, req.params.roomId, dependencies);
      return res.json({ success: true, progress });
    } catch (error) {
      return sendOralReadingError(res, error, "Unable to load assessment progress.");
    }
  });

  router.get("/admin/passages", async (req, res) => {
    try {
      const requester = await authorizePractice(req, dependencies);
      const { listAdminReadingPassages } = require("../services/adminOralReadingService");
      const passages = await listAdminReadingPassages(requester, dependencies);
      res.set("Cache-Control", "no-store");
      return res.json({ success: true, passages });
    } catch (error) {
      return sendOralReadingError(res, error, "Unable to load reading passages.");
    }
  });

  router.get("/teacher/completion-analytics", async (req, res) => {
    try {
      const requester = await authorizeTeacher(req, dependencies);
      const analytics = await getTeacherCompletionAnalytics(requester, dependencies);
      return res.json({ success: true, analytics });
    } catch (error) {
      return sendOralReadingError(res, error, "Unable to load teacher completion analytics.");
    }
  });

  router.get("/teacher/attempts", async (req, res) => {
    try {
      const requester = await authorizeTeacher(req, dependencies);
      const attempts = await listTeacherAttempts(requester, dependencies);
      return res.json({ success: true, attempts });
    } catch (error) {
      return sendOralReadingError(res, error, "Unable to load student oral-reading results.");
    }
  });

  router.get("/teacher/attempts/:attemptId", async (req, res) => {
    try {
      const requester = await authorizeTeacher(req, dependencies);
      const attempt = await getTeacherAttempt(requester, req.params.attemptId, dependencies);
      return res.json({ success: true, attempt });
    } catch (error) {
      return sendOralReadingError(res, error, "Unable to load the student oral-reading result.");
    }
  });

  router.get("/teacher/attempts/:attemptId/recording", async (req, res) => {
    try {
      const requester = await authorizeTeacher(req, dependencies);
      const recording = await loadRecording(requester, req.params.attemptId, true, dependencies);
      res.set("Cache-Control", "no-store");
      return res.json({ success: true, recording });
    } catch (error) {
      return sendOralReadingError(res, error, "Unable to load recording.");
    }
  });

  router.get("/materials/:materialId", async (req, res) => {
    try {
      const requester = await authorize(req, dependencies);
      const module = await loadAssignedReadingSource(requester, req.params.materialId, req.query, dependencies);
      return res.json({ success: true, module });
    } catch (error) {
      return sendOralReadingError(res, error, "Unable to load the assigned story.");
    }
  });

  router.get("/modules/:moduleId", async (req, res) => {
    try {
      const requester = await authorizePractice(req, dependencies);
      const module = await loadModule(requester, req.params.moduleId, dependencies, req.query);
      return res.json({ success: true, module });
    } catch (error) {
      return sendOralReadingError(res, error, "Unable to load the oral-reading activity.");
    }
  });

  router.get("/attempts", async (req, res) => {
    try {
      const requester = await authorizePractice(req, dependencies);
      const attempts = await (dependencies.listOwnOralReadingAttempts ?? listOwnOralReadingAttempts)(requester, req.query.moduleId, dependencies, req.query);
      return res.json({ success: true, attempts });
    } catch (error) {
      return sendOralReadingError(res, error, "Unable to load your saved results.");
    }
  });

  router.post("/attempts", async (req, res) => {
    try {
      const requester = await authorizePractice(req, dependencies);
      const attempt = await createAttempt(requester, req.body, dependencies);
      return res.status(201).json({ success: true, attempt });
    } catch (error) {
      return sendOralReadingError(res, error, "Unable to save the oral-reading result.");
    }
  });

  router.get("/attempts/:attemptId", async (req, res) => {
    try {
      const requester = await authorizePractice(req, dependencies);
      const attempt = await getAttempt(requester, req.params.attemptId, dependencies);
      return res.json({ success: true, attempt });
    } catch (error) {
      return sendOralReadingError(res, error, "Unable to load the oral-reading result.");
    }
  });

  router.post("/attempts/:attemptId/recording", async (req, res) => {
    try {
      const requester = await authorizePractice(req, dependencies);
      // Ownership is verified before the upload body is read.
      await getAttempt(requester, req.params.attemptId, dependencies);
      uploadRecording(req, res, async (uploadError) => {
        if (uploadError) {
          return res.status(400).json({ success: false, message: "Recording upload is invalid or exceeds the size limit." });
        }
        try {
          await saveRecording(requester, req.params.attemptId, req.files, dependencies);
          return res.json({ success: true });
        } catch (error) {
          return sendOralReadingError(res, error, "Unable to save recording.");
        }
      });
    } catch (error) {
      return sendOralReadingError(res, error, "Unable to save recording.");
    }
  });

  // English only: Azure Pronunciation Assessment of one recorded part (16 kHz
  // PCM WAV) against the passage saved with the learner's own attempt. The
  // reference text never comes from the browser. Feedback is returned for
  // display only; reading accuracy stays the separately saved transcript score.
  router.post("/attempts/:attemptId/pronunciation", async (req, res) => {
    let requester;
    let attempt;
    try {
      requester = await authorizePractice(req, dependencies);
      // Ownership is verified before the upload body is read.
      attempt = await getAttempt(requester, req.params.attemptId, dependencies);
    } catch (error) {
      return sendOralReadingError(res, error, "Unable to check pronunciation.");
    }
    if (attempt.language !== "en") {
      return res.status(422).json({
        success: false, code: "PRONUNCIATION_UNSUPPORTED", message: SAFE_SPEECH_ERRORS.PRONUNCIATION_UNSUPPORTED.message,
      });
    }
    if (typeof attempt.passageSnapshot !== "string" || !attempt.passageSnapshot.trim()) {
      return res.status(422).json({ success: false, code: "STT_INVALID_AUDIO", message: "This reading has no saved passage to compare with." });
    }
    const decision = pronunciationLimiter.take(requester.user.id);
    if (!decision.allowed) {
      res.set("Retry-After", String(decision.retryAfterSeconds));
      return res.status(429).json({ success: false, code: "SPEECH_RATE_LIMITED", message: RATE_LIMITED_MESSAGE });
    }
    return uploadPronunciationPart(req, res, async (uploadError) => {
      const mimeType = req.file?.mimetype?.split(";", 1)[0].trim().toLowerCase();
      if (uploadError || !req.file || !["audio/wav", "audio/x-wav"].includes(mimeType)) {
        return res.status(400).json({ success: false, code: "STT_INVALID_AUDIO", message: "Recording upload is invalid. Please try again." });
      }
      try {
        const pronunciation = await assessPronunciation(req.file.buffer, "en", attempt.passageSnapshot);
        res.set("Cache-Control", "no-store");
        return res.json({ success: true, pronunciation });
      } catch (error) {
        const safe = getSpeechErrorResponse(error);
        // A silent part (for example a pause before Stop) has nothing to score.
        if (safe.code === "NO_SPEECH") {
          res.set("Cache-Control", "no-store");
          return res.json({ success: true, pronunciation: { provider: "azure", locale: "en-US", scale: "0-100", utterances: [] } });
        }
        return res.status(safe.status).json({ success: false, code: safe.code, message: safe.message });
      }
    });
  });

  router.get("/attempts/:attemptId/recording", async (req, res) => {
    try {
      const requester = await authorizePractice(req, dependencies);
      const recording = await loadRecording(requester, req.params.attemptId, false, dependencies);
      res.set("Cache-Control", "no-store");
      return res.json({ success: true, recording });
    } catch (error) {
      return sendOralReadingError(res, error, "Unable to load recording.");
    }
  });

  return router;
}

const oralReadingRouter = createOralReadingRouter();

module.exports = { createOralReadingRouter, oralReadingRouter };
