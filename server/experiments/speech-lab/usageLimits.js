"use strict";
const { LabError } = require("./contracts");
function createUsageLimits(config, now = () => performance.now()) {
  let audioSeconds = 0, ttsCharacters = 0, busy = false, unhealthy = false;
  let synthesisStarts = [];
  return {
    reserve(operation, amount) {
      if (unhealthy) throw new LabError("AZURE_CLEANUP_FAILED", "Restart the lab before another Azure request; SDK cleanup did not complete.", 503);
      if (busy) throw new LabError("LAB_BUSY", "One Azure operation at a time.", 429);
      const stamp = now();
      synthesisStarts = synthesisStarts.filter(t => stamp - t < 60000);
      if (operation === "synthesize") {
        if (synthesisStarts.length >= config.ttsPerMinute) throw new LabError("AZURE_RATE_LIMIT", "Local TTS rate limit reached. Wait one minute.", 429);
        if (ttsCharacters + amount > config.ttsCharacters) throw new LabError("AZURE_SESSION_LIMIT", "Local TTS session allowance exhausted.", 429);
        ttsCharacters += amount; synthesisStarts.push(stamp);
      } else {
        if (audioSeconds + amount > config.audioSeconds) throw new LabError("AZURE_SESSION_LIMIT", "Local audio session allowance exhausted.", 429);
        audioSeconds += amount;
      }
      busy = true;
      // Reservations are not refunded: failed/cancelled calls may be billed.
      return cleanupOK => { busy = false; if (!cleanupOK) unhealthy = true; };
    },
  };
}
module.exports = { createUsageLimits };
