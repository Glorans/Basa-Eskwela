const { SpeechConfigurationError } = require("./speechErrors");

// Allowlisted neural voices. The first of each list is the default. The en-PH
// voices are opt-in (AZURE_SPEECH_VOICE_EN) for Philippine-English feedback; the
// voice only affects text-to-speech, never recognition or pronunciation scoring.
const AZURE_VOICES = Object.freeze({
  en: Object.freeze(["en-US-JennyNeural", "en-US-GuyNeural", "en-PH-RosaNeural", "en-PH-JamesNeural"]),
  fil: Object.freeze(["fil-PH-BlessicaNeural", "fil-PH-AngeloNeural"]),
});
const DEFAULT_TIMEOUT_MS = 60000;

/**
 * Reads Azure Speech settings from the backend environment (the protected env
 * file loaded through DOTENV_PATH). Read per request so a missing key fails
 * closed with SPEECH_NOT_CONFIGURED instead of preventing server startup.
 * There is no fallback to any other provider.
 */
function getAzureSpeechConfig(env = process.env) {
  const key = (env.AZURE_SPEECH_KEY || "").trim();
  const region = (env.AZURE_SPEECH_REGION || "").trim().toLowerCase();
  // Azure keys are 32-char hex (legacy) or 84-char alphanumeric; placeholders fail.
  if (!/^[A-Za-z0-9]{32,128}$/.test(key) || !/^[a-z][a-z0-9]{2,40}$/.test(region)) {
    throw new SpeechConfigurationError();
  }
  const voices = {
    en: env.AZURE_SPEECH_VOICE_EN || AZURE_VOICES.en[0],
    fil: env.AZURE_SPEECH_VOICE_FIL || AZURE_VOICES.fil[0],
  };
  if (!AZURE_VOICES.en.includes(voices.en) || !AZURE_VOICES.fil.includes(voices.fil)) {
    throw new SpeechConfigurationError();
  }
  const timeoutMs = env.AZURE_SPEECH_TIMEOUT_MS === undefined || env.AZURE_SPEECH_TIMEOUT_MS === ""
    ? DEFAULT_TIMEOUT_MS
    : Number(env.AZURE_SPEECH_TIMEOUT_MS);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 5000 || timeoutMs > 120000) throw new SpeechConfigurationError();
  return Object.freeze({ key, region, voices: Object.freeze(voices), timeoutMs });
}

function isAzureSpeechConfigured(env = process.env) {
  try { getAzureSpeechConfig(env); return true; } catch { return false; }
}

module.exports = { AZURE_VOICES, getAzureSpeechConfig, isAzureSpeechConfigured };
