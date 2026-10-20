"use strict";
const { performance } = require("node:perf_hooks");
const { validateRequest, LabError } = require("./contracts");
const defaultRegistry = require("./providerRegistry");
const { validateAudio } = require("./audioValidation");
const { compareTranscript } = require("./transcriptComparison");

// Pure orchestration: independently testable without Express or installed SDKs.
async function runExperiment(operation, body, audio, signal, registry = defaultRegistry) {
  const started = performance.now();
  if (!["transcribe", "synthesize", "assess"].includes(operation)) throw new LabError("INVALID_OPERATION", "Unknown experiment.");
  const input = validateRequest(body);
  const adapter = registry.getAdapter(input.provider, operation, input.language);
  const simulated = input.provider !== "azure";
  const audioMetadata = operation === "synthesize" ? null : validateAudio(audio, { azure: !simulated });
  const providerStarted = performance.now();
  const method = operation === "assess" ? "assessPronunciation" : operation;
  const output = await adapter[method]({ ...input, audio, audioMetadata, signal });
  const providerMs = performance.now() - providerStarted;
  const agreement = operation === "synthesize" ? null : !simulated && operation === "assess" ? { available: false, reason: "Run independent STT for transcript-based reading accuracy; this transcript is reference-conditioned.", discrepancies: [] } : compareTranscript(input.text, output.transcript, output.completeness);
  if (!simulated && agreement?.available) {
    const errors = agreement.discrepancies.filter(d => d.kind !== "insertion").length;
    agreement.matchedWords = agreement.expectedWords - errors;
    agreement.accuracy = 100 * agreement.matchedWords / agreement.expectedWords;
    agreement.formula = "100 × matched reference words / reference words; insertions reported separately";
    agreement.label = "Transcript-based reading accuracy estimate — not acoustic pronunciation or benchmark WER";
  }
  return {
    ...output,
    simulated, label: simulated ? "SIMULATED — not a measurement of this audio" : "REAL AZURE — cloud speech result", operation,
    provider: input.provider, language: input.language, expectedPassage: input.text,
    audioMetadata, agreement,
    pronunciation: output.pronunciation || null,
    warnings: [...(simulated ? ["All outputs are deterministic fixtures. Audio is validated but never recognized or assessed."] : []), ...(output.completeness && output.completeness !== "complete" ? ["Recognition is incomplete; agreement and pronunciation scores are unavailable."] : []), ...(output.warnings || [])],
    timings: { providerMs, serverMs: performance.now() - started },
  };
}
module.exports = { runExperiment };
