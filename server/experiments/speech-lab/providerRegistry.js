"use strict";
const { createMockAdapter } = require("./adapters/mock");
const { LabError, LIMITS } = require("./contracts");
// Add an adapter here with explicit capabilities. No fallback to production clients.
const providers = [
  { id: "mock-full", name: "SIMULATED • Full capability fixture", status: "simulated", languages: ["en", "fil"], operations: ["transcribe", "synthesize", "assess"], adapter: createMockAdapter({ pronunciation: true }) },
  { id: "mock-stt-tts", name: "SIMULATED • STT/TTS only fixture", status: "simulated", languages: ["en", "fil"], operations: ["transcribe", "synthesize"], adapter: createMockAdapter({ pronunciation: false }) },
  ...["azure", "whisper", "google"].map(id => ({ id, name: `${id} — unavailable in Phase 1`, status: "disabled", languages: [], operations: [], adapter: null })),
];
function listProviders() {
  return providers.map(({ adapter, ...p }) => ({ ...p, audioFormats: ["pcm_s16le_wav"], maxDurationSeconds: LIMITS.maxDurationSeconds, maxAudioBytes: LIMITS.maxAudioBytes }));
}
function getAdapter(id, operation, language) {
  const p = providers.find(item => item.id === id);
  if (!p || !p.adapter || p.status !== "simulated") throw new LabError("PROVIDER_DISABLED", "Only SIMULATED providers are available. No cloud integration exists.", 422);
  if (!p.operations.includes(operation) || !p.languages.includes(language)) throw new LabError("UNSUPPORTED_CAPABILITY", "This operation or language is unavailable for the selected provider.", 422);
  return p.adapter;
}
module.exports = { listProviders, getAdapter };
