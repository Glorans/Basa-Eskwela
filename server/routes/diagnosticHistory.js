const express = require("express");
const {
  authorizeOralReadingRequest,
  authorizeTeacherOralReadingRequest,
} = require("../services/oralReadingAttemptService");
const { SupabaseAuthenticationError, SupabaseServerConfigurationError } = require("../services/supabaseAdmin");
const { listOwnDiagnosticHistory, listTeacherDiagnosticResults } = require("../services/diagnosticHistoryService");
const { getPlacement: getReadingPlacement, readPlacementSwitch } = require("../services/currentReadingLevelService");
const { buildReadingProgress } = require("../services/readingProgressService");
const { listSchoolStudentResults } = require("../services/diagnosticHistoryService");
const { authorizeDiagnosticPracticeRequest } = require("../services/oralReadingAttemptService");
const { getSupabaseAdmin } = require("../services/supabaseAdmin");

// M2 F3 (read-only). Roles come from the server-side profile, never from the browser:
//   GET /me       Students and Independent Learners: their own results.
//   GET /placement/:language  Students and Independent Learners: their own M3 placement for one language.
//   GET /teacher  Approved Teachers: Students currently enrolled in their own ACTIVE (not archived) Learning Rooms.
// School Admin keeps /api/admin/diagnostic-results. System Admin has no F3 access (Appendix N).
function createDiagnosticHistoryRouter({
  authorizeLearner = (req) => authorizeOralReadingRequest(req),
  authorizeTeacher = (req) => authorizeTeacherOralReadingRequest(req),
  listOwn = listOwnDiagnosticHistory,
  listTeacher = listTeacherDiagnosticResults,
  // M3 placement (the learner's own, per language). Initial diagnostic unless an approved policy says otherwise.
  getPlacement = getReadingPlacement,
  // M2 F5 (official reading-level progress). School Admin only for the school list (System Admin has no F5 access).
  authorizeSchoolAdmin = (req) => authorizeDiagnosticPracticeRequest(req),
  listSchool = listSchoolStudentResults,
  placementSwitch = () => readPlacementSwitch(getSupabaseAdmin()),
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

  router.get("/placement/:language", handle(async (req) => {
    const requester = await authorizeLearner(req);
    if (!["student", "general_user"].includes(requester?.profile?.role)) {
      throw Object.assign(new Error("Learner access is required."), { statusCode: 403 });
    }
    if (!["en", "fil"].includes(req.params.language)) throw Object.assign(new Error("Choose English or Filipino."), { statusCode: 400 });
    return { placement: await getPlacement(requester.user.id, req.params.language) };
  }));

  // F5: the learner's own progress (Students and Independent Learners).
  router.get("/progress/me", handle(async (req) => {
    const requester = await authorizeLearner(req);
    if (!["student", "general_user"].includes(requester?.profile?.role)) {
      throw Object.assign(new Error("Learner access is required."), { statusCode: 403 });
    }
    const [results, followsReassessment] = await Promise.all([listOwn(requester.user.id), placementSwitch()]);
    return { followsReassessment, progress: buildReadingProgress(results, { followsReassessment }) };
  }));

  // F5: approved Teachers, Students currently enrolled in their own ACTIVE Learning Rooms (the F3 scope).
  router.get("/progress/teacher", handle(async (req) => {
    const requester = await authorizeTeacher(req);
    if (requester?.profile?.role !== "teacher" || requester.profile.teacher_status !== "approved") {
      throw Object.assign(new Error("Approved Teacher access is required."), { statusCode: 403 });
    }
    const [{ students }, followsReassessment] = await Promise.all([listTeacher(requester.user.id), placementSwitch()]);
    return { followsReassessment, students: students.map(({ results, ...s }) => ({ ...s, progress: buildReadingProgress(results, { followsReassessment }) })) };
  }));

  // F5: School Admin, every Student (single-school pilot); Independent Learners are excluded from school reporting.
  router.get("/progress/school", handle(async (req) => {
    const requester = await authorizeSchoolAdmin(req);
    if (requester?.profile?.role !== "admin") throw Object.assign(new Error("School Admin access is required."), { statusCode: 403 });
    const [students, followsReassessment] = await Promise.all([listSchool(), placementSwitch()]);
    return { followsReassessment, students: students.map(({ results, ...s }) => ({ ...s, progress: buildReadingProgress(results, { followsReassessment }) })) };
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
