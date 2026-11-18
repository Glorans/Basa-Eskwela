import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

// After a temporary speech-service failure the learner processes the SAME recording again;
// only a recording problem asks for a new recording. The helper is evaluated from the page source.
// Line endings normalized: Windows checkouts (core.autocrlf) have CRLF.
const page = readFileSync(new URL("../src/pages/reading-activity/ReadAloudPage.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const start = page.indexOf("const RECORD_AGAIN_CODES");
const end = page.indexOf("\n}\n", start) + 3;
const helperJs = ts.transpileModule(page.slice(start, end).replace("export function", "function"), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const canRetrySameRecording = new Function(`${helperJs}; return canRetrySameRecording;`)() as (error: unknown) => boolean;
const withCode = (code: string) => Object.assign(new Error("x"), { code });

test("temporary M5 transcription failures keep the recording for Retry Processing", () => {
  for (const code of ["STT_QUOTA", "SPEECH_RATE_LIMITED", "STT_DEADLINE", "STT_PROVIDER_ERROR", "STT_BAD_REQUEST", "STT_PERMISSION", "SPEECH_NOT_CONFIGURED"]) {
    assert.equal(canRetrySameRecording(withCode(code)), true, code);
  }
  assert.equal(canRetrySameRecording(new Error("network")), true, "network failure");
  assert.equal(canRetrySameRecording("We couldn't process your full reading."), true);
});

test("recording problems still ask the learner to record again", () => {
  for (const code of ["NO_SPEECH", "STT_INVALID_AUDIO", "AUDIO_TOO_LONG", "AUDIO_TOO_LARGE"]) {
    assert.equal(canRetrySameRecording(withCode(code)), false, code);
  }
});

test("Read Aloud shows Retry Processing after a retryable transcription error for every M5 activity, reusing the recording", () => {
  assert.match(page, /processingStatus === "transcription-error" && \(materialId \|\| canRetrySameRecording\(processingError\)\)/);
  assert.match(page, /materialId \|\| processingStatus === "transcription-error" \? t\("Retry Processing"\)/);
  // handleProcess transcribes the in-memory audioSegments; it never clears them.
  const handleProcess = page.slice(page.indexOf("const handleProcess"), page.indexOf("const handleRecordAgain"));
  assert.match(handleProcess, /audioSegments/);
  assert.doesNotMatch(handleProcess, /resetRecording/);
});
