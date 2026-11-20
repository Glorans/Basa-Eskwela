const express = require("express");
const { SupabaseAuthenticationError, SupabaseServerConfigurationError } = require("../services/supabaseAdmin");
const { authorizeDiagnosticPracticeRequest } = require("../services/oralReadingAttemptService");
const { createAssessmentPackageService } = require("../services/assessmentPackageService");
const { createSupabaseAssessmentPackageRepository } = require("../services/assessmentPackageRepository");

// M2 F6 + F10: /api/assessment-packages. Staff only: System Admins, School Admins and APPROVED Teachers (the same
// server-side role check as F7 Practice Mode). Learners get 403 on every route, so passages, questions and answer
// keys never reach them. Which packages each account sees and manages is decided by assessmentPackagePolicy.
//
//   GET    /                                  packages visible to the account (+ what it may create or import)
//   POST   /                                  create a package (Independent Learner, school or Teacher) with a draft 1.0
//   POST   /import-initial                    System Admin: record the code-defined 3.0 diagnostic as published 3.0
//   GET    /:id                               package detail with every version (content, review record)
//   PATCH  /:id                               rename
//   POST   /:id/archive                       archive (read-only afterwards; never deleted)
//   POST   /:id/versions                      new draft version (copied from the published or a chosen version)
//   PATCH  /:id/versions/:versionId           edit a draft
//   DELETE /:id/versions/:versionId           delete a draft
//   POST   /:id/versions/:versionId/educator-reviews   record an educator review (append-only evidence)
//   POST   /:id/versions/:versionId/:action   submit | return | approve | publish | retire
function createAssessmentPackagesRouter({
  authorize = (req) => authorizeDiagnosticPracticeRequest(req),
  service = createAssessmentPackageService({ repository: createSupabaseAssessmentPackageRepository() }),
  log = console.error,
} = {}) {
  const router = express.Router();
  const handle = (work) => async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const requester = await authorize(req);
      res.json({ success: true, ...await work(requester, req) });
    } catch (error) {
      const status = error instanceof SupabaseAuthenticationError ? 401
        : error instanceof SupabaseServerConfigurationError ? 503
          : Number.isInteger(error?.statusCode) && error.statusCode >= 400 && error.statusCode < 500 ? error.statusCode : 500;
      // Only the error class and status are logged: never content, answer keys or tokens.
      if (status >= 500) log("[M2 assessment packages]", { name: error?.name ?? "Error", status });
      res.status(status).json({
        success: false,
        message: status === 401 ? "Your session could not be verified. Please sign in again."
          : status === 403 && error?.name === "OralReadingAuthorizationError"
            ? "Assessment packages are available to System Admins, School Admins and approved Teachers only."
            : status >= 500 ? "Unable to complete the assessment package request." : error.message,
        ...(Array.isArray(error?.issues) ? { issues: error.issues } : {}),
      });
    }
  };

  router.get("/", handle((requester) => service.listPackages(requester)));
  router.post("/", handle((requester, req) => service.createPackage(requester, req.body ?? {})));
  router.post("/import-initial", handle((requester, req) => service.importInitial(requester, req.body ?? {})));
  router.get("/:id", handle((requester, req) => service.getPackage(requester, req.params.id)));
  router.patch("/:id", handle((requester, req) => service.renamePackage(requester, req.params.id, req.body ?? {})));
  router.post("/:id/archive", handle((requester, req) => service.archivePackage(requester, req.params.id)));
  router.post("/:id/versions", handle((requester, req) => service.createVersion(requester, req.params.id, req.body ?? {})));
  router.patch("/:id/versions/:versionId", handle((requester, req) =>
    service.updateDraft(requester, req.params.id, req.params.versionId, req.body ?? {})));
  router.delete("/:id/versions/:versionId", handle((requester, req) =>
    service.deleteDraft(requester, req.params.id, req.params.versionId)));
  // F6: activate a published initial version, or return to the built-in 3.0 (System Admin only).
  router.post("/:id/versions/:versionId/activate", handle((requester, req) =>
    service.setActiveInitialVersion(requester, req.params.id, req.params.versionId, req.body ?? {})));
  router.post("/:id/activation/built-in", handle((requester, req) =>
    service.setActiveInitialVersion(requester, req.params.id, null, req.body ?? {})));
  router.post("/:id/versions/:versionId/educator-reviews", handle((requester, req) =>
    service.recordEducatorReview(requester, req.params.id, req.params.versionId, req.body ?? {})));
  router.post("/:id/versions/:versionId/:action", handle((requester, req) =>
    service.transition(requester, req.params.id, req.params.versionId, req.params.action, req.body ?? {})));

  return router;
}

module.exports = { createAssessmentPackagesRouter };
