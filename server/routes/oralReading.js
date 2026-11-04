const { loadAssignedReadingSource } = require("../services/assignedReadingSource");
const {
  getTeacherCompletionAnalytics,
} = require("../services/teacherCompletionAnalytics");
const express = require("express");
const multer = require("multer");
const {
  SupabaseAuthenticationError,
  SupabaseServerConfigurationError,
  getSupabaseAdmin,
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
  MAX_BYTES: MAX_RECORDING_BYTES,
  MAX_SEGMENTS,
  getOralReadingRecording,
  saveOralReadingRecording,
} = require("../services/oralReadingRecordingService");
const { assessPronunciationWav } = require("../services/azureSpeechService");
const { splitEmbeddedTitle } = require("../services/oralReadingScoring");
const {
  PronunciationCheckInProgressError,
  SUMMARY_COLUMNS: PRONUNCIATION_SUMMARY_COLUMNS,
  getSavedPronunciationCheck,
  isStale,
  loadPronunciationCheckRow,
  loadRecordingPartCount,
  recordingPartsMismatch,
  runPronunciationCheck,
  toCheckDto,
} = require("../services/pronunciationCheckService");


/**
 * The single-part shape older browsers read (they summarize it themselves), so a
 * backend deployed before the new frontend keeps working. Omitted otherwise.
 */
function legacyPronunciation(parts) {
  return Array.isArray(parts) && parts.length === 1
    ? { provider: "azure", locale: "en-US", scale: "0-100", ...parts[0] }
    : undefined;
}

// Durations only, in development: never audio, transcripts, tokens or user IDs.
function developmentPronunciationTiming(details) {
  if (process.env.NODE_ENV === "development") console.info("[Pronunciation] timing", details);
}
const { getSpeechErrorResponse, SAFE_SPEECH_ERRORS } = require("../services/speechErrors");
const { MAX_WAV_BYTES } = require("../services/wavAudio");

const MAX_PRONUNCIATION_UPLOAD_BYTES = MAX_WAV_BYTES;
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
    // One continuous read-aloud file may be the whole recording, so a single file
    // may use the full recording budget; the service still caps the total size.
    limits: { fileSize: MAX_RECORDING_BYTES, files: MAX_SEGMENTS, fields: 0, parts: MAX_SEGMENTS },
  }).array("audio", MAX_SEGMENTS);
  const assessPronunciation = dependencies.assessPronunciation ?? assessPronunciationWav;
  const pronunciationTiming = dependencies.pronunciationTiming ?? developmentPronunciationTiming;
  // Shares the per-user speech-to-text budget size (speechAccess.js); a full
  // five-minute reading is at most 12 parts.
  const pronunciationLimiter = dependencies.pronunciationLimiter
    ?? createRequestLimiter({ ...SPEECH_RATE_LIMITS.stt });
  // One WAV per saved recording file (normally exactly one), in recorder order.
  // A whole five-minute reading is about 9.6 MB, so the total is capped too.
  const uploadPronunciationParts = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_WAV_BYTES, files: MAX_SEGMENTS, fields: 0, parts: MAX_SEGMENTS },
  }).array("audio", MAX_SEGMENTS);
  const getAdmin = () => dependencies.getSupabaseAdmin?.() ?? getSupabaseAdmin();
  const now = dependencies.now ?? Date.now;
  const runCheck = dependencies.runPronunciationCheck ?? runPronunciationCheck;

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

  // The saved pronunciation check of a student this Teacher may review (same
  // classroom rules as the attempt itself). Read-only; never calls the speech service.
  router.get("/teacher/attempts/:attemptId/pronunciation", async (req, res) => {
    try {
      const requester = await authorizeTeacher(req, dependencies);
      const attempt = await getTeacherAttempt(requester, req.params.attemptId, dependencies);
      const saved = await getSavedPronunciationCheck(getAdmin(), attempt, now());
      res.set("Cache-Control", "no-store");
      return res.json({ success: true, ...saved });
    } catch (error) {
      return sendOralReadingError(res, error, "Unable to load the saved pronunciation check.");
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

  // English only: the learner's saved pronunciation check (F2/F3/F4/F7). Reads
  // the saved result only; it never calls the speech service, so opening a
  // reading or a panel costs nothing.
  router.get("/attempts/:attemptId/pronunciation", async (req, res) => {
    try {
      const requester = await authorizePractice(req, dependencies);
      const attempt = await getAttempt(requester, req.params.attemptId, dependencies);
      const saved = await getSavedPronunciationCheck(getAdmin(), attempt, now());
      res.set("Cache-Control", "no-store");
      return res.json({ success: true, ...saved });
    } catch (error) {
      return sendOralReadingError(res, error, "Unable to load the saved pronunciation check.");
    }
  });

  // English only: Azure Pronunciation Assessment of the learner's whole saved
  // recording (one 16 kHz PCM WAV, up to five minutes) in one continuous
  // session, against the story text the read-aloud screen showed (the saved
  // passage without a hidden title line). Older attempts saved as several
  // files upload one WAV per file in this same request. The reference text
  // never comes from the browser, and neither do scores: the summary is
  // computed here and saved once per attempt. A saved result is returned
  // without a new assessment; a check already running for the attempt is
  // never duplicated. Reading accuracy stays separate.
  router.post("/attempts/:attemptId/pronunciation", async (req, res) => {
    const receivedAt = Date.now();
    let requester;
    let attempt;
    let supabase;
    let installed = true;
    let expectedParts = 0;
    try {
      requester = await authorizePractice(req, dependencies);
      // Ownership is verified before the upload body is read.
      attempt = await getAttempt(requester, req.params.attemptId, dependencies);
      if (attempt.language === "en") {
        supabase = getAdmin();
        const existing = await loadPronunciationCheckRow(supabase, attempt.id, PRONUNCIATION_SUMMARY_COLUMNS);
        installed = existing.installed;
        // Reopening, refreshing or signing in again reuses the saved result: no new paid assessment.
        if (existing.row?.status === "completed") {
          res.set("Cache-Control", "no-store");
          return res.json({ success: true, saved: true, reused: true, check: toCheckDto(existing.row, attempt),
            pronunciation: legacyPronunciation(existing.row.parts) });
        }
        if (existing.row?.status === "running" && !isStale(existing.row, now())) {
          throw new PronunciationCheckInProgressError();
        }
        // The trusted number of saved recording files (server-written metadata).
        expectedParts = await loadRecordingPartCount(supabase, attempt.id);
      }
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
    if (expectedParts < 1) {
      return res.status(422).json({ success: false, code: "PRONUNCIATION_RECORDING_MISSING", message: "There is no saved recording to check yet." });
    }
    const decision = pronunciationLimiter.take(requester.user.id);
    if (!decision.allowed) {
      res.set("Retry-After", String(decision.retryAfterSeconds));
      return res.status(429).json({ success: false, code: "SPEECH_RATE_LIMITED", message: RATE_LIMITED_MESSAGE });
    }
    return uploadPronunciationParts(req, res, async (uploadError) => {
      const files = req.files ?? [];
      const totalBytes = files.reduce((total, file) => total + file.size, 0);
      const validWav = (file) => ["audio/wav", "audio/x-wav"].includes(file.mimetype?.split(";", 1)[0].trim().toLowerCase());
      if (uploadError || !files.length || !files.every(validWav) || totalBytes > MAX_PRONUNCIATION_UPLOAD_BYTES) {
        return res.status(400).json({ success: false, code: "STT_INVALID_AUDIO", message: "Recording upload is invalid. Please try again." });
      }
      // Every saved recording file, once, in order: a partial upload is refused
      // here, before any claim is taken or any paid assessment runs.
      const mismatch = recordingPartsMismatch(files, expectedParts);
      if (mismatch) {
        return res.status(400).json({ success: false, code: "PRONUNCIATION_RECORDING_MISMATCH", message: mismatch });
      }
      const uploadedAt = Date.now();
      // Without saved results, a browser that gives up stops the assessment. Once a
      // check is claimed it runs to the end and is saved, so a refresh does not pay twice.
      const abandoned = new AbortController();
      let persisted = false;
      res.on("close", () => { if (!res.writableFinished && !persisted) abandoned.abort(); });
      const reference = splitEmbeddedTitle(attempt.passageSnapshot, attempt.passageTitle, "en").body;
      const finished = () => {
        const assessmentMs = Date.now() - uploadedAt;
        if (!res.headersSent) res.set("Server-Timing", `checks;dur=${uploadedAt - receivedAt}, assessment;dur=${assessmentMs}`);
        pronunciationTiming({
          checksAndUploadMs: uploadedAt - receivedAt, assessmentMs, audioBytes: totalBytes, abandoned: abandoned.signal.aborted,
        });
      };
      const assessParts = async ({ persisted: claimed, beforeNextPart }) => {
        persisted = claimed;
        const parts = [];
        for (const [index, file] of files.entries()) {
          // Renews the claim's lease between parts, so a long older multi-file
          // check is never mistaken for an abandoned one.
          if (index > 0) await beforeNextPart?.();
          try {
            parts.push(await assessPronunciation(file.buffer, "en", reference, { signal: abandoned.signal }));
          } catch (error) {
            // A silent part (for example a pause before Stop) has nothing to score.
            if (getSpeechErrorResponse(error).code !== "NO_SPEECH") throw error;
            parts.push({ provider: "azure", locale: "en-US", scale: "0-100", utterances: [] });
          }
        }
        return { parts, partBytes: files.map((file) => file.size) };
      };
      let outcome;
      try {
        outcome = await runCheck({ supabase, attempt, userId: requester.user.id, assessParts, now, persisted: installed });
      } catch (error) {
        finished();
        if (error instanceof OralReadingPersistenceError) return sendOralReadingError(res, error, "Unable to check pronunciation.");
        const safe = getSpeechErrorResponse(error);
        return res.status(safe.status).json({ success: false, code: safe.code, message: safe.message });
      }
      finished();
      if (res.writableEnded || res.destroyed) return undefined;
      res.set("Cache-Control", "no-store");
      return res.json({
        success: true,
        saved: outcome.saved,
        ...(outcome.reused ? { reused: true } : {}),
        ...(outcome.saved ? {} : { code: outcome.code, message: outcome.message }),
        check: outcome.check,
        pronunciation: legacyPronunciation(outcome.parts),
      });
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
