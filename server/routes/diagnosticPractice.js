const express = require("express");
const { SupabaseAuthenticationError, SupabaseServerConfigurationError } = require("../services/supabaseAdmin");
const { OralReadingAuthorizationError, authorizeDiagnosticPracticeRequest } = require("../services/oralReadingAttemptService");
const { createRequestLimiter } = require("../services/speechAccess");
const { DiagnosticReceiptConfigurationError, createTranscriptReceiptService } = require("../services/diagnosticTranscriptReceipts");
const { DiagnosticSubmissionError } = require("../services/diagnosticResultService");
const { createDiagnosticPracticeService } = require("../services/diagnosticPracticeService");
const { createPracticeVersionService } = require("../services/practiceVersionService");

// Staff may practise repeatedly; this only bounds automated misuse.
const DIAGNOSTIC_PRACTICE_RATE_LIMIT = Object.freeze({ limit: 30, windowMs: 10 * 60 * 1000 });

function sendPracticeError(res, error, log) {
  if (error instanceof SupabaseAuthenticationError) {
    return res.status(401).json({ success: false, code: "AUTH_REQUIRED", message: "Your session has expired. Please sign in again." });
  }
  if (error instanceof OralReadingAuthorizationError) {
    return res.status(403).json({ success: false, code: "PRACTICE_FORBIDDEN", message: "Practice Mode is available to staff accounts only." });
  }
  if (error instanceof DiagnosticSubmissionError) {
    return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message });
  }
  if (error instanceof SupabaseServerConfigurationError || error instanceof DiagnosticReceiptConfigurationError) {
    log("Diagnostic practice is not configured", { name: error.name });
    return res.status(503).json({ success: false, code: "PRACTICE_UNAVAILABLE", message: "Practice Mode is temporarily unavailable. Please try again later." });
  }
  // Only the error class is logged: never tokens, transcripts or answers.
  log("Diagnostic practice request failed", { name: error?.name ?? "UnknownError" });
  return res.status(500).json({ success: false, code: "PRACTICE_FAILED", message: "We couldn't score this practice attempt. Please try again." });
}

// M2 F7: POST /api/diagnostic/practice scores a staff practice attempt and RETURNS it. Nothing is stored.
// Learners are refused here; their official diagnostic stays on POST /api/diagnostic/results (learners only).
function createDiagnosticPracticeRouter({
  receipts = createTranscriptReceiptService(),
  authorize = (req) => authorizeDiagnosticPracticeRequest(req),
  practiceVersions = createPracticeVersionService(),
  service = createDiagnosticPracticeService({ receipts, practiceVersions }),
  rateLimit = DIAGNOSTIC_PRACTICE_RATE_LIMIT,
  now = Date.now,
  log = console.error,
} = {}) {
  const router = express.Router();
  const limiter = createRequestLimiter({ ...rateLimit, now });

  router.post("/api/diagnostic/practice", async (req, res) => {
    res.set("Cache-Control", "no-store");
    let requester;
    try {
      requester = await authorize(req);
    } catch (error) {
      return sendPracticeError(res, error, log);
    }
    const decision = limiter.take(requester.user.id);
    if (!decision.allowed) {
      res.set("Retry-After", String(decision.retryAfterSeconds));
      return res.status(429).json({ success: false, code: "PRACTICE_RATE_LIMITED", message: "Too many practice attempts. Please wait a few minutes, then try again." });
    }
    try {
      return res.status(200).json({ success: true, result: await service.scorePractice(requester, req.body ?? {}) });
    } catch (error) {
      return sendPracticeError(res, error, log);
    }
  });

  // M2 F7 + F10: the passage and questions (no answer keys) of a package version this staff member may practise: a
  // published Initial Diagnostic version (System Admin) or the published version of a reassessment package its manager
  // owns (System Admin, School Admin, the owning Teacher). Drafts and unpublished versions are refused.
  router.get("/api/diagnostic/practice/versions/:versionId", async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const requester = await authorize(req);
      return res.status(200).json({ success: true, data: await practiceVersions.getContent(requester, req.params.versionId) });
    } catch (error) {
      return sendPracticeError(res, error, log);
    }
  });

  return router;
}

module.exports = { DIAGNOSTIC_PRACTICE_RATE_LIMIT, createDiagnosticPracticeRouter };
