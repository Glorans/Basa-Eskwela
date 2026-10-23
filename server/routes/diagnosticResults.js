const express = require("express");
const {
  SupabaseAuthenticationError,
  SupabaseServerConfigurationError,
} = require("../services/supabaseAdmin");
const {
  OralReadingAuthorizationError,
  authorizeOralReadingRequest,
} = require("../services/oralReadingAttemptService");
const { createRequestLimiter } = require("../services/speechAccess");
const {
  DiagnosticReceiptConfigurationError,
  createTranscriptReceiptService,
} = require("../services/diagnosticTranscriptReceipts");
const {
  DiagnosticSubmissionError,
  createDiagnosticResultService,
} = require("../services/diagnosticResultService");

// Each language is submitted once; this leaves ample room for network retries.
const DIAGNOSTIC_SUBMISSION_RATE_LIMIT = Object.freeze({ limit: 20, windowMs: 10 * 60 * 1000 });
const SESSION_EXPIRED_MESSAGE = "Your session has expired. Please sign in again.";

function sendDiagnosticError(res, error, log) {
  if (error instanceof SupabaseAuthenticationError) {
    return res.status(401).json({ success: false, code: "AUTH_REQUIRED", message: SESSION_EXPIRED_MESSAGE });
  }
  if (error instanceof OralReadingAuthorizationError) {
    return res.status(403).json({ success: false, code: "DIAGNOSTIC_FORBIDDEN", message: "The diagnostic is available to learner accounts only." });
  }
  if (error instanceof DiagnosticSubmissionError) {
    if (error.statusCode >= 500) log("Diagnostic result save failed", { code: error.code });
    return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message });
  }
  if (error instanceof SupabaseServerConfigurationError || error instanceof DiagnosticReceiptConfigurationError) {
    log("Diagnostic verification is not configured", { name: error.name });
    return res.status(503).json({ success: false, code: "DIAGNOSTIC_UNAVAILABLE", message: "Diagnostic saving is temporarily unavailable. Please try again later." });
  }
  // Only the error class is logged: never tokens, transcripts or answers.
  log("Diagnostic result request failed", { name: error?.name ?? "UnknownError" });
  return res.status(500).json({ success: false, code: "DIAGNOSTIC_SAVE_FAILED", message: "We couldn't save your diagnostic result. Please try again." });
}

// The only write path for diagnostic_results. The browser submits answers and
// server-issued transcript receipts; the backend scores and stores the result.
function createDiagnosticResultsRouter({
  receipts = createTranscriptReceiptService(),
  authorize = (req) => authorizeOralReadingRequest(req),
  service = createDiagnosticResultService({ receipts }),
  rateLimit = DIAGNOSTIC_SUBMISSION_RATE_LIMIT,
  now = Date.now,
  log = console.error,
} = {}) {
  const router = express.Router();
  const limiter = createRequestLimiter({ ...rateLimit, now });

  router.post("/api/diagnostic/results", async (req, res) => {
    let requester;
    try {
      requester = await authorize(req);
    } catch (error) {
      return sendDiagnosticError(res, error, log);
    }
    const decision = limiter.take(requester.user.id);
    if (!decision.allowed) {
      res.set("Retry-After", String(decision.retryAfterSeconds));
      return res.status(429).json({ success: false, code: "DIAGNOSTIC_RATE_LIMITED", message: "Too many attempts. Please wait a few minutes, then try again." });
    }
    try {
      const { row, replayed } = await service.submitInitialDiagnostic(requester, req.body ?? {});
      return res.status(replayed ? 200 : 201).json({ success: true, replayed, result: row });
    } catch (error) {
      return sendDiagnosticError(res, error, log);
    }
  });

  return router;
}

module.exports = { DIAGNOSTIC_SUBMISSION_RATE_LIMIT, createDiagnosticResultsRouter };
