"use strict";
const { createMockAdapter } = require("./adapters/mock");
const { LabError, LIMITS } = require("./contracts");
const { createAzureAdapter } = require("./adapters/azure");
// Add an adapter here with explicit capabilities. No fallback to production clients.
function createRegistry(config = { enabled: false }, adapterOptions) {
const providers = [
  { id: "mock-full", name: "SIMULATED • Full capability fixture", status: "simulated", languages: ["en", "fil"], operations: ["transcribe", "synthesize", "assess"], adapter: createMockAdapter({ pronunciation: true }) },
  { id: "mock-stt-tts", name: "SIMULATED • STT/TTS only fixture", status: "simulated", languages: ["en", "fil"], operations: ["transcribe", "synthesize"], adapter: createMockAdapter({ pronunciation: false }) },
  { id: "azure", name: "REAL AZURE • Microsoft Speech", status: config.enabled ? "real" : "disabled", reason: config.enabled ? undefined : (config.reason || "Azure is disabled."), languages: config.enabled ? ["en", "fil"] : [], operations: config.enabled ? ["transcribe", "synthesize", "assess"] : [], capabilities: { en: ["transcribe", "synthesize", "assess"], fil: ["transcribe", "synthesize"] }, adapter: config.enabled ? createAzureAdapter(config, adapterOptions) : null },
  ...["whisper", "google"].map(id => ({ id, name: `${id} — unavailable`, status: "disabled", languages: [], operations: [], adapter: null })),
];
function listProviders() {
  return providers.map(({ adapter, ...p }) => ({ ...p, capabilities: p.capabilities || Object.fromEntries(p.languages.map(language => [language, p.operations])), audioFormats: ["pcm_s16le_wav"], maxDurationSeconds: LIMITS.maxDurationSeconds, maxAudioBytes: LIMITS.maxAudioBytes }));
}
function getAdapter(id, operation, language) {
  const p = providers.find(item => item.id === id);
  if (!p || !p.adapter || !["simulated", "real"].includes(p.status)) throw new LabError("PROVIDER_DISABLED", "This provider is disabled. Azure requires explicit backend configuration and live-testing approval.", 422);
  if (!p.operations.includes(operation) || !p.languages.includes(language) || (p.capabilities && !p.capabilities[language]?.includes(operation))) throw new LabError("UNSUPPORTED_CAPABILITY", "This operation or language is unavailable for the selected provider.", 422);
  return p.adapter;
}
return { listProviders, getAdapter };
}
module.exports = { createRegistry, ...createRegistry() };
