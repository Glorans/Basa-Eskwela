const express = require("express");
const {
  AdminAuthorizationError,
  authorizeAdminRequest,
} = require("../services/adminUserService");
const { OralReadingPersistenceError } = require("../services/oralReadingAttemptService");
const {
  getStudentAttempt,
  getStudentPronunciationCheck,
  getStudentRecording,
  listStudentReadings,
  listStudentsWithReadings,
} = require("../services/adminStudentReadingService");
const {
  SupabaseAuthenticationError,
  SupabaseServerConfigurationError,
} = require("../services/supabaseAdmin");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * One line per request. Server logs are NOT a permanent audit record: they can
 * rotate or disappear (docs/M5_ADMIN_STUDENT_READING_REVIEW.md). Only these five
 * fields are ever written: no names, transcripts, recordings, tokens or signed URLs.
 */
function defaultAccessLog(entry) {
  console.info("[M5 admin student review]", JSON.stringify(entry));
}

function outcomeOf(error) {
  if (error instanceof SupabaseAuthenticationError) return "unauthenticated";
  if (error instanceof AdminAuthorizationError) return "forbidden";
  if (error?.statusCode === 404) return "not_found";
  return "error";
}

function sendError(res, error) {
  if (error instanceof SupabaseAuthenticationError) return res.status(401).json({ success: false, message: error.message });
  if (error instanceof AdminAuthorizationError) return res.status(403).json({ success: false, message: error.message });
  if (error instanceof OralReadingPersistenceError) {
    return res.status(error.statusCode).json({ success: false, message: error.message, code: error.code });
  }
  if (error instanceof SupabaseServerConfigurationError) return res.status(503).json({ success: false, message: error.message });
  // The class only: errors can carry query details.
  console.error("Unexpected Admin student-review failure:", error?.name ?? "UnknownError");
  return res.status(500).json({ success: false, message: "Student reading assessments could not be loaded. Please try again." });
}

/**
 * Admin "Student Reading Assessments". GET only, so this router has no way to
 * change a result or start a pronunciation assessment.
 */
function createAdminStudentReadingRouter(dependencies = {}) {
  const router = express.Router();
  const authorize = dependencies.authorizeAdminRequest ?? authorizeAdminRequest;
  const accessLog = dependencies.accessLog ?? defaultAccessLog;
  const now = dependencies.logNow ?? (() => new Date().toISOString());

  const handle = (operation, respond) => async (req, res) => {
    // Browser-supplied text is never logged: only a well-formed ID.
    const attemptId = UUID_PATTERN.test(req.params.attemptId ?? "") ? req.params.attemptId : null;
    let adminId = null;
    try {
      const requester = await authorize(req, dependencies);
      adminId = requester.user.id;
      // M1 multi-tenancy: every read is limited to the School Admin's own school (from the database profile).
      const scoped = { ...dependencies, schoolId: requester.schoolId ?? requester.profile?.school_id ?? null };
      const body = await respond(req, requester, scoped);
      accessLog({ adminId, attemptId, at: now(), operation, outcome: "allowed" });
      res.set("Cache-Control", "no-store");
      return res.json({ success: true, ...body });
    } catch (error) {
      accessLog({ adminId, attemptId, at: now(), operation, outcome: outcomeOf(error) });
      return sendError(res, error);
    }
  };

  router.get("/students", handle("list_students", async (_req, _requester, scoped) => ({
    students: await listStudentsWithReadings(scoped),
  })));

  router.get("/students/:studentId/attempts", handle("list_student_readings", async (req, _requester, scoped) => (
    listStudentReadings(req.params.studentId, scoped)
  )));

  router.get("/attempts/:attemptId", handle("view_assessment", async (req, _requester, scoped) => ({
    attempt: await getStudentAttempt(req.params.attemptId, scoped),
  })));

  router.get("/attempts/:attemptId/pronunciation", handle("view_pronunciation", async (req, _requester, scoped) => (
    getStudentPronunciationCheck(req.params.attemptId, scoped)
  )));

  router.get("/attempts/:attemptId/recording", handle("open_recording", async (req, requester, scoped) => ({
    recording: await getStudentRecording(requester, req.params.attemptId, scoped),
  })));

  return router;
}

module.exports = {
  adminStudentReadingRouter: createAdminStudentReadingRouter(),
  createAdminStudentReadingRouter,
};
