"use strict";
const { setTimeout: delay } = require("node:timers/promises");
const { LabError } = require("../contracts");
const { tokenize } = require("../transcriptComparison");

async function prepare({ scenario, signal }) {
  await delay(scenario === "slow" ? 5000 : 80, undefined, { signal });
  if (scenario === "error") throw new LabError("SIMULATED_PROVIDER_ERROR", "SIMULATED provider failure. No external service was called.", 502);
}
function recognition({ text, scenario, language }) {
  const words = tokenize(text);
  if (scenario === "no-speech") return { transcript: "", completeness: "empty" };
  if (scenario === "incomplete") return { transcript: words.slice(0, Math.max(1, Math.floor(words.length / 2))).join(" "), completeness: "incomplete" };
  if (scenario === "discrepancies") {
    words[0] = language === "fil" ? "halimbawa" : "example";
    if (words.length > 2) words.splice(2, 1);
    words.push(language === "fil" ? "dagdag" : "extra");
  }
  return { transcript: words.join(" "), completeness: "complete" };
}
function tone() {
  const rate = 16000, samples = rate / 2;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write("RIFF"); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36); buffer.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) buffer.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 440 * i / rate) * 1200 * Math.sin(Math.PI * i / samples)), 44 + i * 2);
  return buffer;
}
function createMockAdapter({ pronunciation }) {
  return {
    async transcribe(input) { await prepare(input); return recognition(input); },
    async synthesize(input) {
      await prepare(input);
      return { audioBase64: tone().toString("base64"), mimeType: "audio/wav", warnings: ["SIMULATED TTS playback is a short test tone, not synthesized speech."] };
    },
    async assessPronunciation(input) {
      if (!pronunciation) throw new LabError("UNSUPPORTED_CAPABILITY", "Pronunciation assessment is unavailable for this adapter.", 422);
      await prepare(input);
      const result = recognition(input);
      return { ...result, pronunciation: result.completeness === "complete" ? { kind: "simulated", label: "SIMULATED fixture scores — not an assessment of your audio", scale: "0–100 (fixture only)", scores: { accuracy: 82, fluency: 76, completeness: 90 } } : null };
    },
  };
}
module.exports = { createMockAdapter, tone };
