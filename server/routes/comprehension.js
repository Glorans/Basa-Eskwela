const express = require("express");

const {
  SupabaseAuthenticationError,
  SupabaseServerConfigurationError,
} = require("../services/supabaseAdmin");

const {
  OralReadingAuthorizationError,
  OralReadingPersistenceError,
} = require("../services/oralReadingAttemptService");

const {
  ComprehensionError,
  authorizeComprehensionRequest,
  startComprehensionAttempt,
  getComprehensionAttempt,
  findComprehensionForReading,
  prefetchOwnedAttempt,
} = require("../services/comprehensionAttemptService");

const {
  applyComprehensionAction,
} = require("../services/comprehensionActionService");

const router = express.Router();

function sendError(res, error) {
  if (error instanceof SupabaseAuthenticationError) {
    return res.status(401).json({
      success: false,
      message: error.message,
    });
  }

  if (error instanceof SupabaseServerConfigurationError) {
    return res.status(503).json({
      success: false,
      message: error.message,
    });
  }

  if (
    error instanceof ComprehensionError ||
    error instanceof OralReadingAuthorizationError ||
    error instanceof require("../services/personalMaterialService").PersonalMaterialError || error instanceof OralReadingPersistenceError
  ) {
    const status = error.statusCode || 500;

    if (status >= 500) {
      console.error("[M6 request failed]", error);
    }

    return res.status(status).json({
      success: false,
      message: error.message,
    });
  }

  console.error("[M6 unexpected error]", error);

  return res.status(500).json({
    success: false,
    message: "Unable to process the comprehension activity.",
  });
}

router.post("/attempts", async (req, res) => {
  try {
    const requester = await authorizeComprehensionRequest(req);
    const attempt = await startComprehensionAttempt(
      requester,
      req.body,
    );

    return res.status(201).json({
      success: true,
      attempt,
    });
  } catch (error) {
    return sendError(res, error);
  }
});

router.get("/attempts/:attemptId", async (req, res) => {
  try {
    // Performance: the owned-attempt read starts while the login is verified (see prefetchOwnedAttempt).
    const prefetched = prefetchOwnedAttempt(req, req.params.attemptId);
    const requester = await authorizeComprehensionRequest(req);
    const attempt = await getComprehensionAttempt(
      requester,
      req.params.attemptId,
      { prefetched },
    );

    return res.json({
      success: true,
      attempt,
    });
  } catch (error) {
    return sendError(res, error);
  }
});

// Read-only: the learner's own M6 activity for one saved reading, or null.
router.get("/readings/:oralReadingAttemptId", async (req, res) => {
  try {
    const requester = await authorizeComprehensionRequest(req);
    const attempt = await findComprehensionForReading(requester, req.params.oralReadingAttemptId);
    return res.json({ success: true, attempt });
  } catch (error) {
    return sendError(res, error);
  }
});

router.post("/attempts/:attemptId/actions", async (req, res) => {
  try {
    const prefetched = prefetchOwnedAttempt(req, req.params.attemptId);
    const requester = await authorizeComprehensionRequest(req);
    const result = await applyComprehensionAction(
      requester,
      req.params.attemptId,
      req.body,
      { prefetched },
    );

    return res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    return sendError(res, error);
  }
});

module.exports = router;