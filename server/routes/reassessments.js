const express = require("express");
const { SupabaseAuthenticationError, SupabaseServerConfigurationError } = require("../services/supabaseAdmin");
const { authorizeDiagnosticPracticeRequest, authorizeOralReadingRequest } = require("../services/oralReadingAttemptService");
const { createReassessmentAssignmentService } = require("../services/reassessmentAssignmentService");
const { createSupabaseReassessmentRepository } = require("../services/reassessmentAssignmentRepository");

// M2 F9 Assign Reassessment: /api/reassessments. Roles come from the server-side profile. The staff role check admits
// System Admin, School Admin and approved Teachers; the service then admits only School Admins and approved Teachers.
// Students, Independent Learners and pending Teachers are refused before any lookup.
//
//   GET  /overview                              gate state, authorized active rooms, assignable packages
//   GET  /assignable-packages?roomId=           packages with eligibility (and the reason when not eligible)
//   GET  /rooms/:roomId/students?packageVersionId=   enrolled Students and, per Student, why they cannot receive it
//   GET  /assignments?status=&roomId=           authorized classroom assignments
//   POST /assignments                           { roomId, packageVersionId, mode: "selected"|"all_eligible", studentIds?, dueDate? }
//   POST /assignments/:id/cancel                { reason }
// M2 F8 (Students; the learner id always comes from the verified session):
//   GET  /me                                    own reassessments (Students: classroom; Independent Learners: own + what can start)
//   POST /me/independent/start                  { packageVersionId } Independent Learners only
//   GET  /me/:assignmentId/content              passage, title, questions and choices (never answer keys)
//   POST /me/:assignmentId/result               { transcriptReceipts, answers, recordingDurationSeconds }
function createReassessmentsRouter({
  authorize = (req) => authorizeDiagnosticPracticeRequest(req),
  service = createReassessmentAssignmentService({ repository: createSupabaseReassessmentRepository() }),
  // Students and Independent Learners pass this check; the delivery service then admits Students only.
  authorizeLearner = (req) => authorizeOralReadingRequest(req),
  delivery = null,
  log = console.error,
} = {}) {
  const router = express.Router();
  const handle = (work, authorizeWith = authorize) => async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const requester = await authorizeWith(req);
      res.json({ success: true, ...await work(requester, req) });
    } catch (error) {
      const status = error instanceof SupabaseAuthenticationError ? 401
        : error instanceof SupabaseServerConfigurationError ? 503
          : Number.isInteger(error?.statusCode) && error.statusCode >= 400 && error.statusCode < 600 ? error.statusCode : 500;
      if (status >= 500) log("[M2 reassessment assignments]", { name: error?.name ?? "Error", code: error?.code, status });
      const forbidden = status === 403 && error?.name === "OralReadingAuthorizationError";
      const learnerRoute = req.path.startsWith("/me");
      res.status(status).json({
        success: false,
        code: status === 401 ? "AUTH_REQUIRED" : forbidden ? (learnerRoute ? "REASSESSMENT_FORBIDDEN" : "ASSIGNMENT_FORBIDDEN") : error?.code ?? "REASSESSMENT_FAILED",
        message: status === 401 ? "Your session could not be verified. Please sign in again."
          : forbidden ? (learnerRoute ? "Reassessments are available to Students and Independent Learners."
            : "Reassessment assignments are available to School Admins and approved Teachers only.")
            : status >= 500 && status !== 503 ? "Unable to complete the reassessment request." : error.message,
        ...(Array.isArray(error?.ineligible) ? { ineligible: error.ineligible } : {}),
      });
    }
  };

  // F8 Student routes first, so "/me" is never read as a staff path.
  const requireDelivery = () => {
    if (!delivery) throw Object.assign(new Error("Reassessment is not available yet."), { statusCode: 503, code: "REASSESSMENT_NOT_INSTALLED" });
    return delivery;
  };
  router.get("/me", handle((requester) => requireDelivery().listMine(requester), authorizeLearner));
  // F8 Independent Learners: self-start a centrally approved Independent Learner reassessment (safe to repeat).
  router.post("/me/independent/start", handle((requester, req) => requireDelivery().startIndependent(requester, req.body ?? {}), authorizeLearner));
  router.get("/me/:assignmentId/content", handle((requester, req) => requireDelivery().getContent(requester, req.params.assignmentId), authorizeLearner));
  router.post("/me/:assignmentId/result", handle(async (requester, req) =>
    ({ result: await requireDelivery().submitResult(requester, req.params.assignmentId, req.body ?? {}) }), authorizeLearner));

  router.get("/overview", handle((requester) => service.overview(requester)));
  router.get("/assignable-packages", handle((requester, req) =>
    service.assignablePackagesForRoom(requester, typeof req.query.roomId === "string" ? req.query.roomId : undefined)));
  router.get("/rooms/:roomId/students", handle((requester, req) =>
    service.roomRoster(requester, req.params.roomId, typeof req.query.packageVersionId === "string" ? req.query.packageVersionId : undefined)));
  router.get("/assignments", handle((requester, req) => service.listAssignments(requester, {
    status: typeof req.query.status === "string" && req.query.status ? req.query.status : undefined,
    roomId: typeof req.query.roomId === "string" && req.query.roomId ? req.query.roomId : undefined,
  })));
  router.post("/assignments", handle((requester, req) => service.createAssignments(requester, req.body ?? {})));
  router.post("/assignments/:id/cancel", handle((requester, req) => service.cancelAssignment(requester, req.params.id, req.body ?? {})));

  return router;
}

module.exports = { createReassessmentsRouter };
