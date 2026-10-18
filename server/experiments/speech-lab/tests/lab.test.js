"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { runExperiment } = require("../routes");
const { validateAudio } = require("../audioValidation");
const { tone } = require("../adapters/mock");
const { listProviders, getAdapter } = require("../providerRegistry");
const { compareTranscript } = require("../transcriptComparison");
const request = { provider: "mock-full", language: "en", text: "The small bird rests on a branch.", scenario: "complete" };

test("mock STT is explicitly simulated and does not claim pronunciation", async () => {
  const r = await runExperiment("transcribe", request, tone());
  assert.equal(r.simulated, true); assert.match(r.label, /SIMULATED/);
  assert.equal(r.agreement.available, true); assert.equal(r.agreement.discrepancies.length, 0);
  assert.equal(r.pronunciation, null); assert.ok(r.timings.providerMs >= 0);
});
test("Filipino stays separate and produces Filipino fixture text", async () => {
  const r = await runExperiment("transcribe", { ...request, language: "fil", text: "May maliit na ibon sa sanga.", scenario: "discrepancies" }, tone());
  assert.equal(r.language, "fil"); assert.match(r.transcript, /halimbawa/); assert.ok(r.agreement.discrepancies.length);
});
test("incomplete and no-speech results have neither agreement nor fixture scores", async () => {
  for (const scenario of ["incomplete", "no-speech"]) {
    const r = await runExperiment("assess", { ...request, scenario }, tone());
    assert.equal(r.agreement.available, false); assert.equal(r.pronunciation, null);
    assert.equal(r.agreement.accuracy, undefined);
  }
});
test("pronunciation fixture is explicitly simulated", async () => {
  const r = await runExperiment("assess", request, tone());
  assert.equal(r.pronunciation.kind, "simulated"); assert.match(r.pronunciation.label, /not an assessment/);
});
test("TTS returns a valid test tone with a non-speech warning", async () => {
  const r = await runExperiment("synthesize", request);
  assert.equal(r.agreement, null); assert.equal(r.pronunciation, null);
  assert.equal(validateAudio(Buffer.from(r.audioBase64, "base64")).durationSeconds, 0.5);
  assert.ok(r.warnings.some(w => w.includes("not synthesized speech")));
});
test("provider failure is explicit", async () => {
  await assert.rejects(runExperiment("transcribe", { ...request, scenario: "error" }, tone()), { code: "SIMULATED_PROVIDER_ERROR" });
});
test("slow requests are cancellable", async () => {
  const c = new AbortController();
  const pending = runExperiment("transcribe", { ...request, scenario: "slow" }, tone(), c.signal);
  c.abort(); await assert.rejects(pending, { name: "AbortError" });
});
test("real providers and unsupported operations fail closed", () => {
  for (const id of ["azure", "google", "whisper", "unknown"]) assert.throws(() => getAdapter(id, "transcribe", "en"), { code: "PROVIDER_DISABLED" });
  assert.throws(() => getAdapter("mock-stt-tts", "assess", "en"), { code: "UNSUPPORTED_CAPABILITY" });
  for (const p of listProviders().filter(p => p.status === "disabled")) assert.deepEqual(p.operations, []);
});
test("invalid language, operation, scenario, empty text and oversized text are rejected", async () => {
  for (const change of [{ language: "fr" }, { scenario: "random" }, { text: " " }, { text: "...!?" }, { text: "x".repeat(5001) }]) await assert.rejects(runExperiment("transcribe", { ...request, ...change }, tone()));
  await assert.rejects(runExperiment("unknown", request, tone()), { code: "INVALID_OPERATION" });
});
test("audio validation rejects missing, fake, oversized, truncated and overlong audio", () => {
  for (const value of [undefined, Buffer.from("not wav"), Buffer.alloc(10 * 1024 * 1024 + 1), tone().subarray(0, 50)]) assert.throws(() => validateAudio(value));
  const long = Buffer.alloc(44 + 16000 * 2 * 31); tone().copy(long, 0, 0, 44); long.writeUInt32LE(long.length - 8, 4); long.writeUInt32LE(long.length - 44, 40);
  assert.throws(() => validateAudio(long), { code: "AUDIO_TOO_LONG" });
  const bad = tone(); bad.writeUInt32LE(0, 28); assert.throws(() => validateAudio(bad), { code: "INVALID_AUDIO" });
});
test("alignment handles insertions, omissions, substitutions and repeated words", () => {
  assert.deepEqual(compareTranscript("one two three", "one three", "complete").discrepancies.map(d => d.kind), ["omission"]);
  assert.deepEqual(compareTranscript("one three", "one two three", "complete").discrepancies.map(d => d.kind), ["insertion"]);
  assert.deepEqual(compareTranscript("one two", "one three", "complete").discrepancies.map(d => d.kind), ["substitution"]);
  assert.equal(compareTranscript("May ibon, may dahon!", "may ibon may dahon", "complete").discrepancies.length, 0);
  assert.equal(compareTranscript("a a a", "a a", "complete").discrepancies.length, 1);
});
