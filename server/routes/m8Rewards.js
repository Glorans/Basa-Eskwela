const express = require("express");
const {
  SupabaseAuthenticationError,
  SupabaseServerConfigurationError,
  getAuthenticatedSupabaseUser,
  getSupabaseAdmin,
} = require("../services/supabaseAdmin");
const { createRequestLimiter } = require("../services/speechAccess");

// Before the M8 F1 proposal is installed the call does nothing.
const NOT_INSTALLED_CODES = new Set(["42883", "PGRST202", "PGRST205", "42P01"]);
// Page loads and tab focus call this; the database allows one award per Manila date regardless.
const DAILY_LOGIN_LIMIT = Object.freeze({ limit: 30, windowMs: 10 * 60 * 1000 });

function createM8RewardsRouter(dependencies = {}) {
  const router = express.Router();
  const authenticate = dependencies.getAuthenticatedSupabaseUser ?? getAuthenticatedSupabaseUser;
  const getAdmin = dependencies.getSupabaseAdmin ?? getSupabaseAdmin;
  const limiter = dependencies.limiter ?? createRequestLimiter({ ...DAILY_LOGIN_LIMIT });
  const log = dependencies.log ?? console.error;

  // The learner comes from the verified token, the role from the database and the date from the
  // database clock. The request body is never read.
  router.post("/daily-login", async (req, res) => {
    try {
      const user = await authenticate(req);
      const decision = limiter.take(user.id);
      if (!decision.allowed) {
        res.set("Retry-After", String(decision.retryAfterSeconds));
        return res.status(429).json({ success: false, code: "RATE_LIMITED", message: "Please try again later." });
      }
      const { data, error } = await getAdmin().rpc("m8_claim_daily_login", { p_user: user.id });
      res.set("Cache-Control", "no-store");
      if (error) {
        if (NOT_INSTALLED_CODES.has(error.code)) return res.json({ success: true, eligible: false, awarded: false });
        log("M8 daily login failed", { code: error.code });
        return res.status(500).json({ success: false, message: "Unable to record the daily login." });
      }
      return res.json({ success: true, ...data });
    } catch (error) {
      if (error instanceof SupabaseAuthenticationError) {
        return res.status(401).json({ success: false, message: error.message });
      }
      if (error instanceof SupabaseServerConfigurationError) {
        return res.status(503).json({ success: false, message: error.message });
      }
      log("M8 daily login failed", { name: error?.name });
      return res.status(500).json({ success: false, message: "Unable to record the daily login." });
    }
  });

  return router;
}

module.exports = { createM8RewardsRouter };
