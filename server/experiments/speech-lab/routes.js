"use strict";
const { performance } = require("node:perf_hooks");
const { validateRequest, LabError } = require("./contracts");
const { getAdapter } = require("./providerRegistry");
const { validateAudio } = require("./audioValidation");
const { compareTranscript } = require("./transcriptComparison");

// Pure orchestration: independently testable without Express or installed SDKs.
async function runExperiment(operation, body, audio, signal) {
  const started = performance.now();
  if (!["transcribe", "synthesize", "assess"].includes(operation)) throw new LabError("INVALID_OPERATION", "Unknown experiment.");
  const input = validateRequest(body);
  const adapter = getAdapter(input.provider, operation, input.language);
  const audioMetadata = operation === "synthesize" ? null : validateAudio(audio);
  const providerStarted = performance.now();
  const method = operation === "assess" ? "assessPronunciation" : operation;
  const output = await adapter[method]({ ...input, audio, audioMetadata, signal });
  return {
    simulated: true, label: "SIMULATED — not a measurement of this audio", operation,
    provider: input.provider, language: input.language, expectedPassage: input.text,
    ...output, audioMetadata,
    agreement: operation === "synthesize" ? null : compareTranscript(input.text, output.transcript, output.completeness),
    pronunciation: output.pronunciation || null,
    warnings: ["All outputs are deterministic fixtures. Audio is validated but never recognized or assessed.", ...(output.completeness && output.completeness !== "complete" ? ["Recognition is incomplete; agreement and pronunciation scores are unavailable."] : []), ...(output.warnings || [])],
    timings: { providerMs: performance.now() - providerStarted, serverMs: performance.now() - started },
  };
}
module.exports = { runExperiment };
