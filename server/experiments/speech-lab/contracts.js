"use strict";

// Batch audio is intentionally independent of the initial UI duration limit.
// A future five-minute mode needs explicit limits and adapter capability changes.
const LIMITS = Object.freeze({ maxDurationSeconds: 30, maxAudioBytes: 10 * 1024 * 1024, maxTextLength: 5000 });
const LANGUAGES = Object.freeze(["en", "fil"]);
const SCENARIOS = Object.freeze(["complete", "discrepancies", "incomplete", "no-speech", "error", "slow"]);
class LabError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}
function validateRequest(body) {
  if (!body || typeof body !== "object") throw new LabError("INVALID_REQUEST", "Request fields are required.");
  if (!LANGUAGES.includes(body.language)) throw new LabError("INVALID_LANGUAGE", "Select English or Filipino.");
  if (typeof body.text !== "string" || !/[\p{L}\p{N}]/u.test(body.text) || body.text.length > LIMITS.maxTextLength)
    throw new LabError("INVALID_TEXT", `Supply a passage of 1–${LIMITS.maxTextLength} characters.`);
  if (!SCENARIOS.includes(body.scenario)) throw new LabError("INVALID_SCENARIO", "Select a listed simulation scenario.");
  if (typeof body.provider !== "string") throw new LabError("INVALID_PROVIDER", "Select a provider.");
  return { language: body.language, text: body.text.trim(), scenario: body.scenario, provider: body.provider };
}
module.exports = { LIMITS, LANGUAGES, SCENARIOS, LabError, validateRequest };
