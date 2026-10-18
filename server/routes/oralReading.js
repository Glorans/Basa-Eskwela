const { loadAssignedReadingSource } = require("../services/assignedReadingSource");
const express = require("express");
const {
  SupabaseAuthenticationError,
  SupabaseServerConfigurationError,
} = require("../services/supabaseAdmin");
const {
  OralReadingAuthorizationError,
  OralReadingPersistenceError,
  authorizeOralReadingRequest,
  authorizeTeacherOralReadingRequest,
  createOralReadingAttempt,
  getOralReadingAttempt,
  getTeacherOralReadingAttempt,
  listTeacherOralReadingAttempts,
  loadAccessiblePublishedModule,
  listOwnOralReadingAttempts,
} = require("../services/oralReadingAttemptService");

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
  const loadModule = dependencies.loadAccessiblePublishedModule ?? loadAccessiblePublishedModule;
  const createAttempt = dependencies.createOralReadingAttempt ?? createOralReadingAttempt;
  const getAttempt = dependencies.getOralReadingAttempt ?? getOralReadingAttempt;
  const authorizeTeacher = dependencies.authorizeTeacherOralReadingRequest
    ?? authorizeTeacherOralReadingRequest;
  const listTeacherAttempts = dependencies.listTeacherOralReadingAttempts
    ?? listTeacherOralReadingAttempts;
  const getTeacherAttempt = dependencies.getTeacherOralReadingAttempt
    ?? getTeacherOralReadingAttempt;

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
      const requester = await authorize(req, dependencies);
      const module = await loadModule(requester, req.params.moduleId, dependencies, req.query);
      return res.json({ success: true, module });
    } catch (error) {
      return sendOralReadingError(res, error, "Unable to load the oral-reading activity.");
    }
  });

  router.get("/attempts", async (req, res) => {
    try {
      const requester = await authorize(req, dependencies);
      const attempts = await (dependencies.listOwnOralReadingAttempts ?? listOwnOralReadingAttempts)(requester, req.query.moduleId, dependencies, req.query);
      return res.json({ success: true, attempts });
    } catch (error) {
      return sendOralReadingError(res, error, "Unable to load your saved results.");
    }
  });

  router.post("/attempts", async (req, res) => {
    try {
      const requester = await authorize(req, dependencies);
      const attempt = await createAttempt(requester, req.body, dependencies);
      return res.status(201).json({ success: true, attempt });
    } catch (error) {
      return sendOralReadingError(res, error, "Unable to save the oral-reading result.");
    }
  });

  router.get("/attempts/:attemptId", async (req, res) => {
    try {
      const requester = await authorize(req, dependencies);
      const attempt = await getAttempt(requester, req.params.attemptId, dependencies);
      return res.json({ success: true, attempt });
    } catch (error) {
      return sendOralReadingError(res, error, "Unable to load the oral-reading result.");
    }
  });

  return router;
}

const oralReadingRouter = createOralReadingRouter();

module.exports = { createOralReadingRouter, oralReadingRouter };
