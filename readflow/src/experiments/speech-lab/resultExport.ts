import type { Language, Result } from "./types";
// Explicit output allowlist. Never serialize an adapter/configuration object or audio.
export function exportPayload(history: Result[], language: Language) {
  return {
    language,
    notice: "Each row identifies REAL AZURE or SIMULATED provenance. Audio excluded. Transcript agreement is not acoustic pronunciation or benchmark WER.",
    results: history.filter(r => r.language === language).map(r => ({
      simulated: r.simulated, label: r.label, provider: r.provider, operation: r.operation,
      language: r.language, locale: r.locale, voice: r.voice, sdkVersion: r.sdkVersion, region: r.region,
      expectedPassage: r.expectedPassage, transcript: r.transcript, completeness: r.completeness,
      agreement: r.agreement, pronunciation: r.pronunciation, warnings: r.warnings,
      timings: r.timings, audioMetadata: r.audioMetadata,
    })),
  };
}
