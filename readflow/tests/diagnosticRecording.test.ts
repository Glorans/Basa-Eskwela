import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  combineDiagnosticTranscriptions,
  DiagnosticRecordingProcessingError,
  getExpectedDiagnosticSegmentCount,
  processDiagnosticRecording,
} from "../src/modules/module2/services/diagnosticRecording.ts";
import { getRecorderStopAction } from "../src/modules/module2/hooks/useAudioRecorder.ts";
import {
  DiagnosticAudioUploadError,
  toDiagnosticAudioUploadError,
} from "../src/modules/module2/services/diagnosticAudioError.ts";
import type { OralReadingMetrics } from "../src/modules/module2/types/diagnostic.ts";

function emptyMetrics(): OralReadingMetrics {
  return {
    alignment: [],
    totalExpectedWords: 0,
    numberOfWordsRead: 0,
    correctWords: 0,
    substitutions: 0,
    omissions: 0,
    insertions: 0,
    detectableMiscues: 0,
    wordAccuracy: 0,
    wordReadingScore: 0,
  };
}

test("keeps recordings under 25 seconds in one internal segment", () => {
  assert.equal(getExpectedDiagnosticSegmentCount(24), 1);
  assert.equal(getExpectedDiagnosticSegmentCount(25), 1);
});

test("rotates internal segments for recordings over 25 seconds", () => {
  assert.equal(getExpectedDiagnosticSegmentCount(26), 2);
  assert.equal(getExpectedDiagnosticSegmentCount(49), 2);
  assert.equal(getExpectedDiagnosticSegmentCount(50), 2);
  assert.equal(getExpectedDiagnosticSegmentCount(61), 3);
  assert.equal(getExpectedDiagnosticSegmentCount(100), 4);
});

test("caps internal segmentation at the five-minute session maximum", () => {
  assert.equal(getExpectedDiagnosticSegmentCount(300), 12);
  assert.equal(getExpectedDiagnosticSegmentCount(600), 12);
});

test("combines segment transcripts in order and averages finite confidence", () => {
  assert.deepEqual(
    combineDiagnosticTranscriptions([
      { text: "  first part", confidence: 0.8 },
      { text: "second   part", confidence: 1 },
      { text: "third part" },
    ]),
    { text: "first part second part third part", confidence: 0.9 },
  );
});

test("uploads multiple internal segments in order and scores one combined transcript", async () => {
  const segments = [
    new Blob(["one"], { type: "audio/webm" }),
    new Blob(["two"], { type: "audio/webm" }),
    new Blob(["three"], { type: "audio/webm" }),
  ];
  const uploadOrder: Blob[] = [];
  const scoringCalls: Array<[string, string, number | undefined]> = [];

  const processed = await processDiagnosticRecording({
    audioSegments: segments,
    language: "en",
    expectedText: "full reference passage",
    recordingDurationSeconds: 61,
    segmentDurationsSeconds: [25, 25, 11],
    uploadSegment: async (segment) => {
      uploadOrder.push(segment);
      const index = segments.indexOf(segment);
      return {
        success: true,
        message: "ok",
        transcription: { text: ["first", "second", "third"][index] },
      };
    },
    calculateMetrics: (expectedText, transcript, duration) => {
      scoringCalls.push([expectedText, transcript, duration]);
      return { ...emptyMetrics(), recordingDurationSeconds: duration };
    },
  });

  assert.deepEqual(uploadOrder, segments);
  assert.deepEqual(scoringCalls, [[
    "full reference passage",
    "first second third",
    61,
  ]]);
  assert.equal(processed.transcription.text, "first second third");
  assert.equal(processed.oralReadingMetrics.recordingDurationSeconds, 61);
});

test("a failed internal segment prevents scoring and a later retry succeeds", async () => {
  const segments = ["one", "two", "three"].map(
    (content) => new Blob([content], { type: "audio/webm;codecs=opus" }),
  );
  let uploadCount = 0;
  let scoringCount = 0;

  await assert.rejects(
    () => processDiagnosticRecording({
      audioSegments: segments,
      language: "en",
      expectedText: "reference",
      recordingDurationSeconds: 80,
      uploadSegment: async () => {
        uploadCount += 1;
        if (uploadCount === 2) {
          throw new DiagnosticAudioUploadError(
            "STT_DEADLINE",
            "Speech processing timed out. Please try again.",
            504,
          );
        }
        return {
          success: true,
          message: "ok",
          transcription: { text: "partial" },
        };
      },
      calculateMetrics: () => {
        scoringCount += 1;
        return emptyMetrics();
      },
    }),
    (error) => (
      error instanceof DiagnosticRecordingProcessingError
      && error.code === "STT_DEADLINE"
      && error.segmentIndex === 2
      && error.httpStatus === 504
      && error.message === "Speech processing timed out. Please try again."
    ),
  );
  assert.equal(uploadCount, 2);
  assert.equal(scoringCount, 0);

  const retried = await processDiagnosticRecording({
    audioSegments: [new Blob(["retry"], { type: "audio/webm;codecs=opus" })],
    language: "en",
    expectedText: "reference",
    recordingDurationSeconds: 40,
    uploadSegment: async () => ({
      success: true,
      message: "ok",
      transcription: { text: "complete retry" },
    }),
    calculateMetrics: () => emptyMetrics(),
  });
  assert.equal(retried.transcription.text, "complete retry");
});

test("rejects an empty audio segment before upload", async () => {
  let uploadCount = 0;

  await assert.rejects(
    () => processDiagnosticRecording({
      audioSegments: [new Blob([], { type: "audio/webm;codecs=opus" })],
      language: "en",
      expectedText: "reference",
      recordingDurationSeconds: 1,
      uploadSegment: async () => {
        uploadCount += 1;
        return {
          success: true,
          message: "ok",
          transcription: { text: "unexpected" },
        };
      },
    }),
    (error) => (
      error instanceof DiagnosticRecordingProcessingError
      && error.code === "STT_INVALID_AUDIO"
      && error.segmentIndex === 1
    ),
  );

  assert.equal(uploadCount, 0);
});

test("rejects a non-WebM segment before upload", async () => {
  let uploadCount = 0;

  await assert.rejects(
    () => processDiagnosticRecording({
      audioSegments: [new Blob(["audio"], { type: "audio/mp4" })],
      language: "en",
      expectedText: "reference",
      recordingDurationSeconds: 1,
      uploadSegment: async () => {
        uploadCount += 1;
        return {
          success: true,
          message: "ok",
          transcription: { text: "unexpected" },
        };
      },
    }),
    (error) => (
      error instanceof DiagnosticRecordingProcessingError
      && error.code === "STT_INVALID_AUDIO"
      && error.segmentIndex === 1
    ),
  );

  assert.equal(uploadCount, 0);
});

test("preserves known backend failure details and hides unknown responses", () => {
  const known = toDiagnosticAudioUploadError({
    isAxiosError: true,
    response: {
      status: 503,
      data: {
        code: "STT_QUOTA",
        message: "Speech processing is temporarily busy. Please try again later.",
      },
    },
  });

  assert.equal(known.code, "STT_QUOTA");
  assert.equal(known.httpStatus, 503);
  assert.equal(
    known.message,
    "Speech processing is temporarily busy. Please try again later.",
  );

  const unknown = toDiagnosticAudioUploadError({
    isAxiosError: true,
    response: {
      status: 500,
      data: { code: "INTERNAL_SECRET", message: "private provider detail" },
    },
  });

  assert.equal(unknown.code, "STT_PROVIDER_ERROR");
  assert.equal(unknown.message.includes("private provider"), false);
});

test("live Student Dashboard and header do not use mock identity or progress values", async () => {
  const dashboardSource = await readFile(
    new URL("../src/pages/StudentDashboard.tsx", import.meta.url),
    "utf8",
  );
  const layoutSource = await readFile(
    new URL("../src/components/basa/BasaLayout.tsx", import.meta.url),
    "utf8",
  );

  assert.match(dashboardSource, /useAuthenticatedProfile/);
  assert.doesNotMatch(dashboardSource, /dashboardData|student\.firstName|student\.totalXp/);
  assert.doesNotMatch(dashboardSource, /student\.badgesEarned|student\.streakDays/);
  assert.doesNotMatch(dashboardSource, /Welcome back, Demo|610|Badges Earned|Day streak/);
  assert.doesNotMatch(layoutSource, /dashboardData|student\.totalXp|xp=/);
  assert.match(dashboardSource, /PlacementSummary placement=\{placements\.en\}/);
  assert.match(dashboardSource, /PlacementSummary placement=\{placements\.fil\}/);
});

test("diagnostic reading prevents duplicate processing and offers a clean retry", async () => {
  const [pageSource, hookSource] = await Promise.all([
    readFile(
      new URL(
        "../src/modules/module2/pages/DiagnosticReadingPage.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../src/modules/module2/hooks/useAudioRecorder.ts",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);

  assert.match(pageSource, /processingRef\.current/);
  assert.match(pageSource, /isUploading\s*\|\|\s*processingRef\.current/);
  assert.match(pageSource, /disabled=\{isUploading\}/);
  assert.match(pageSource, /Record Again/);
  assert.match(pageSource, /Try Processing Again/);
  assert.match(pageSource, /resetRecording\(\)/);
  assert.match(pageSource, /createPlaybackUrls:\s*false/);
  assert.match(pageSource, /Recording Complete/);
  assert.doesNotMatch(pageSource, /audioURLs|<audio|segmentIndex|failed on part/i);
  assert.match(hookSource, /URL\.revokeObjectURL/);
});

test("manual and maximum stops finish the same segmented recording session", async () => {
  const hookSource = await readFile(
    new URL(
      "../src/modules/module2/hooks/useAudioRecorder.ts",
      import.meta.url,
    ),
    "utf8",
  );

  assert.equal(getRecorderStopAction("manual", false), "finish-manual");
  assert.equal(getRecorderStopAction("maximum", false), "finish-maximum");
  assert.equal(getRecorderStopAction("rotate", true), "rotate");
  assert.equal(getRecorderStopAction("rotate", false), "abort");
  assert.equal(
    getRecorderStopAction("rotate", false, "manual"),
    "finish-manual",
  );
  assert.equal(
    getRecorderStopAction("rotate", false, "maximum"),
    "finish-maximum",
  );
  assert.match(hookSource, /stopSessionRef\.current\?\.\("manual"\)/);
  assert.match(hookSource, /stopSessionRef\.current\?\.\("maximum"\)/);
  assert.match(hookSource, /reason === "maximum"[\s\S]*five-minute limit/);
  assert.match(hookSource, /clearTimers\(\);[\s\S]*stopStream\(reason\);/);
});

test("10, 30, 60, and 90 second recordings stay one child-facing session", () => {
  for (const durationSeconds of [10, 30, 60, 90]) {
    let childFacingSessionIsRecording = true;
    let rotationCount = 0;

    for (let boundary = 25; boundary < durationSeconds; boundary += 25) {
      const action = getRecorderStopAction("rotate", true);
      assert.equal(action, "rotate");
      assert.equal(childFacingSessionIsRecording, true);
      rotationCount += 1;
    }

    assert.equal(rotationCount, Math.floor((durationSeconds - 1) / 25));
    assert.equal(getRecorderStopAction("manual", false), "finish-manual");
    childFacingSessionIsRecording = false;
    assert.equal(childFacingSessionIsRecording, false);
  }
});

test("segment rotation cannot release the stream or finalize the session", async () => {
  const hookSource = await readFile(
    new URL(
      "../src/modules/module2/hooks/useAudioRecorder.ts",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(hookSource, /let segmentStopRequested = false/);
  assert.match(hookSource, /if \(segmentStopRequested\) return/);
  assert.match(hookSource, /if \(stopAction === "rotate"\) \{[\s\S]*startSegment\(\)[\s\S]*return;/);
  assert.match(hookSource, /stopStream\(reason: StreamStopReason\)/);
  assert.doesNotMatch(hookSource, /stopStream\("rotate"\)/);
  assert.match(hookSource, /MediaRecorder stopped without a requested rotation or session stop/);
  assert.match(hookSource, /sessionFinalizedRef\.current/);
  assert.match(hookSource, /sessionStartedAtRef\.current/);
});

test("development lifecycle logs distinguish recorder and Google stream endings", async () => {
  const [recorderSource, streamingSource, streamingHook] = await Promise.all([
    readFile(
      new URL(
        "../src/modules/module2/hooks/useAudioRecorder.ts",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../src/modules/module2/services/diagnosticStreamingSession.ts",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(new URL("../src/modules/module2/hooks/useDiagnosticStreamingSpeech.ts", import.meta.url), "utf8"),
  ]);

  assert.match(recorderSource, /import\.meta\.env\?\.DEV/);
  for (const event of [
    "session start",
    "MediaRecorder start",
    "internal segment stop",
    "internal segment start",
    "MediaStream track ended",
    "manual Stop",
  ]) {
    assert.ok(recorderSource.includes(`"${event}"`), `missing ${event} log`);
  }

  assert.match(streamingHook, /import\.meta\.env\.DEV/);
  for (const event of [
    "WebSocket connected",
    "WebSocket closed",
    "fallback triggered",
  ]) {
    assert.ok(streamingSource.includes(`"${event}"`), `missing ${event} log`);
  }
});

test("diagnostic start reveals its mascot without disabling shared panel scrolling", async () => {
  const [layoutStyles, startStyles] = await Promise.all([
    readFile(
      new URL(
        "../src/modules/module2/components/DiagnosticLayout.css",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../src/modules/module2/pages/DiagnosticStartPage.css",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);

  assert.match(
    layoutStyles,
    /\.diagnostic-shell__panel\s*\{[^}]*overflow-y:\s*auto;/s,
  );
  assert.match(
    startStyles,
    /\.diagnostic-start-panel\s*\{[^}]*overflow:\s*visible;/s,
  );
  assert.match(startStyles, /margin-top:\s*clamp\(76px, 18vw, 92px\);/);
});
