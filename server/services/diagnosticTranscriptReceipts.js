const { createHmac, randomUUID, timingSafeEqual } = require("node:crypto");

// A transcript receipt is the server's signed statement that Azure Speech returned
// this FINAL transcript, through this backend, for this user's audio in this
// language, while the learner was reading this M2 diagnostic (active assessment
// id/version and passage hash, checked by the server when the audio arrived).
// The browser keeps it while the learner answers the questions and sends it
// back; the scoring endpoint accepts transcripts only from receipts.
// Receipts are signed, not encrypted: they contain only the learner's own
// transcript, which the browser already receives for display.
const RECEIPT_CONTEXT = "readflow.m2.transcript-receipt.v1";
const RECEIPT_VERSION = 1;
// Matches the diagnostic session recovery window (diagnosticSession.ts).
const RECEIPT_TTL_MS = 24 * 60 * 60 * 1000;
const RECEIPT_CLOCK_SKEW_MS = 60 * 1000;
const MAX_RECEIPT_LENGTH = 64 * 1024;
const MIN_SECRET_LENGTH = 32;
const RECEIPT_SOURCES = Object.freeze(["stream", "upload"]);
// Only Module 2's initial diagnostic receives receipts; M5 read-alouds never do.
const RECEIPT_PURPOSE = "m2-initial-diagnostic";
const PASSAGE_HASH_PATTERN = /^[0-9a-f]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class DiagnosticReceiptConfigurationError extends Error {
  constructor() {
    super("Diagnostic verification is not configured on the server.");
    this.name = "DiagnosticReceiptConfigurationError";
  }
}

class DiagnosticReceiptError extends Error {
  constructor(reason) {
    super("The diagnostic reading could not be verified.");
    this.name = "DiagnosticReceiptError";
    this.reason = reason;
  }
}

function isUuid(value) {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function readSecret(secret) {
  const value = typeof secret === "string" ? secret.trim() : "";
  if (value.length < MIN_SECRET_LENGTH) throw new DiagnosticReceiptConfigurationError();
  return value;
}

function encode(value) {
  return Buffer.from(value).toString("base64url");
}

/**
 * The secret is read lazily so a missing DIAGNOSTIC_RECEIPT_SECRET fails closed
 * per request (503) instead of preventing the rest of the server from starting.
 */
function createTranscriptReceiptService({
  getSecret = () => process.env.DIAGNOSTIC_RECEIPT_SECRET,
  now = Date.now,
  ttlMs = RECEIPT_TTL_MS,
} = {}) {
  function mac(secret, payload) {
    return createHmac("sha256", secret).update(`${RECEIPT_CONTEXT}.${payload}`).digest();
  }

  function issue({
    userId, language, binding, recordingId, segmentIndex, source, text, confidence, audioSeconds,
  }) {
    const secret = readSecret(getSecret());
    if (typeof userId !== "string" || !userId || !RECEIPT_SOURCES.includes(source)
      || !isUuid(recordingId) || !Number.isInteger(segmentIndex) || segmentIndex < 1
      || typeof text !== "string" || !text.trim()
      || typeof binding?.assessmentId !== "string" || typeof binding.assessmentVersion !== "string"
      || !PASSAGE_HASH_PATTERN.test(binding.passageHash ?? "")) {
      throw new Error("Invalid transcript receipt claims.");
    }
    const claims = {
      v: RECEIPT_VERSION,
      p: RECEIPT_PURPOSE,
      sub: userId,
      lang: language,
      aid: binding.assessmentId,
      aver: binding.assessmentVersion,
      ph: binding.passageHash,
      rid: recordingId.toLowerCase(),
      seg: segmentIndex,
      src: source,
      text: text.trim(),
      ...(Number.isFinite(confidence) ? { conf: confidence } : {}),
      ...(Number.isFinite(audioSeconds) && audioSeconds > 0 ? { secs: audioSeconds } : {}),
      iat: now(),
    };
    const payload = encode(JSON.stringify(claims));
    return `${payload}.${mac(secret, payload).toString("base64url")}`;
  }

  /** Returns the verified claims, or throws DiagnosticReceiptError. */
  function verify(token) {
    const secret = readSecret(getSecret());
    if (typeof token !== "string" || token.length > MAX_RECEIPT_LENGTH) throw new DiagnosticReceiptError("format");
    const parts = token.split(".");
    if (parts.length !== 2 || !parts[0] || !parts[1]) throw new DiagnosticReceiptError("format");
    const [payload, signature] = parts;
    const expected = mac(secret, payload);
    const actual = Buffer.from(signature, "base64url");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw new DiagnosticReceiptError("signature");
    }
    let claims;
    try { claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); }
    catch { throw new DiagnosticReceiptError("format"); }
    if (!claims || claims.v !== RECEIPT_VERSION || claims.p !== RECEIPT_PURPOSE || typeof claims.sub !== "string"
      || typeof claims.lang !== "string" || typeof claims.aid !== "string" || typeof claims.aver !== "string"
      || typeof claims.ph !== "string" || !isUuid(claims.rid) || !Number.isInteger(claims.seg)
      || !RECEIPT_SOURCES.includes(claims.src) || typeof claims.text !== "string" || !Number.isFinite(claims.iat)) {
      throw new DiagnosticReceiptError("format");
    }
    const time = now();
    if (claims.iat > time + RECEIPT_CLOCK_SKEW_MS) throw new DiagnosticReceiptError("issued-in-future");
    if (time - claims.iat > ttlMs) throw new DiagnosticReceiptError("expired");
    return claims;
  }

  /** Checked before any provider call, so a misconfigured server spends nothing. */
  function assertConfigured() {
    readSecret(getSecret());
  }

  return { issue, verify, assertConfigured, newRecordingId: randomUUID };
}

module.exports = {
  DiagnosticReceiptConfigurationError,
  DiagnosticReceiptError,
  MAX_RECEIPT_LENGTH,
  RECEIPT_TTL_MS,
  createTranscriptReceiptService,
  isUuid,
};
