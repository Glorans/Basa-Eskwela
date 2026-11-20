const express = require("express");
const { SupabaseAuthenticationError, SupabaseServerConfigurationError } = require("../services/supabaseAdmin");
const { authorizeOralReadingRequest } = require("../services/oralReadingAttemptService");

// M2 F6: GET /api/diagnostic/initial/:language[?version=] for learners (Students and Independent Learners).
// Returns which initial diagnostic version to take (the active one, or one still accepted for an in-progress session)
// and, for an activated package version, its passage and questions WITHOUT answer keys. The built-in version 3.0
// ships with the app, so only its identity is returned. The server decides; the app cannot choose another version.
function createInitialDiagnosticRouter({ initialAssessments, authorize = (req) => authorizeOralReadingRequest(req), log = console.error } = {}) {
  const router = express.Router();
  router.get("/api/diagnostic/initial/:language", async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const requester = await authorize(req);
      if (!["student", "general_user"].includes(requester?.profile?.role)) {
        return res.status(403).json({ success: false, message: "The initial diagnostic is for learners." });
      }
      if (!["en", "fil"].includes(req.params.language)) return res.status(400).json({ success: false, message: "Choose English or Filipino." });
      const version = typeof req.query.version === "string" && req.query.version ? req.query.version : undefined;
      const delivery = await initialAssessments.delivery(req.params.language, { version });
      if (!delivery) return res.status(409).json({ success: false, code: "ASSESSMENT_CHANGED", message: "This diagnostic was updated. Please start again." });
      return res.json({ success: true, ...delivery });
    } catch (error) {
      const status = error instanceof SupabaseAuthenticationError ? 401
        : error instanceof SupabaseServerConfigurationError ? 503
          : Number.isInteger(error?.statusCode) ? error.statusCode : 500;
      if (status >= 500) log("[M2 initial diagnostic delivery]", { name: error?.name ?? "Error", status });
      return res.status(status).json({ success: false,
        message: status === 401 ? "Your session could not be verified. Please sign in again." : status === 403 ? "The initial diagnostic is for learners."
          : "The diagnostic is temporarily unavailable. Please try again." });
    }
  });
  return router;
}

module.exports = { createInitialDiagnosticRouter };
