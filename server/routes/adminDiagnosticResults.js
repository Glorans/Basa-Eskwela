const express = require("express");
const {
  AdminAuthorizationError,
  AdminUserOperationError,
  authorizeAdminRequest,
} = require("../services/adminUserService");
const {
  listAdminDiagnosticResults,
} = require("../services/adminDiagnosticResultService");
const {
  SupabaseAuthenticationError,
  SupabaseServerConfigurationError,
} = require("../services/supabaseAdmin");

function sendAdminDiagnosticError(res, error) {
  if (error instanceof SupabaseAuthenticationError) {
    return res.status(401).json({ success: false, message: error.message });
  }

  if (error instanceof AdminAuthorizationError || error instanceof AdminUserOperationError) {
    return res.status(error.statusCode).json({ success: false, message: error.message });
  }

  if (error instanceof SupabaseServerConfigurationError) {
    return res.status(503).json({ success: false, message: error.message });
  }

  console.error("Unexpected Admin diagnostic-results failure:", error);
  return res.status(500).json({
    success: false,
    message: "Unable to load diagnostic results.",
  });
}

function createAdminDiagnosticResultsRouter(dependencies = {}) {
  const router = express.Router();
  const authorize = dependencies.authorizeAdminRequest ?? authorizeAdminRequest;
  const listResults = dependencies.listAdminDiagnosticResults
    ?? listAdminDiagnosticResults;

  router.get("/", async (req, res) => {
    try {
      await authorize(req);
      return res.json({ success: true, results: await listResults() });
    } catch (error) {
      return sendAdminDiagnosticError(res, error);
    }
  });

  return router;
}

module.exports = {
  adminDiagnosticResultsRouter: createAdminDiagnosticResultsRouter(),
  createAdminDiagnosticResultsRouter,
};
