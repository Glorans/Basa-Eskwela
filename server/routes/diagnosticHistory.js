const express = require("express");
const {
  authorizeOralReadingRequest,
  authorizeTeacherOralReadingRequest,
} = require("../services/oralReadingAttemptService");
const { SupabaseAuthenticationError, SupabaseServerConfigurationError } = require("../services/supabaseAdmin");
const { listOwnDiagnosticHistory, listTeacherDiagnosticResults } = require("../services/diagnosticHistoryService");

// M2 F3 (read-only). Roles come from the server-side profile, never from the browser:
//   GET /me       Students and Independent Learners: their own results.
//   GET /teacher  Approved Teachers: Students enrolled in their own Learning Rooms.
// School Admin keeps /api/admin/diagnostic-results. System Admin has no F3 access (Appendix N).
function createDiagnosticHistoryRouter({
  authorizeLearner = (req) => authorizeOralReadingRequest(req),
  authorizeTeacher = (req) => authorizeTeacherOralReadingRequest(req),
  listOwn = listOwnDiagnosticHistory,
  listTeacher = listTeacherDiagnosticResults,
  log = console.error,
} = {}) {
  const router = express.Router();
  const handle = (work) => async (req, res) => {
    try {
      res.set("Cache-Control", "no-store");
      res.json({ success: true, ...await work(req) });
    } catch (error) {
      const status = error instanceof SupabaseAuthenticationError ? 401
        : error instanceof SupabaseServerConfigurationError ? 503
          : Number.isInteger(error?.statusCode) && error.statusCode >= 400 && error.statusCode < 500 ? error.statusCode : 500;
      if (status >= 500) log("[M2 diagnostic history]", error?.message);
      res.status(status).json({
        success: false,
        message: status === 401 ? "Your session could not be verified. Please sign in again."
          : status >= 500 ? "Unable to load diagnostic results." : error.message,
      });
    }
  };

  router.get("/me", handle(async (req) => {
    const requester = await authorizeLearner(req);
    if (!["student", "general_user"].includes(requester?.profile?.role)) {
      throw Object.assign(new Error("Learner access is required."), { statusCode: 403 });
    }
    return { results: await listOwn(requester.user.id) };
  }));

  router.get("/teacher", handle(async (req) => {
    const requester = await authorizeTeacher(req);
    if (requester?.profile?.role !== "teacher" || requester.profile.teacher_status !== "approved") {
      throw Object.assign(new Error("Approved Teacher access is required."), { statusCode: 403 });
    }
    return await listTeacher(requester.user.id);
  }));

  return router;
}

module.exports = { createDiagnosticHistoryRouter };
