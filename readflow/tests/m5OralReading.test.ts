import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DiagnosticAudioUploadError } from "../src/modules/module2/services/diagnosticAudioError.ts";
import { calculateOralReadingMetrics } from "../src/modules/module2/services/diagnosticScoring.ts";
import {
  combineDiagnosticTranscriptions,
  processDiagnosticRecording,
} from "../src/modules/module2/services/diagnosticRecording.ts";
import {
  getWordsToPractice,
  processOralReading,
  toOralReadingWordMetrics,
} from "../src/modules/module5/services/oralReadingProcessing.ts";

const validSegment = () => new Blob(["audio"], { type: "audio/webm;codecs=opus" });

test("M2 combines multiple segment transcripts in order with whitespace normalization", () => {
  const combined = combineDiagnosticTranscriptions([
    { text: "  Seeds need " },
    { text: " sun   and water. " },
  ]);
  assert.equal(combined.text, "Seeds need sun and water.");
});

test("M2 processing uses ordered segmented STT and carries total active duration", async () => {
  const transcripts = ["Seeds need", "sun and water"];
  let index = 0;
  const result = await processDiagnosticRecording({
    audioSegments: [validSegment(), validSegment()],
    language: "en",
    expectedText: "Seeds need sun and water",
    recordingDurationSeconds: 30,
    segmentDurationsSeconds: [25, 5],
    uploadSegment: async () => ({
      success: true,
      message: "ok",
      transcription: { text: transcripts[index++] },
    }),
  });
  assert.equal(result.transcription.text, "Seeds need sun and water");
  assert.equal(result.oralReadingMetrics.recordingDurationSeconds, 30);
  assert.equal(result.oralReadingMetrics.readingSpeedWpm, 10);
});

test("a failed transcription prevents attempt input creation and a retry of the same recording succeeds", async () => {
  let calls = 0;
  const recording = validSegment();
  const input = {
    moduleId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    expectedText: "one two three",
    language: "en" as const,
    recording,
    recordingDurationSeconds: 30,
    transcribeRecording: async (audio: Blob) => {
      calls += 1;
      assert.equal(audio, recording);
      if (calls === 1) throw new DiagnosticAudioUploadError("STT_PROVIDER_ERROR");
      return { text: "one two three" };
    },
  };
  await assert.rejects(processOralReading(input));

  const retried = await processOralReading(input);
  assert.equal(calls, 2);
  assert.equal(retried.transcript, "one two three");
  assert.equal(retried.wordMetrics.every((word) => word.type === "match"), true);
});

test("M5 pronunciation accuracy uses substitutions, omissions, and insertions and clamps to 0-100", () => {
  const substitution = calculateOralReadingMetrics("one two three", "one four three");
  const omission = calculateOralReadingMetrics("one two three", "one three");
  const insertion = calculateOralReadingMetrics("one two three", "one extra two three");
  const manyErrors = calculateOralReadingMetrics("one", "many extra spoken words");
  assert.ok(substitution.wordReadingScore < 100);
  assert.ok(omission.wordReadingScore < 100);
  assert.ok(insertion.wordReadingScore < 100);
  assert.equal(manyErrors.wordReadingScore, 0);
  assert.ok(substitution.wordReadingScore >= 0 && substitution.wordReadingScore <= 100);
});

test("Words to Practice use expected substitution and omission words without duplicates", () => {
  const metrics = calculateOralReadingMetrics(
    "oxygen travels underground oxygen",
    "air travels oxygen",
  );
  const words = getWordsToPractice(toOralReadingWordMetrics(metrics));
  assert.ok(words.length > 0);
  assert.equal(words.length, new Set(words).size);
});

test("active M5 pages use persisted routes without mock activity or comprehension quiz", async () => {
  const readAloudSource = await readFile(
    new URL("../src/pages/reading-activity/ReadAloudPage.tsx", import.meta.url),
    "utf8",
  );
  const resultSource = await readFile(
    new URL("../src/pages/reading-activity/ReadingResultPage.tsx", import.meta.url),
    "utf8",
  );
  const appSource = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(readAloudSource, /activityData|Great Coral Reef|paceScore|pronunciationAccuracy\s*:/);
  assert.doesNotMatch(resultSource, /activityData|Great Coral Reef|paceScore|wordsCorrect/);
  assert.doesNotMatch(appSource.replace(/\s+/g, " "), /ComprehensionQuizPage/);
  assert.match(appSource.replace(/\s+/g, " "), /read-aloud\/results\/:attemptId/);
  assert.match(readAloudSource, /processingRef\.current/);
});

test("M5 processing has no diagnostic placement or reading-level mutation", async () => {
  const source = await readFile(
    new URL("../src/modules/module5/services/oralReadingProcessing.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /classifyDiagnosticReadingLevel|assignDifficultyTier|reading_level/);
});

test("learner result hides completion time while persisted result data retains completedAt", async () => {
  const resultSource = await readFile(
    new URL("../src/pages/reading-activity/ReadingResultPage.tsx", import.meta.url),
    "utf8",
  );
  const typeSource = await readFile(
    new URL("../src/modules/module5/types/oralReading.ts", import.meta.url),
    "utf8",
  );
  const backendSource = await readFile(
    new URL("../../server/services/oralReadingAttemptService.js", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(resultSource, /<time|formatCompletedAt|attempt\.completedAt/);
  assert.match(typeSource, /completedAt: string/);
  assert.match(backendSource, /completedAt: row\.completed_at/);
});

test("Student and Independent Learner M5 routes inherit their existing layouts", async () => {
  const appSource = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(
    appSource.replace(/\s+/g, " "),
    /path="\/dashboard" element=\{<BasaLayout \/>\}[\s\S]*path="materials\/:moduleId\/read-aloud"[\s\S]*path="read-aloud\/results\/:attemptId"/,
  );
  assert.match(
    appSource.replace(/\s+/g, " "),
    /path="\/m3\/general" element=\{<M3Layout role="general_user" \/>\}[\s\S]*path="modules\/:moduleId\/read-aloud"[\s\S]*path="read-aloud\/results\/:attemptId"/,
  );
  assert.doesNotMatch(appSource.replace(/\s+/g, " "), /path="\/dashboard\/(materials\/)?[^\"]*read-aloud/);
  assert.doesNotMatch(appSource.replace(/\s+/g, " "), /path="\/m3\/general\/[^\"]*read-aloud/);
});

test("M5 pages rely on route layouts and do not render duplicate sidebars", async () => {
  const readAloudSource = await readFile(
    new URL("../src/pages/reading-activity/ReadAloudPage.tsx", import.meta.url),
    "utf8",
  );
  const resultSource = await readFile(
    new URL("../src/pages/reading-activity/ReadingResultPage.tsx", import.meta.url),
    "utf8",
  );
  for (const source of [readAloudSource, resultSource]) {
    assert.doesNotMatch(source, /BasaSidebar|BasaLayout|M3Layout|m3-sidebar|basa-sidebar/);
  }
});

test("Independent Learner layout hides its role subtitle and scrolls only content", async () => {
  const layout = await readFile(new URL("../src/modules/module3/components/M3Layout.tsx", import.meta.url), "utf8");
  const style = await readFile(new URL("../src/modules/module3/styles/module3.css", import.meta.url), "utf8");
  assert.match(layout, /shouldShowRole = profile\?\.role === "teacher" \|\| profile\?\.role === "admin"/);
  assert.match(layout, /shouldShowRole && <small>\{roleLabel\}<\/small>/);
  assert.match(style, /\.m3-shell--general \{[\s\S]*height: 100dvh;[\s\S]*min-height: 0;/);
  assert.match(style, /\.m3-shell--general \.m3-content \{[\s\S]*overflow-y: auto;/);
});


test("selected passage and classroom context survive processing into the save payload", async () => {
  const result = await processOralReading({
    moduleId: "module", passageId: "passage-2", roomId: "room", assignmentId: "assignment", submissionId: "submission",
    expectedText: "Second passage", language: "en", recording: validSegment(), recordingDurationSeconds: 10,
    transcribeRecording: async () => ({ text: "Second passage" }),
  });
  assert.equal(result.passageId, "passage-2");
  assert.equal(result.roomId, "room");
  assert.equal(result.assignmentId, "assignment");
  assert.equal(result.submissionId, "submission");
  assert.deepEqual(result.wordMetrics.map(word => word.expected), ["second", "passage"]);
});
