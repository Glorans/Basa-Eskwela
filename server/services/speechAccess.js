const {
  SupabaseAuthenticationError,
  SupabaseServerConfigurationError,
} = require("./supabaseAdmin");
const {
  OralReadingAuthorizationError,
  authorizeOralReadingPracticeRequest,
} = require("./oralReadingAttemptService");

// Per-user request budgets for the paid Google speech endpoints. A full-length
// reading (five minutes in 25-second parts) needs at most 12 transcription
// requests, and real time limits a learner to about 24 parts per 10 minutes, so
// these budgets leave room for slow readers and retries while capping abuse.
// They limit request counts only; recording duration is not restricted here.
const SPEECH_RATE_LIMITS = Object.freeze({
  stt: Object.freeze({ limit: 60, windowMs: 10 * 60 * 1000 }),
  tts: Object.freeze({ limit: 100, windowMs: 10 * 60 * 1000 }),
});

// Live streaming (/ws/diagnostic/speech): one active session per user, and at
// most this many session starts per user. Each recording opens one session (up
// to the existing five-minute safeguard); over budget, the browser falls back
// to the throttled segment upload above, so reading is never blocked.
const SPEECH_STREAM_SESSION_LIMIT = Object.freeze({ limit: 12, windowMs: 10 * 60 * 1000 });

const SESSION_EXPIRED_MESSAGE = "Your session has expired. Please sign in again.";
const FORBIDDEN_MESSAGE = "Speech practice is not available for this account.";
const RATE_LIMITED_MESSAGE = "Too many speech requests. Please wait a few minutes, then try again.";
const UNAVAILABLE_MESSAGE = "Speech processing is temporarily unavailable. Please try again later.";

// Fixed-window counter kept in this process's memory. It resets on restart and
// is not shared between server instances (see docs/SPEECH_ENDPOINT_SECURITY.md).
function createRequestLimiter({ limit, windowMs, now = Date.now, maxKeys = 10000 }) {
  const windows = new Map();

  function prune(time) {
    for (const [key, window] of windows) {
      if (time >= window.resetAt) windows.delete(key);
    }
  }

  return {
    take(key) {
      const time = now();
      let window = windows.get(key);

      if (!window || time >= window.resetAt) {
        if (!window && windows.size >= maxKeys) prune(time);
        window = { count: 0, resetAt: time + windowMs };
        windows.set(key, window);
      }

      if (window.count >= limit) {
        return {
          allowed: false,
          retryAfterSeconds: Math.max(1, Math.ceil((window.resetAt - time) / 1000)),
        };
      }

      window.count += 1;
      return { allowed: true };
    },
  };
}

function sendAccessError(res, error, log) {
  if (error instanceof SupabaseAuthenticationError) {
    return res.status(401).json({ success: false, code: "AUTH_REQUIRED", message: SESSION_EXPIRED_MESSAGE });
  }

  if (error instanceof OralReadingAuthorizationError) {
    return res.status(403).json({ success: false, code: "SPEECH_FORBIDDEN", message: FORBIDDEN_MESSAGE });
  }

  // Only the error class is logged: never tokens, request bodies or audio.
  log("Speech request authorization failed", { name: error?.name ?? "UnknownError" });

  return res.status(503).json({
    success: false,
    code: "STT_PERMISSION",
    message: error instanceof SupabaseServerConfigurationError
      ? UNAVAILABLE_MESSAGE
      : "Unable to verify your account. Please try again later.",
  });
}

// Authentication, role authorization and throttling all finish before the next
// handler runs, so no upload is written and no provider call starts otherwise.
function createSpeechAccess({
  authorize = (req) => authorizeOralReadingPracticeRequest(req),
  rateLimits = SPEECH_RATE_LIMITS,
  now = Date.now,
  log = console.error,
} = {}) {
  const limiters = {
    stt: createRequestLimiter({ ...rateLimits.stt, now }),
    tts: createRequestLimiter({ ...rateLimits.tts, now }),
  };

  function requireSpeechAccess(kind) {
    const limiter = limiters[kind];

    if (!limiter) {
      throw new Error(`Unknown speech request kind: ${kind}`);
    }

    return async function speechAccess(req, res, next) {
      let requester;

      try {
        requester = await authorize(req);
      } catch (error) {
        return sendAccessError(res, error, log);
      }

      const decision = limiter.take(requester.user.id);

      if (!decision.allowed) {
        res.set("Retry-After", String(decision.retryAfterSeconds));
        return res.status(429).json({ success: false, code: "SPEECH_RATE_LIMITED", message: RATE_LIMITED_MESSAGE });
      }

      // The authorized identity binds M2 transcript receipts to this learner.
      res.locals.speechRequester = requester;
      return next();
    };
  }

  return { requireSpeechAccess };
}

module.exports = {
  FORBIDDEN_MESSAGE,
  RATE_LIMITED_MESSAGE,
  SESSION_EXPIRED_MESSAGE,
  SPEECH_RATE_LIMITS,
  SPEECH_STREAM_SESSION_LIMIT,
  createRequestLimiter,
  createSpeechAccess,
};
