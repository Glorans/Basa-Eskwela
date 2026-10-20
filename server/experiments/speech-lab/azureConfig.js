"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { parseEnv } = require("node:util");
const VOICES = Object.freeze({ en: ["en-US-JennyNeural", "en-US-GuyNeural"], fil: ["fil-PH-BlessicaNeural", "fil-PH-AngeloNeural"] });
// Only this dedicated file is read. Never merge process/machine/application env.
const CONFIG_FILE = path.join(__dirname, ".env.local");
function parseAzureConfig(values = {}) {
  const get = key => values[`SPEECH_LAB_AZURE_${key}`];
  const integer = (key, fallback, max) => {
    const value = get(key) === undefined ? fallback : Number(get(key));
    if (!Number.isInteger(value) || value < 1 || value > max) throw new Error("Invalid lab limit");
    return value;
  };
  if (get("ENABLED") !== "true") return Object.freeze({ enabled: false, reason: "Azure is disabled. Configure the dedicated backend lab file after live-testing approval." });
  try {
    if (get("LIVE_APPROVED") !== "true") throw new Error("Live testing not approved");
    // Phase 2 deliberately supports F0 only. No paid-mode switch or fallback.
    if (get("RESOURCE_TIER") !== "F0" || !/^[a-z]+[a-z0-9]*$/.test(get("REGION") || "") || !/^[a-f0-9]{32,128}$/i.test(get("KEY") || "")) throw new Error("Invalid configuration");
    const voices = { en: get("VOICE_EN") || VOICES.en[0], fil: get("VOICE_FIL") || VOICES.fil[0] };
    if (!VOICES.en.includes(voices.en) || !VOICES.fil.includes(voices.fil)) throw new Error("Invalid voice");
    return Object.freeze({ enabled: true, key: get("KEY"), region: get("REGION"), tier: "F0", voices: Object.freeze(voices), timeoutMs: integer("TIMEOUT_MS", 60000, 60000), audioSeconds: integer("SESSION_AUDIO_SECONDS", 300, 1800), ttsCharacters: integer("SESSION_TTS_CHARACTERS", 5000, 50000), ttsPerMinute: integer("TTS_PER_MINUTE", 10, 20) });
  } catch {
    return Object.freeze({ enabled: false, reason: "Azure configuration is invalid or live approval is absent. Check the backend lab setup instructions." });
  }
}
function loadAzureConfig() {
  try { return parseAzureConfig(parseEnv(fs.readFileSync(CONFIG_FILE, "utf8"))); }
  catch { return parseAzureConfig(); }
}
module.exports = { loadAzureConfig, parseAzureConfig, VOICES };
