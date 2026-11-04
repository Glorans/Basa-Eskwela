import * as savedAttemptOrder from "../src/modules/module5/services/savedAttemptOrder.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { assignedReadingTarget } from "../src/modules/module5/services/assignedReadingNavigation.ts";
import { comprehensionTargetForReading } from "../src/modules/module5/services/comprehensionNavigation.ts";
import * as voiceFollow from "../src/pages/reading-activity/voiceFollow.ts";
import { storyParagraphs } from "../src/pages/reading-activity/storyDisplay.ts";
import * as activityLanguage from "../src/pages/reading-activity/activityLanguage.ts";

const require = createRequire(import.meta.url);
const tick = () => new Promise(resolve => setImmediate(resolve));
function find(tree: any, predicate: (node: any) => boolean): any {
  if (!tree || typeof tree !== "object") return;
  if (predicate(tree)) return tree;
  for (const child of [tree.props?.children].flat(Infinity)) {
    const result = find(child, predicate); if (result) return result;
  }
}
function button(tree: any, label: string) {
  const node = find(tree, item => item.type === "button" && JSON.stringify(item.props.children).includes(label));
  assert.ok(node, `Missing button: ${label}`);
  assert.equal(node.props.disabled ?? false, false, `${label} is disabled`);
  return node;
}

// Execute the real page hooks and event handlers with controlled recorder/network boundaries.
function mount(path: string, params: Record<string, string>, mocks: Record<string, any>, role = "student") {
  const slots: any[] = [];
  let cursor = 0;
  let effects: (() => void)[] = [];
  const navigations: string[] = [];
  const react = {
    ...require("react"),
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], (value: any) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
    },
    useRef(initial: unknown) { return slots[cursor++] ??= { current: initial }; },
    useEffect(callback: () => any, deps: unknown[]) {
      const index = cursor++;
      const previous = slots[index];
      if (!previous || deps.some((value, i) => value !== previous.deps[i])) {
        effects.push(() => { previous?.cleanup?.(); slots[index] = { deps, callback, cleanup: callback() }; });
      }
    },
  };
  const module = { exports: {} as any };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, {
    module, exports: module.exports, Error, URLSearchParams, AbortController, crypto: { randomUUID: () => "submission" },
    window: { setInterval: () => 1, clearInterval() {}, location: { reload() {} } },
    require: (id: string) => {
      if (id === "react") return react;
      if (id.endsWith("/activityLanguage")) return activityLanguage;
      if (id.endsWith("/savedAttemptOrder")) return savedAttemptOrder;
      if (id === "react-router-dom") return { Link: "a", useParams: () => params, useLocation: () => ({ state: mocks.locationState }),
        useSearchParams: () => [new URLSearchParams({ roomId: "room", activityAssignmentId: "assignment", oralReadingAttemptId: "oral", ...mocks.searchParams }), () => {}],
        useNavigate: () => (target: string) => navigations.push(target) };
      for (const [suffix, value] of Object.entries(mocks)) if (id.endsWith(suffix)) return suffix === "oralReadingService"
        ? { peekOralReadingAttemptNumber: () => undefined, getOralReadingAttemptNumber: async () => undefined, peekOralReadingAttempt: () => undefined, rememberOralReadingAttempt() {}, ...value } : value;
      if (id.endsWith(".css")) return {};
      if (id.includes("ActivityHeader")) return { default: "header" };
      if (id.includes("OralReadingSummary")) return { default: "oral-summary" };
      if (id.includes("RecordingPlayback")) return { default: "recording-playback" };
      if (id.includes("PronunciationFeedback")) return {
        PronunciationFeedbackPanel: "pronunciation-feedback-panel", PronunciationAccuracyPanel: "pronunciation-accuracy-panel",
        PronunciationWordsPanel: "pronunciation-words-panel",
        // The check only runs when a learner presses its button; record the attempt it was offered for.
        usePronunciationCheck: (attemptId: string | undefined) => {
          (mocks.pronunciationChecks ??= []).push(attemptId);
          return mocks.pronunciation ?? { status: "idle", step: "loading", check() { throw Error("must not auto-run"); } };
        },
      };
      if (id.includes("M5Modal")) return { default: "m5-modal" };
      if (id.includes("StoryDrawer")) return { default: "story-drawer" };
      if (id.includes("/reading-feedback/")) return { default: id.endsWith("ReadingMascot") ? "reading-mascot" : "feedback-speech",
        useFeedbackSpeechState: () => mocks.speechPlayer?.getState() ?? { status: "idle", key: null, muted: false } };
      if (id.endsWith("/feedbackSpeech")) return { getFeedbackSpeech: () => mocks.speechPlayer ?? {
        play: async () => true, stop() {}, getState: () => ({ status: "idle", key: null, muted: false }) } };
      if (id.includes("ReadingHistoryPage")) return { default: "reading-history" };
      return require(id);
    },
  });
  return {
    navigations,
    render() {
      cursor = 0;
      const tree = module.exports.default({ role });
      const pending = effects; effects = []; pending.forEach(effect => effect());
      return tree;
    },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
    replayEffects() { slots.forEach(slot => { if (slot?.callback) { slot.cleanup?.(); slot.cleanup = slot.callback(); } }); },
  };
}

async function recordingFixture(options: { saved?: boolean; saveError?: boolean; transcriptionError?: boolean; standalone?: boolean; readAloudOnly?: boolean; statusError?: boolean; viewReading?: boolean; recordingUploadError?: boolean; prepared?: boolean; history?: any[];
  callTranscription?: boolean; gates?: { transcription?: Promise<void>; save?: Promise<void>; upload?: Promise<void> } } = {}) {
  const transcriptionOptions: any[] = [];
  const stepTexts: string[] = [];
  let started = 0, stopped = 0, processed = 0;
  let historyRequests = 0, moduleRequests = 0, progressRequests = 0;
  const submissions: any[] = [];
  const statusUpdates: any[] = [];
  const uploads: { attemptId: string; segments: Blob[]; afterNavigations: number }[] = [];
  const processedInputs: any[] = [];
  let recorderOptions: Record<string, unknown> = {};
  let mounted: { navigations: string[]; render: () => unknown } | undefined;
  const navigationCount = () => mounted?.navigations.length ?? 0;
  const recorder = {
    audioSegments: [] as Blob[], audioURLs: [] as string[], segmentDurationsSeconds: [] as number[],
    fullRecording: null as Blob | null, fullRecordingURL: null as string | null,
    isRecording: false, isStarting: false, isStopping: false, message: "Ready", recordingDurationSeconds: null as number | null,
    resetRecording() { recorder.audioSegments = []; recorder.audioURLs = []; recorder.fullRecording = null; recorder.fullRecordingURL = null; recorder.recordingDurationSeconds = null; },
    async startRecording() { started++; recorder.isRecording = true; },
    stopRecording() {
      // M5 records with one MediaRecorder and no rotation: one file covering the whole 60 s reading.
      stopped++; recorder.isRecording = false; recorder.audioSegments = [new Blob(["full"], { type: "audio/webm" })];
      recorder.audioURLs = ["blob:full"]; recorder.segmentDurationsSeconds = [60]; recorder.recordingDurationSeconds = 60;
    },
  };
  const input = { submissionId: "fixed-submission", transcript: "recognized words" };
  const page = mount("pages/reading-activity/ReadAloudPage.tsx", options.standalone ? { moduleId: "module" } : { materialId: "material" }, {
    locationState: options.prepared ? {
      readingActivity: { roomId: "room", materialId: "material", activityAssignmentId: "assignment", oralReadingAttemptId: null },
      oralReadingModule: { materialId: "material", activityAssignmentId: "assignment", roomId: "room", passage: "Prepared passage", language: "en" },
    } : undefined,
    searchParams: options.viewReading ? { viewReading: "1" } : {},
    classroomService: { updateReadingActivityStatus: async (...args: any[]) => {
      statusUpdates.push(args);
      if (options.statusError && statusUpdates.length === 1) throw Error("Status update failed");
    } },
    useAudioRecorder: { useAudioRecorder: (opts: Record<string, unknown>) => { recorderOptions = opts; return recorder; } },
    oralReadingTranscription: {
      startReadAloudTiming: () => () => {},
      transcribeOralReadingRecording: async (_recording: Blob, _language: string, transcribeOptions: any) => {
        transcriptionOptions.push(transcribeOptions);
        for (const step of ["preparing", "uploading", "recognizing"]) {
          transcribeOptions.onStep(step);
          stepTexts.push(JSON.stringify(mounted!.render()));
        }
        if (options.gates?.transcription) await options.gates.transcription;
        return { text: "Every word" };
      },
    },
    useVoiceFollowStoryScroll: { useVoiceFollowStoryScroll: () => ({ onStreamReady() {}, onStreamStopped() {} }) },
    voiceFollow,
    recordingDuration: { resolveRecordingDuration() {} },
    storyDisplay: { storyParagraphs },
    diagnosticAudio: { uploadDiagnosticAudio() {} },
    diagnosticAudioError: { DiagnosticAudioUploadError: Error },
    oralReadingProcessing: { ORAL_READING_MAX_RECORDING_SECONDS: 300, readAloudTranscriptionTimeoutMs: () => 210_000,
      processOralReading: async (body: any) => {
        processed++; processedInputs.push(body);
        if (options.callTranscription) await body.transcribeRecording(body.recording, "en");
        if (options.transcriptionError) throw Error("NO_SPEECH");
        return input;
      } },
    oralReadingService: {
      getOwnOralReadingAttempts: async () => { historyRequests++; return options.history ?? []; },
      getAssignedReadingProgress: async () => { progressRequests++; return [{ roomId: "room", materialId: "material", activityAssignmentId: "assignment", oralReadingAttemptId: options.saved ? "oral" : null, readAloudOnly: options.readAloudOnly ?? false }]; },
      getOralReadingModule: async () => { moduleRequests++; return { id: null, materialId: "material", activityAssignmentId: "assignment", roomId: "room", passage: "Full teacher assigned passage", language: "en", readAloudOnly: options.readAloudOnly ?? false }; },
      createOralReadingAttempt: async (body: any) => {
        submissions.push(body);
        if (options.gates?.save) await options.gates.save;
        if (options.saveError && submissions.length === 1) throw Error("Network response lost");
        return { id: "oral", moduleId: null, materialId: "material", activityAssignmentId: "assignment", roomId: "room" };
      },
      uploadOralReadingRecording: async (attemptId: string, segments: Blob[]) => {
        uploads.push({ attemptId, segments: [...segments], afterNavigations: navigationCount() });
        if (options.gates?.upload) await options.gates.upload;
        if (options.recordingUploadError && uploads.length === 1) throw Error("Recording upload failed");
      },
      RECORDING_UPLOAD_ERROR: "Your result is saved, but recording upload failed. Retry saving the recording before leaving this page.",
    },
    comprehensionNavigation: { comprehensionTargetForReading }, assignedReadingNavigation: { assignedReadingTarget },
  }, options.standalone ? "general_user" : "student");
  mounted = page;
  page.render(); await tick();
  return { ...page, recorder, submissions, statusUpdates, uploads, processedInputs, transcriptionOptions, stepTexts, recorderOptions: () => recorderOptions, counts: () => ({ started, stopped, processed }), requests: () => ({ historyRequests, moduleRequests, progressRequests }) };
}

test("saved-activity redirects skip module/history fetches and never flash numbered saved results", async () => {
  const f = await recordingFixture({ saved: true });
  assert.equal(f.requests().historyRequests, 0);
  assert.equal(f.requests().moduleRequests, 0);
  assert.equal(f.requests().progressRequests, 1);
  assert.doesNotMatch(JSON.stringify(f.render()), /Saved Result|Your Saved Results/);
  assert.deepEqual(f.navigations, ["/dashboard/read-aloud/results/oral"]);
});

test("prepared unfinished activity renders its passage without repeating progress or module requests", async () => {
  const f = await recordingFixture({ prepared: true });
  assert.match(JSON.stringify(f.render()), /Prepared/);
  assert.equal(f.requests().progressRequests, 0);
  assert.equal(f.requests().moduleRequests, 0);
  assert.deepEqual(f.navigations, []);
  button(f.render(), "Start Recording");
});

test("activity effect replay shares permission, module and history requests", async () => {
  const f = await recordingFixture();
  f.replayEffects();
  await tick();
  assert.equal(f.requests().moduleRequests, 1);
  assert.equal(f.requests().progressRequests, 1);
  assert.equal(f.requests().historyRequests, 1);
  assert.match(JSON.stringify(f.render()), /Full|teacher|assigned|passage/);
});

test("the saved result's recording is uploaded once, as one continuous file, before the feedback opens", async () => {
  const f = await recordingFixture();
  button(f.render(), "Start Recording").props.onClick();
  button(f.render(), "Stop Recording").props.onClick();
  f.render(); f.render(); await tick(); f.render();
  assert.equal(f.uploads.length, 1);
  assert.equal(f.uploads[0].attemptId, "oral");
  assert.deepEqual(await Promise.all(f.uploads[0].segments.map((blob) => blob.text())), ["full"]);
  assert.equal(f.uploads[0].afterNavigations, 0, "upload completes before navigation");
  assert.deepEqual(f.navigations, ["/dashboard/read-aloud/results/oral"]);
});

test("Read Aloud has no duplicate playback and Record Again still resets the recording", async () => {
  const f = await recordingFixture({ standalone: true });
  button(f.render(), "Start Recording").props.onClick();
  button(f.render(), "Stop Recording").props.onClick();
  const tree = f.render();
  assert.equal(find(tree, node => node.type === "audio"), undefined);
  assert.doesNotMatch(JSON.stringify(tree), /Review Recording|Your recording is saved with your result/);
  assert.equal(f.recorder.audioSegments.length, 1);
  button(tree, "Record Again").props.onClick();
  assert.equal(f.recorder.audioSegments.length, 0);
  button(f.render(), "Start Recording");
  assert.deepEqual(f.navigations, []);
  assert.equal(f.submissions.length, 0);
});

test("M5 records one uninterrupted file, transcribes that file whole and saves the same file", async () => {
  const f = await recordingFixture();
  // No segment rotation and no second recorder: one MediaRecorder from Start to Stop.
  assert.equal(f.recorderOptions().maxSegmentDurationSeconds, undefined);
  assert.equal(f.recorderOptions().captureFullRecording, undefined);
  assert.equal(f.recorderOptions().maxTotalDurationSeconds, 300);
  button(f.render(), "Start Recording").props.onClick();
  button(f.render(), "Stop Recording").props.onClick();
  f.render(); f.render(); await tick(); f.render();
  assert.equal(f.processedInputs.length, 1);
  const [processedInput] = f.processedInputs;
  assert.equal(processedInput.recording, f.recorder.audioSegments[0]);
  assert.equal(processedInput.recordingDurationSeconds, 60);
  assert.equal(processedInput.audioSegments, undefined, "no 25 s parts are sent for speech-to-text");
  assert.equal(typeof processedInput.transcribeRecording, "function");
  assert.deepEqual(f.uploads[0].segments, [processedInput.recording], "the transcribed file is the saved file");
});

test("a failed recording upload keeps the saved result: retry the upload or continue without it", async () => {
  const f = await recordingFixture({ recordingUploadError: true });
  button(f.render(), "Start Recording").props.onClick();
  button(f.render(), "Stop Recording").props.onClick();
  f.render(); f.render(); await tick(); f.render();
  assert.equal(f.submissions.length, 1);
  assert.deepEqual(f.navigations, []);
  assert.match(JSON.stringify(f.render()), /recording upload failed/i);
  button(f.render(), "Retry Saving Recording").props.onClick();
  await tick(); f.render();
  assert.equal(f.uploads.length, 2, "retry uploads the same in-memory segments again");
  assert.equal(f.submissions.length, 1, "retrying the recording never re-submits the result");
  assert.deepEqual(f.navigations, ["/dashboard/read-aloud/results/oral"]);

  const g = await recordingFixture({ recordingUploadError: true });
  button(g.render(), "Start Recording").props.onClick();
  button(g.render(), "Stop Recording").props.onClick();
  g.render(); g.render(); await tick(); g.render();
  button(g.render(), "Continue Without Recording").props.onClick();
  assert.deepEqual(g.navigations, ["/dashboard/read-aloud/results/oral"]);
  assert.equal(g.uploads.length, 1);
});

test("new assigned activity shows full story without opening microphone; Stop processes once and opens the reading feedback", async () => {
  const f = await recordingFixture();
  assert.match(JSON.stringify(f.render()), /"Full"[^]*"teacher"[^]*"assigned"[^]*"passage"/);
  assert.equal(f.counts().started, 0);
  button(f.render(), "Start Recording").props.onClick();
  button(f.render(), "Stop Recording").props.onClick();
  f.render(); f.render(); await tick(); f.render();
  assert.deepEqual(f.counts(), { started: 1, stopped: 1, processed: 1 });
  assert.equal(f.submissions.length, 1);
  assert.deepEqual(f.statusUpdates, []); // Legacy mode never changes M4 completion.
  // Feedback comes first; the result page links on to the exact M6 activity.
  assert.deepEqual(f.navigations, ["/dashboard/read-aloud/results/oral"]);
});

test("explicit oral-only mode completes via existing status function and opens the oral score", async () => {
  const f = await recordingFixture({ readAloudOnly: true });
  button(f.render(), "Start Recording").props.onClick(); button(f.render(), "Stop Recording").props.onClick();
  f.render(); await tick();
  assert.deepEqual(f.statusUpdates, [["assignment", "completed"]]);
  assert.deepEqual(f.navigations, ["/dashboard/read-aloud/results/oral"]);
  const saved = await recordingFixture({ readAloudOnly: true, saved: true });
  assert.deepEqual(saved.statusUpdates, [["assignment", "completed"]]);
  assert.deepEqual(saved.navigations, ["/dashboard/read-aloud/results/oral"]);
  assert.equal(saved.counts().started, 0);
});

test("legacy false mode retains the identical student card, entry route and comprehension navigation", async () => {
  async function classroom(readAloudOnly?: boolean) {
    const f = mount("modules/module4/pages/StudentClassroomPage.tsx", { roomId: "room" }, {
      classroomService: {
        getClassroomById: async () => ({ id: "room", room_name: "Readers", room_code: "ABC" }),
        getAssignedModules: async () => [],
        isRoomArchived: (room: any) => Boolean(room?.archived_at),
        getStudentReadingActivities: async () => [{ assignment_id: "assignment", material_id: "material", title: "Story",
          assigned_at: "2026-10-08", due_at: null, status: "in_progress", has_questions: false }],
      },
      oralReadingService: { getAssignedReadingProgress: async () => [{ activityAssignmentId: "assignment", materialId: "material",
        roomId: "room", status: "Oral Reading Saved", oralReadingAttemptId: "oral", readAloudOnly }] },
      assignedReadingNavigation: { assignedReadingTarget },
    });
    f.render(); await tick();
    return f;
  }
  const before = await classroom();
  const legacy = await classroom(false);
  assert.equal(JSON.stringify(legacy.render()), JSON.stringify(before.render()));
  button(legacy.render(), "Open Reading Activity").props.onClick();
  button(before.render(), "Open Reading Activity").props.onClick();
  assert.deepEqual(legacy.navigations, before.navigations);
  assert.deepEqual(legacy.navigations, ["/dashboard/read-aloud/results/oral"], "the card uses the existing attempt directly");
  const context = { roomId: "room", materialId: "material", activityAssignmentId: "assignment", oralReadingAttemptId: "oral" };
  assert.equal(assignedReadingTarget({ ...context, readAloudOnly: false }), assignedReadingTarget(context));
  assert.equal(assignedReadingTarget({ ...context, readAloudOnly: false }), "/dashboard/read-aloud/results/oral");
});

test("unfinished classroom activity stays on its card until the passage loads, even with a Completed label", async () => {
  let resolveModule: (value: unknown) => void = () => {};
  let moduleRequests = 0;
  const f = mount("modules/module4/pages/StudentClassroomPage.tsx", { roomId: "room" }, {
    classroomService: {
      getClassroomById: async () => ({ id: "room", room_name: "Readers", room_code: "ABC" }),
      getAssignedModules: async () => [],
      isRoomArchived: (room: any) => Boolean(room?.archived_at),
      getStudentReadingActivities: async () => [{ assignment_id: "assignment", material_id: "material", title: "Story",
        assigned_at: "2026-10-08", status: "completed", has_questions: false }],
    },
    oralReadingService: {
      getAssignedReadingProgress: async () => [{ activityAssignmentId: "assignment", materialId: "material",
        roomId: "room", status: "Completed", oralReadingAttemptId: null }],
      getOralReadingModule: () => { moduleRequests++; return new Promise(resolve => { resolveModule = resolve; }); },
    },
    assignedReadingNavigation: { assignedReadingTarget },
  });
  f.render(); await tick();
  const opening = button(f.render(), "Open Reading Activity").props.onClick();
  assert.deepEqual(f.navigations, []);
  assert.match(JSON.stringify(f.render()), /Opening your reading activity/);
  assert.match(JSON.stringify(f.render()), /Story/);
  resolveModule({ materialId: "material", roomId: "room", activityAssignmentId: "assignment", passage: "Story" });
  await opening;
  assert.equal(moduleRequests, 1);
  assert.deepEqual(f.navigations, ["/dashboard/reading-materials/material/read-aloud?roomId=room&activityAssignmentId=assignment"]);
});

test("oral-only status failure is retryable without reprocessing audio or changing submission identity", async () => {
  const f = await recordingFixture({ readAloudOnly: true, statusError: true });
  button(f.render(), "Start Recording").props.onClick(); button(f.render(), "Stop Recording").props.onClick();
  f.render(); await tick();
  assert.deepEqual(f.navigations, []);
  await button(f.render(), "Try Saving Again").props.onClick();
  assert.equal(f.submissions[0], f.submissions[1]);
  assert.equal(f.counts().processed, 1);
  assert.deepEqual(f.navigations, ["/dashboard/read-aloud/results/oral"]);
});

test("oral-only results retain score, show completion, and offer no comprehension link", async () => {
  const attempt = { id: "oral", materialId: "material", roomId: "room", activityAssignmentId: "assignment",
    moduleId: null, language: "en", moduleTitle: "Story", readAloudOnly: true, readAloudCompleted: true,
    pronunciationAccuracy: 85, readingSpeedWpm: 60, wordMetrics: [], detectedErrorCount: 0, expectedWordCount: 10 };
  const f = mount("pages/reading-activity/ReadingResultPage.tsx", { attemptId: "oral" }, {
    oralReadingService: { getOralReadingAttempt: async () => attempt },
    oralReadingProcessing: { getWordsToPractice: () => [] }, diagnosticTts: {},
    comprehensionNavigation: { comprehensionTargetForReading },
    useAuthenticatedProfile: { default: () => ({ profile: { nickname: "Ana" } }) },
  });
  f.render(); await tick();
  const rendered = JSON.stringify(f.render());
  assert.match(rendered, /Read-aloud activity completed/);
  assert.match(rendered, /Reading Accuracy/);
  assert.match(rendered, /85/);
  assert.doesNotMatch(rendered, /Continue to Questions|Continue to Comprehension/);
});

test("uncertain M5 save retries the identical submission and blocks replacement recording", async () => {
  const f = await recordingFixture({ saveError: true });
  button(f.render(), "Start Recording").props.onClick(); button(f.render(), "Stop Recording").props.onClick();
  f.render(); await tick();
  assert.equal(f.navigations.length, 0);
  const tree = f.render();
  assert.equal(find(tree, node => node.type === "button" && node.props.children === "Record Again").props.disabled, true);
  await button(tree, "Try Saving Again").props.onClick(); await tick();
  assert.equal(f.submissions[0], f.submissions[1]);
  assert.equal(f.counts().processed, 1);
  assert.deepEqual(f.navigations, ["/dashboard/read-aloud/results/oral"]);
});

test("NO_SPEECH never saves or advances and allows retry or a new recording", async () => {
  const f = await recordingFixture({ transcriptionError: true });
  button(f.render(), "Start Recording").props.onClick(); button(f.render(), "Stop Recording").props.onClick();
  f.render(); await tick();
  assert.match(JSON.stringify(f.render()), /NO_SPEECH/);
  assert.equal(f.submissions.length, 0); assert.equal(f.navigations.length, 0);
  button(f.render(), "Record Again").props.onClick();
  button(f.render(), "Start Recording");
});

test("saved oral result reopens its feedback without recording; standalone retains manual processing", async () => {
  const saved = await recordingFixture({ saved: true });
  assert.equal(saved.counts().started, 0); assert.deepEqual(saved.navigations, ["/dashboard/read-aloud/results/oral"]);
  const standalone = await recordingFixture({ standalone: true });
  button(standalone.render(), "Start Recording").props.onClick(); button(standalone.render(), "Stop Recording").props.onClick();
  standalone.render(); await tick();
  assert.equal(standalone.counts().processed, 0);
  await button(standalone.render(), "Process Reading").props.onClick();
  assert.equal(standalone.navigations[0], "/m3/general/read-aloud/results/oral");
});

test("M6 auto-start reuses exact context; missing questions offer reading activity and retry", async () => {
  const inputs: any[] = [];
  const f = mount("modules/module6/pages/ComprehensionPage.tsx", { materialId: "material" }, {
    comprehensionService: { startComprehension: async (input: any) => { inputs.push(input); throw Error("No reviewed questions are available for this story."); } },
  });
  f.render(); f.render(); await tick();
  assert.equal(inputs.length, 1);
  assert.equal(inputs[0].oralReadingAttemptId, "oral"); assert.equal(inputs[0].activityAssignmentId, "assignment");
  assert.equal(inputs[0].materialId, "material"); assert.equal(inputs[0].roomId, "room");
  const tree = f.render();
  assert.match(JSON.stringify(tree), /No reviewed questions/);
  button(tree, "Back to reading activity");
  assert.doesNotMatch(JSON.stringify(tree), /Review saved oral reading|Open oral reading result|Review passage/);
  await button(tree, "Retry comprehension").props.onClick();
  assert.equal(inputs[1].submissionId, inputs[0].submissionId);
});

test("resolved assigned M6 completes automatically and routes to saved results", async () => {
  const summary = { totalQuestions: 1, firstCorrect: 0, hintsUsed: 1, firstAttemptPercentage: 0, allResolved: true,
    byType: { literal: { total: 1, firstCorrect: 0 }, inferential: { total: 0 }, critical: { total: 0 } } };
  const attempt = { id: "m6", materialId: "material", oralReadingAttemptId: "oral", roomId: "room", status: "in_progress",
    summary, questions: [{ id: "q", type: "literal", resolved: true, options: ["A", "B"], answerHistory: [], firstOptionIndex: 0, questionText: "Why?" }] };
  const service = { getComprehension: async () => attempt, sendComprehensionAction: async (_: string, action: any) => {
    assert.equal(action.action, "complete"); attempt.status = "completed"; return { attempt: { ...attempt }, outcome: { completed: true } };
  } };
  const f = mount("modules/module6/pages/ComprehensionPage.tsx", { attemptId: "m6" }, { comprehensionService: service });
  f.render(); await tick();
  assert.doesNotMatch(JSON.stringify(f.render()), /Finish Assessment/);
  await tick();
  f.render();
  assert.ok(f.navigations.includes("/dashboard/comprehension/m6/results"));
  assert.match(JSON.stringify(f.render()), /Your Assessment Results/);
  // The assessment results focus on comprehension; the oral-reading result stays in M5.
  assert.equal(find(f.render(), node => node.type === "oral-summary"), undefined);
  const back = find(f.render(), node => node.type === "button" && node.props.className === "m6-back-button");
  assert.match(JSON.stringify(back.props.children), /Back to Learning Room/);
  assert.ok([back.props.children].flat().some((child: any) => child?.props?.["aria-hidden"] === "true" && child.props.size === 18), "arrow icon");
  const revisit = mount("modules/module6/pages/ComprehensionPage.tsx", { attemptId: "m6" }, { comprehensionService: service });
  revisit.render(); await tick();
  assert.match(JSON.stringify(revisit.render()), /Your Assessment Results/);
  assert.equal(assignedReadingTarget({ materialId: "material", roomId: "room", activityAssignmentId: "assignment", comprehensionAttemptId: "m6" }), "/dashboard/comprehension/m6");
});


test("back to the reading activity shows the saved passage without a redirect loop or new recording", async () => {
  const f = await recordingFixture({ saved: true, viewReading: true });
  assert.match(JSON.stringify(f.render()), /"Full"[^]*"teacher"[^]*"assigned"[^]*"passage"/);
  assert.equal(f.navigations.length, 0);
  assert.equal(f.counts().started, 0);
  button(f.render(), "See My Reading Feedback").props.onClick();
  assert.deepEqual(f.navigations, ["/dashboard/read-aloud/results/oral"]);
  assert.equal(f.submissions.length, 0);
});

test("assigned comprehension shows progress, category, A-D choices and a reading back link", async () => {
  const attempt = { id: "m6", materialId: "material", roomId: "room", activityAssignmentId: "assignment", status: "in_progress",
    summary: { allResolved: false, byType: { literal: { total: 6 }, inferential: { total: 0 }, critical: { total: 0 } } },
    questions: Array.from({ length: 6 }, (_, i) => ({ id: `q${i}`, type: "literal", questionText: "What happened?",
      options: ["First", "Second", "Third", "Fourth"], resolved: false, firstOptionIndex: null, answerHistory: [] })) };
  const f = mount("modules/module6/pages/ComprehensionPage.tsx", { attemptId: "m6" }, {
    comprehensionService: { getComprehension: async () => attempt },
  });
  f.render(); await tick();
  const tree = f.render();
  const progress = find(tree, n => n.props?.className === "m6-question-progress");
  assert.equal(progress.props.children.slice(0, 4).join(""), "Question 1 of 6");
  assert.ok(progress.props.children.includes("Literal"));
  for (const letter of ["A", "B", "C", "D"]) {
    assert.ok(find(tree, n => n.type === "strong" && n.props.children?.[0] === letter));
  }
  button(tree, "Back to reading activity").props.onClick();
  assert.match(f.navigations[0], /read-aloud\?roomId=room&activityAssignmentId=assignment&viewReading=1/);
});

test("automatic completion failure keeps questions saved, offers retry and does not open results early", async () => {
  let calls = 0;
  const attempt = { id: "m6", materialId: "material", status: "in_progress", questions: [{ id: "q", type: "literal",
    options: ["A", "B", "C", "D"], resolved: true, answerHistory: [], firstOptionIndex: 0 }],
    summary: { allResolved: true, byType: { literal: { total: 1 }, inferential: { total: 0 }, critical: { total: 0 } } } };
  const f = mount("modules/module6/pages/ComprehensionPage.tsx", { attemptId: "m6" }, { comprehensionService: {
    getComprehension: async () => attempt,
    sendComprehensionAction: async (_: string, action: any) => {
      assert.equal(action.action, "complete");
      if (++calls === 1) throw Error("Unable to save completion");
      return { attempt: { ...attempt, status: "completed" }, outcome: {} };
    },
  } });
  f.render(); await tick(); f.render(); await tick();
  const tree = f.render();
  assert.match(JSON.stringify(tree), /Unable to save completion/);
  assert.equal(f.navigations.length, 0);
  f.render(); assert.equal(calls, 1);
  await button(tree, "Retry saving").props.onClick();
  await tick();
  f.render();
  assert.equal(calls, 2);
  assert.ok(f.navigations.includes("/dashboard/comprehension/m6/results"));
});

test("Filipino feedback never shows a pronunciation score and opens straight to feedback from history", async () => {
  const attempt = { id: "oral", materialId: null, roomId: null, activityAssignmentId: null, moduleId: "module", passageId: null,
    language: "fil", moduleTitle: "Kuwento", readAloudOnly: false, pronunciationAccuracy: 70, readingSpeedWpm: 50,
    expectedWordCount: 2, transcript: "ang aso", passageSnapshot: "ang pusa",
    wordMetrics: [{ type: "match", expected: "ang", actual: "ang" }, { type: "substitution", expected: "pusa", actual: "aso" }] };
  const pronunciationChecks: (string | undefined)[] = [];
  const f = mount("pages/reading-activity/ReadingResultPage.tsx", { attemptId: "oral" }, {
    searchParams: { view: "feedback" }, pronunciationChecks,
    oralReadingService: { getOralReadingAttempt: async () => attempt },
    oralReadingProcessing: { getWordsToPractice: () => ["pusa"] }, diagnosticTts: {},
    comprehensionNavigation: { comprehensionTargetForReading },
    useAuthenticatedProfile: { default: () => ({ profile: { nickname: "Ana" } }) },
  }, "general_user");
  f.render(); await tick();
  const tree = f.render();
  const text = JSON.stringify(tree);
  assert.equal(find(tree, node => node.props?.id === "m5-panel-feedback").props.open, true);
  assert.equal(find(tree, node => node.props?.id === "m5-panel-result").props.open, false);
  assert.equal(find(tree, node => node.type === "pronunciation-feedback"), undefined);
  assert.match(text, /Pagsusuri ng Bigkas/);
  assert.match(text, /Ang pagsusuri ng bigkas ay para lamang sa mga babasahing Ingles/);
  assert.match(text, /Pakinggan ang salita, bigkasin ito nang dahan-dahan, at subukang basahin ulit\./);
  assert.ok(find(tree, node => node.type === "small" && node.props.children === "Iba ang salitang naitala"));
  assert.match(text, /Ang Kuwento/);
  assert.doesNotMatch(text, /Azure|Pronunciation accuracy|Katumpakan ng pagbigkas/);
  // No pronunciation check exists for Filipino: no panels, no score, and the check is never offered.
  for (const type of ["pronunciation-feedback-panel", "pronunciation-accuracy-panel", "pronunciation-words-panel"]) {
    assert.equal(find(tree, node => node.type === type), undefined, type);
  }
  assert.deepEqual([...new Set(pronunciationChecks)], [undefined]);
  assert.match(text, /walang marka sa pagbigkas ang pagbasang ito/);
  assert.match(text, /kaya wala itong minarkahang salita sa pagbasang ito/);
  // F2's spoken feedback uses the Filipino Philippine voice.
  const listen = find(find(tree, node => node.props?.id === "m5-panel-feedback"), node => node.type === "feedback-speech");
  assert.deepEqual({ language: listen.props.language, voice: listen.props.voice, label: listen.props.listenLabel },
    { language: "fil", voice: "philippine", label: "Listen to feedback" });
  assert.match(listen.props.text, /Ang puna sa pagbigkas ay para lamang sa mga babasahing Ingles/);
});

test("reading feedback comes before questions, in order, with gentle highlights and a link to the exact M6 activity", async () => {
  const attempt = { id: "oral", materialId: "material", roomId: "room", activityAssignmentId: "assignment",
    moduleId: null, language: "en", moduleTitle: "Story", readAloudOnly: false, pronunciationAccuracy: 80,
    readingSpeedWpm: 61.4, expectedWordCount: 4, transcript: "The cat sat mat", passageSnapshot: "The dog sat on the mat.",
    wordMetrics: [{ type: "match", expected: "The", actual: "the" }, { type: "substitution", expected: "dog", actual: "cat" },
      { type: "match", expected: "sat", actual: "sat" }, { type: "omission", expected: "on", actual: null },
      { type: "match", expected: "mat", actual: "mat" }] };
  const mountResult = (role: string, saved: any) => mount("pages/reading-activity/ReadingResultPage.tsx", { attemptId: "oral" }, {
    oralReadingService: { getOralReadingAttempt: async () => saved },
    oralReadingProcessing: { getWordsToPractice: () => ["dog", "on"] }, diagnosticTts: {},
    comprehensionNavigation: { comprehensionTargetForReading },
    useAuthenticatedProfile: { default: () => ({ profile: { full_name: "Ana Cruz" } }) },
  }, role);
  const f = mountResult("student", attempt);
  f.render(); await tick();
  const tree = f.render();
  const text = JSON.stringify(tree);
  // The summary, then one card per function (F2-F6), then each panel's content, then the shared actions.
  const order = ["Great reading, ", "Nice job! A few words need practice.",
    "Pronunciation Feedback", "Pronunciation Accuracy", "Words to Practice", "Read-Aloud Transcript", "Oral Reading Result",
    "pronunciation-feedback-panel", "pronunciation-accuracy-panel", "pronunciation-words-panel", "Words We Heard Differently",
    "Listen to the word, say it slowly, and try reading it again.", "What we heard", "Reading Accuracy", "Your Reading Result",
    "Continue to Questions", "Read again", "Back to my activities"];
  order.reduce((last, label) => { const at = text.indexOf(label, last + 1); assert.ok(at > last, `${label} is out of order`); return at; }, -1);
  assert.match(text, /"Ana"/);
  assert.doesNotMatch(text, /See what to practice|Back to my result|Azure/);
  // Undetected words and recognized differences are labelled apart; neither is called a skip or a mispronunciation.
  assert.ok(find(tree, node => node.type === "small" && node.props.children === "not detected"));
  assert.ok(!find(tree, node => node.type === "small" && node.props.children === "skipped"));
  assert.ok(find(tree, node => node.type === "small" && node.props.children === "read differently"));
  const panel = (id: string, current = f.render()) => find(current, node => node.props?.id === id);
  const card = (title: string) => find(f.render(), node => node.type === "button"
    && JSON.stringify(node.props.children).includes(title) && node.props["aria-haspopup"] === "dialog");
  const ids = ["feedback", "accuracy", "words", "transcript", "result"].map(id => `m5-panel-${id}`);
  const openPanels = () => ids.filter(id => panel(id).props.open);
  // Every panel starts closed; each card opens only its own panel.
  assert.deepEqual(openPanels(), []);
  for (const [title, id] of [["Pronunciation Feedback", "feedback"], ["Pronunciation Accuracy", "accuracy"], ["Words to Practice", "words"],
    ["Read-Aloud Transcript", "transcript"], ["Oral Reading Result", "result"]]) {
    card(title).props.onClick();
    assert.deepEqual(openPanels(), [`m5-panel-${id}`], title);
    assert.equal(panel(`m5-panel-${id}`).props.title, title);
    assert.equal(panel(`m5-panel-${id}`).props.closeLabel, "Close");
    panel(`m5-panel-${id}`).props.onClose();
    assert.deepEqual(openPanels(), []);
  }
  // Each panel holds only its own function's information.
  const content = (id: string) => JSON.stringify(panel(`m5-panel-${id}`));
  assert.ok(find(panel("m5-panel-feedback"), node => node.type === "pronunciation-feedback-panel"));
  assert.ok(find(panel("m5-panel-feedback"), node => node.type === "recording-playback"));
  assert.doesNotMatch(content("feedback"), /Reading Accuracy|words per minute|What we heard|result-feedback-words|"80"|80%/);
  assert.ok(find(panel("m5-panel-accuracy"), node => node.type === "pronunciation-accuracy-panel"));
  assert.doesNotMatch(content("accuracy"), /Reading Accuracy|words per minute|What we heard|result-feedback-words|recording-playback|80%/);
  assert.ok(find(panel("m5-panel-words"), node => node.type === "pronunciation-words-panel"));
  assert.match(content("words"), /They are not a pronunciation check\./);
  assert.doesNotMatch(content("words"), /Reading Accuracy|words per minute|What we heard|recording-playback|80%/);
  assert.match(content("transcript"), /The story/);
  assert.match(content("transcript"), /What we heard/);
  assert.doesNotMatch(content("transcript"), /Reading Accuracy|words per minute|Pronunciation|progress|80%/);
  assert.match(content("result"), /Reading Accuracy/);
  assert.doesNotMatch(content("result"), /What we heard|The story|Pronunciation|result-feedback-words|recording-playback/);
  // F7 stays on the Reading History page; the result page does not embed it.
  assert.equal(find(f.render(), node => node.type === "reading-history"), undefined);
  assert.doesNotMatch(text, /Saved Oral Reading Assessments/);
  // The shared pronunciation check is offered for this English attempt but never started by rendering.
  const once = f.render();
  const check = find(panel("m5-panel-feedback", once), node => node.type === "pronunciation-feedback-panel").props.check;
  assert.equal(check.status, "idle");
  assert.equal(find(panel("m5-panel-accuracy", once), node => node.type === "pronunciation-accuracy-panel").props.check, check);
  assert.equal(find(panel("m5-panel-words", once), node => node.type === "pronunciation-words-panel").props.check, check);
  assert.match(text, /\[3," of ",4\]/);
  assert.doesNotMatch(text, /failed|poor|frustration/i);
  assert.ok(find(tree, node => node.type === "mark" && node.props.children === "cat"));
  assert.ok(find(tree, node => node.type === "progress" && node.props.value === 80));
  assert.ok(find(tree, node => node.type === "button" && node.props["aria-label"] === "Listen to dog"));
  const questions = find(tree, node => node.type === "a" && node.props.children === "Continue to Questions");
  assert.equal(questions.props.to, "/dashboard/reading-materials/material/comprehension?roomId=room&activityAssignmentId=assignment&oralReadingAttemptId=oral");
  // Independent learners only get the button when a module passage target exists.
  const general = mountResult("general_user", { ...attempt, materialId: null, roomId: null, activityAssignmentId: null, moduleId: "module", passageId: null });
  general.render(); await tick();
  assert.doesNotMatch(JSON.stringify(general.render()), /Continue to Questions/);
  const withPassage = mountResult("general_user", { ...attempt, materialId: null, roomId: null, activityAssignmentId: null, moduleId: "module", passageId: "passage" });
  withPassage.render(); await tick();
  assert.ok(find(withPassage.render(), node => node.type === "a" && node.props.children === "Continue to Questions"
    && node.props.to.startsWith("/m3/general/modules/module/comprehension?")));
});


test("cached results render immediately without a GET or hidden recording playback", () => {
  const saved = { id: "oral", userId: "reader", moduleId: "module", language: "en", moduleTitle: "Seeds",
    pronunciationAccuracy: 90, readingSpeedWpm: 60, expectedWordCount: 1, transcript: "seed", wordMetrics: [] };
  let calls = 0;
  const f = mount("pages/reading-activity/ReadingResultPage.tsx", { attemptId: "oral" }, {
    oralReadingService: { peekOralReadingAttempt: () => saved, getOralReadingAttempt: async () => { calls++; return saved; } },
    oralReadingProcessing: { getWordsToPractice: () => [] }, diagnosticTts: {},
    comprehensionNavigation: { comprehensionTargetForReading },
    useAuthenticatedProfile: { default: () => ({ profile: { id: "reader", nickname: "Ana" } }) },
  });
  const tree = f.render();
  assert.match(JSON.stringify(tree), /Great reading/);
  assert.doesNotMatch(JSON.stringify(tree), /Loading your oral-reading result/);
  assert.equal(find(tree, node => node.type === "recording-playback"), undefined);
  assert.equal(calls, 0);
});

test("uncached results preserve errors and retry without displaying success prematurely", async () => {
  const saved = { id: "oral", userId: "reader", moduleId: "module", language: "en", moduleTitle: "Seeds",
    pronunciationAccuracy: 90, readingSpeedWpm: 60, expectedWordCount: 1, transcript: "seed", wordMetrics: [] };
  let calls = 0;
  const f = mount("pages/reading-activity/ReadingResultPage.tsx", { attemptId: "oral" }, {
    oralReadingService: { getOralReadingAttempt: async () => { if (++calls === 1) throw Error("Offline"); return saved; } },
    oralReadingProcessing: { getWordsToPractice: () => [] }, diagnosticTts: {},
    comprehensionNavigation: { comprehensionTargetForReading },
    useAuthenticatedProfile: { default: () => ({ profile: { id: "reader", nickname: "Ana" } }) },
  });
  assert.doesNotMatch(JSON.stringify(f.render()), /Great reading/);
  await tick();
  const failed = f.render();
  assert.match(JSON.stringify(failed), /Offline/);
  assert.doesNotMatch(JSON.stringify(failed), /Great reading/);
  button(failed, "Retry").props.onClick();
  f.render(); await tick();
  assert.match(JSON.stringify(f.render()), /Great reading/);
  assert.equal(calls, 2);
});


test("saved cards follow story, controls and instructions and navigate by actual saved IDs", async () => {
  const history = [
    { id: "new", passageTitle: "A Helping Hand", completedAt: "2026-10-25T02:00:00Z" },
    { id: "old", passageTitle: "A Helping Hand", completedAt: "2026-10-25T01:00:00Z" },
  ];
  const f = await recordingFixture({ standalone: true, history });
  const tree = f.render();
  const text = JSON.stringify(tree);
  const labels = ["Read the Story Aloud", "read-aloud-story-box", "Start Recording", "Recording Instructions", "Your Saved Oral Reading Results"];
  for (let i = 1; i < labels.length; i++) assert.ok(text.indexOf(labels[i]) > text.indexOf(labels[i - 1]));
  const cards = find(tree, node => node.props?.className === "read-aloud-saved-grid").props.children;
  assert.deepEqual(cards.map((card: any) => card.key), ["old", "new"]);
  cards.forEach((card: any) => card.props.onClick());
  assert.deepEqual(f.navigations, ["/m3/general/read-aloud/results/old", "/m3/general/read-aloud/results/new"]);
  assert.equal(f.submissions.length, 0);
});

test("reopened result derives its number from saved data and keeps every panel on that attempt", async () => {
  const saved = { id: "second", userId: "reader", moduleId: "module", language: "en", moduleTitle: "Module",
    passageTitle: "A Helping Hand", pronunciationAccuracy: 90, readingSpeedWpm: 60,
    expectedWordCount: 1, transcript: "seed", wordMetrics: [] };
  const numbered: string[] = [];
  const pronunciationChecks: (string | undefined)[] = [];
  const f = mount("pages/reading-activity/ReadingResultPage.tsx", { attemptId: "second" }, {
    searchParams: { view: "feedback" }, pronunciationChecks,
    oralReadingService: { getOralReadingAttempt: async () => saved,
      getOralReadingAttemptNumber: async (attempt: any) => { numbered.push(attempt.id); return 2; } },
    oralReadingProcessing: { getWordsToPractice: () => [] }, diagnosticTts: {},
    comprehensionNavigation: { comprehensionTargetForReading },
    useAuthenticatedProfile: { default: () => ({ profile: { id: "reader", nickname: "Ana" } }) },
  });
  f.render(); await tick(); f.render(); await tick();
  const tree = f.render();
  assert.deepEqual(numbered, ["second"]);
  const label = find(tree, node => node.props?.className === "result-feedback-story");
  assert.match(JSON.stringify(label), /A Helping Hand/);
  assert.match(JSON.stringify(label), /Result/);
  assert.equal(label.props.children[1].props.children.at(-1), 2);
  assert.equal(find(tree, node => node.type === "recording-playback").props.attemptId, "second");
  // The pronunciation check offered in the F2-F4 panels belongs to this English attempt.
  assert.equal(pronunciationChecks.at(-1), "second");
  assert.equal(find(tree, node => node.props?.id === "m5-panel-feedback").props.open, true);
  assert.match(JSON.stringify(find(tree, node => node.props?.className === "result-feedback-transcript")), /seed/);
});

function gate() {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => { open = resolve; });
  return { promise, open };
}

test("the status names each step: preparing, sending, processing, saving the result, then the recording", async () => {
  const transcription = gate(), save = gate(), upload = gate();
  const f = await recordingFixture({ standalone: true, callTranscription: true,
    gates: { transcription: transcription.promise, save: save.promise, upload: upload.promise } });
  button(f.render(), "Start Recording").props.onClick();
  button(f.render(), "Stop Recording").props.onClick();
  button(f.render(), "Process Reading").props.onClick();
  await tick();
  assert.match(f.stepTexts[0], /Preparing your recording\.\.\./);
  assert.match(f.stepTexts[1], /Sending your recording\.\.\./);
  assert.match(f.stepTexts[2], /Processing your reading\.\.\./);
  assert.doesNotMatch(f.stepTexts.join(""), /Saving your/);
  // The request gets the reading length (for its deadline) and a signal that can cancel it.
  assert.equal(f.transcriptionOptions[0].recordingDurationSeconds, 60);
  assert.equal(f.transcriptionOptions[0].signal.aborted, false);
  transcription.open(); await tick(); await tick();
  assert.match(JSON.stringify(f.render()), /Saving your result\.\.\./);
  save.open(); await tick(); await tick();
  assert.match(JSON.stringify(f.render()), /Saving your recording\.\.\./);
  upload.open(); await tick(); await tick();
  assert.deepEqual(f.navigations, ["/m3/general/read-aloud/results/oral"]);
  assert.equal(f.counts().processed, 1);
  assert.equal(f.submissions.length, 1);
  assert.equal(f.uploads.length, 1);
});

test("leaving the page or recording again cancels a speech-to-text request still in flight", async () => {
  const transcription = gate();
  const f = await recordingFixture({ standalone: true, callTranscription: true, gates: { transcription: transcription.promise } });
  button(f.render(), "Start Recording").props.onClick();
  button(f.render(), "Stop Recording").props.onClick();
  button(f.render(), "Process Reading").props.onClick();
  await tick();
  f.unmount();
  assert.equal(f.transcriptionOptions[0].signal.aborted, true);
  transcription.open(); await tick();
  assert.equal(f.submissions.length, 0, "a cancelled request never saves a result");
});

test("a failed save keeps the transcript and retries with the same submission, never re-transcribing", async () => {
  const f = await recordingFixture({ standalone: true, saveError: true });
  button(f.render(), "Start Recording").props.onClick();
  button(f.render(), "Stop Recording").props.onClick();
  button(f.render(), "Process Reading").props.onClick();
  await tick(); await tick();
  button(f.render(), "Try Saving Again").props.onClick();
  await tick(); await tick();
  assert.equal(f.counts().processed, 1);
  assert.equal(f.submissions.length, 2);
  assert.equal(f.submissions[0].submissionId, f.submissions[1].submissionId);
  assert.equal(f.submissions[0], f.submissions[1], "the very same saved input is retried");
});

test("a learner reading without questions says so instead of hiding the next step", async () => {
  const base = { id: "oral", materialId: null, roomId: null, activityAssignmentId: null, assignmentId: null,
    language: "en", moduleTitle: "Story", pronunciationAccuracy: 80, readingSpeedWpm: 60, expectedWordCount: 4,
    transcript: "The cat sat", wordMetrics: [] };
  const show = async (role: string, saved: any) => {
    const page = mount("pages/reading-activity/ReadingResultPage.tsx", { attemptId: "oral" }, {
      oralReadingService: { getOralReadingAttempt: async () => saved },
      oralReadingProcessing: { getWordsToPractice: () => [] }, diagnosticTts: {},
      comprehensionNavigation: { comprehensionTargetForReading },
      useAuthenticatedProfile: { default: () => ({ profile: { full_name: "Ana Cruz" } }) },
    }, role);
    page.render(); await tick();
    return JSON.stringify(page.render());
  };
  const note = /Comprehension questions are not available for this story yet/;
  // A module saved without a passage record has no comprehension activity.
  const noPassage = await show("general_user", { ...base, moduleId: "module", passageId: null });
  assert.match(noPassage, note);
  assert.doesNotMatch(noPassage, /Continue to Questions/);
  // With a passage, the exact activity is linked and no note is shown.
  const withPassage = await show("general_user", { ...base, moduleId: "module", passageId: "passage" });
  assert.match(withPassage, /Continue to Questions/);
  assert.doesNotMatch(withPassage, note);
  // Read-aloud-only activities and admin practice never had questions: nothing extra.
  assert.doesNotMatch(await show("student", { ...base, materialId: "material", roomId: "room", activityAssignmentId: "a", moduleId: null, readAloudOnly: true }), note);
  assert.doesNotMatch(await show("admin", { ...base, moduleId: "module", passageId: "passage" }), note);
});

test("Reading History reopens each module reading's own comprehension activity or results", async () => {
  const rows = [
    { id: "oral-1", moduleId: "module", passageId: "passage", roomId: null, assignmentId: null, materialId: null,
      moduleTitle: "Stories", passageTitle: "A Helping Hand", language: "en", completedAt: "2026-10-25T08:00:00Z",
      pronunciationAccuracy: 93, readingSpeedWpm: 90, detectedErrorCount: 2 },
    { id: "oral-2", moduleId: "module", passageId: null, roomId: null, assignmentId: null, materialId: null,
      moduleTitle: "Stories", passageTitle: "Legacy story", language: "en", completedAt: "2026-10-24T08:00:00Z",
      pronunciationAccuracy: 90, readingSpeedWpm: 80, detectedErrorCount: 3 },
    { id: "oral-3", moduleId: null, passageId: null, roomId: "room", assignmentId: null, materialId: "material",
      activityAssignmentId: "activity", moduleTitle: "Assigned", passageTitle: "Assigned story", language: "fil",
      completedAt: "2026-10-23T08:00:00Z", pronunciationAccuracy: 88, readingSpeedWpm: 70, detectedErrorCount: 4 },
  ];
  const links = async (role: string) => {
    const page = mount("modules/module5/pages/ReadingHistoryPage.tsx", {}, {
      oralReadingService: { getOwnOralReadingAttempts: async () => rows },
      comprehensionNavigation: { comprehensionTargetForReading },
    }, role);
    page.render(); await tick();
    const found: string[] = [];
    (function walk(node: any) {
      if (!node || typeof node !== "object") return;
      if (node.type === "a" && JSON.stringify(node.props.children).includes("Questions")) found.push(node.props.to);
      [node.props?.children].flat(Infinity).forEach(walk);
    })(page.render());
    return found;
  };
  assert.deepEqual(await links("general_user"),
    ["/m3/general/modules/module/comprehension?passageId=passage&oralReadingAttemptId=oral-1"]);
  assert.deepEqual(await links("student"), ["/dashboard/materials/module/comprehension?passageId=passage&oralReadingAttemptId=oral-1"]);
  assert.deepEqual(await links("admin"), [], "admin practice has no comprehension");
});

test("the question flow moves forward only, with one final Submit answer and an arrow back link", async () => {
  const summary = { totalQuestions: 2, firstCorrect: 1, hintsUsed: 0, firstAttemptPercentage: 50, allResolved: false,
    byType: { literal: { total: 1, firstCorrect: 1 }, inferential: { total: 1, firstCorrect: 0 }, critical: { total: 0 } } };
  const attempt = { id: "m6", materialId: "material", oralReadingAttemptId: "oral", roomId: "room", activityAssignmentId: "assignment",
    status: "in_progress", language: "en", summary, questions: [
      { id: "q1", type: "literal", resolved: true, options: ["A", "B", "C", "D"], answerHistory: [{ optionIndex: 0, correct: true }],
        firstOptionIndex: 0, firstAnswerCorrect: true, questionText: "Who?", correctOptionIndex: 0 },
      { id: "q2", type: "inferential", resolved: false, options: ["A", "B", "C", "D"], answerHistory: [], firstOptionIndex: null,
        questionText: "Why?" },
    ] };
  const f = mount("modules/module6/pages/ComprehensionPage.tsx", { attemptId: "m6" }, {
    comprehensionService: { getComprehension: async () => attempt, sendComprehensionAction: async () => ({ attempt, outcome: {} }) },
  });
  f.render(); await tick();
  const tree = f.render();
  const text = JSON.stringify(tree);
  // Reopens at the first unfinished question, and there is no way back to change answers.
  assert.match(text, /Why\?/);
  assert.doesNotMatch(text, /Previous Question/);
  // Single attempt: one Submit answer action, no Help me, no second answer, no Next until submitted.
  assert.match(text, /You can answer each question once\. Your submitted answer is final\./);
  assert.ok(find(tree, node => node.type === "button" && node.props.children === "Submit answer"));
  assert.doesNotMatch(text, /Help me|Check second answer|Try again|try once more|Next Question/);
  const back = find(tree, node => node.type === "button" && node.props.className === "m6-back-button");
  assert.match(JSON.stringify(back.props.children), /Back to reading activity/);
  back.props.onClick();
  assert.deepEqual(f.navigations, ["/dashboard/reading-materials/material/read-aloud?roomId=room&activityAssignmentId=assignment&viewReading=1"]);
});

test("read-aloud shows no mascot before, during or after recording; the saved reading is a plain status line", async () => {
  const f = await recordingFixture();
  const mascot = () => find(f.render(), node => node.type === "reading-mascot");
  assert.equal(mascot(), undefined);
  button(f.render(), "Start Recording").props.onClick();
  await tick();
  assert.equal(mascot(), undefined);
  const saved = await recordingFixture({ saved: true, viewReading: true });
  const tree = saved.render();
  assert.equal(find(tree, node => node.type === "reading-mascot"), undefined);
  const status = find(tree, node => node.type === "p" && node.props.role === "status"
    && JSON.stringify(node.props.children).includes("Your reading is saved."));
  assert.ok(status);
});

test("the M5 result shows the existing encouragement as text, without a mascot, and word practice uses the shared player", async () => {
  const played: unknown[][] = [];
  const speech = { play: async (...args: any[]) => { played.push(args); return true; }, stop() {},
    getState: () => ({ status: "idle", key: null, muted: false }) };
  const f = mount("pages/reading-activity/ReadingResultPage.tsx", { attemptId: "oral" }, {
    oralReadingService: { getOralReadingAttempt: async () => ({ id: "oral", materialId: null, roomId: null, activityAssignmentId: null,
      moduleId: "module", passageId: null, language: "fil", moduleTitle: "Kuwento", readAloudOnly: false, pronunciationAccuracy: 92,
      readingSpeedWpm: 50, expectedWordCount: 1, transcript: "aso", wordMetrics: [{ type: "match", expected: "aso", actual: "aso" }] }) },
    oralReadingProcessing: { getWordsToPractice: () => ["pusa"] }, speechPlayer: speech,
    comprehensionNavigation: { comprehensionTargetForReading },
    useAuthenticatedProfile: { default: () => ({ profile: { nickname: "Ana" } }) },
  }, "general_user");
  f.render(); await tick();
  const tree = f.render();
  assert.equal(find(tree, node => node.type === "reading-mascot"), undefined);
  const message = find(tree, node => node.type === "p" && node.props.className === "result-feedback-message");
  assert.equal(message.props.children, activityLanguage.getActivityText("fil").t("Wow, we heard almost every word of the story!"));
  await find(tree, node => node.type === "button" && node.props["aria-label"] === "Pakinggan ang pusa").props.onClick();
  assert.deepEqual(played, [["pusa", "fil", undefined, "philippine"]]);
});

test("an incorrect answer is final: Incorrect feedback, a separate guiding prompt, no second attempt", async () => {
  const base = { id: "q", type: "literal", resolved: false, options: ["A", "B", "C", "D"], answerHistory: [] as any[],
    firstOptionIndex: null as number | null, hintUsed: false, hint: null as string | null, questionText: "Who?" };
  const next = { ...base, id: "q2", questionText: "Where?" };
  let attempt: any = { id: "m6", materialId: null, status: "in_progress", language: "en", questions: [base, next],
    summary: { allResolved: false, byType: { literal: { total: 2 }, inferential: { total: 0 }, critical: { total: 0 } } } };
  const sent: any[] = [];
  const answered = { ...base, resolved: true, correctOptionIndex: 0, answerExplanation: "Ana is named first.",
    supportingEvidence: "Ana went to the market.", scaffoldingPrompt: "Look at who the story names first.",
    answerHistory: [{ optionIndex: 1, correct: false }], firstOptionIndex: 1, firstAnswerCorrect: false };
  const f = mount("modules/module6/pages/ComprehensionPage.tsx", { attemptId: "m6" }, { comprehensionService: {
    getComprehension: async () => attempt,
    sendComprehensionAction: async (_id: string, action: any) => {
      sent.push(action);
      attempt = { ...attempt, questions: [answered, next] };
      return { attempt, outcome: { correct: false, resolved: true, final: true } };
    },
  } });
  const mascot = () => find(f.render(), node => node.type === "reading-mascot");
  f.render(); await tick();
  assert.equal(mascot().props.message, "");
  find(f.render(), node => node.type === "input" && node.props.value === 1).props.onChange();
  button(f.render(), "Submit answer").props.onClick(); await tick();
  assert.deepEqual(sent.map(action => [action.action, action.optionIndex]), [["answer", 1]]);

  const tree = f.render();
  const text = JSON.stringify(tree);
  // The mascot never invites another try.
  assert.equal(mascot().props.mood, "tryAgain");
  assert.equal(mascot().props.message, "That answer is not correct. Read the feedback below, then continue.");
  assert.doesNotMatch(text, /Submit answer|Check second answer|Help me|try once more|Try again/);
  // The answer is locked: the options are disabled and show the saved answer.
  assert.equal(find(tree, node => node.type === "fieldset").props.disabled, true);
  assert.equal(find(tree, node => node.type === "input" && node.props.value === 1).props.checked, true);
  // F3 contextualized feedback and F2 scaffolding prompt are separate, identifiable blocks.
  const feedback = find(tree, node => node.type?.name === "SubmittedAnswerFeedback");
  const feedbackTree = feedback.type(feedback.props);
  assert.match(JSON.stringify(feedbackTree), /"Incorrect"/);
  assert.match(JSON.stringify(feedbackTree), /Your answer:/);
  const answerFeedback = find(feedbackTree, node => node.type?.name === "AnswerFeedback");
  const explanation = find(answerFeedback.type(answerFeedback.props), node => node.type === "feedback-speech");
  assert.equal(explanation.props.listenLabel, "Listen to the explanation");
  assert.equal(explanation.props.text, "Correct answer: A Why this answer fits: Ana is named first. Evidence from the passage: Ana went to the market.");
  const prompt = find(tree, node => node.type?.name === "ScaffoldingPrompt");
  const promptTree = prompt.type(prompt.props);
  assert.match(JSON.stringify(promptTree), /Think about it/);
  assert.match(JSON.stringify(promptTree), /Look at who the story names first\./);
  assert.doesNotMatch(JSON.stringify(promptTree), /Ana is named first|Correct answer/, "the prompt does not repeat the explanation");
  assert.equal(find(promptTree, node => node.type === "feedback-speech").props.listenLabel, "Listen to the clue");
  // One way forward: Next Question.
  button(f.render(), "Next Question").props.onClick();
  assert.match(JSON.stringify(f.render()), /Where\?/);
  // The mascot never receives scores or answer keys.
  for (const node of [mascot(), explanation]) assert.doesNotMatch(JSON.stringify(Object.keys(node.props)), /score|correctOptionIndex|summary/i);
});

test("a correct answer shows Correct feedback and no guiding prompt", async () => {
  const question = { id: "q", type: "literal", resolved: true, options: ["A", "B", "C", "D"], answerHistory: [{ optionIndex: 0, correct: true }],
    firstOptionIndex: 0, firstAnswerCorrect: true, correctOptionIndex: 0, answerExplanation: "Ana is named first.",
    scaffoldingPrompt: null, hintUsed: false, hint: null, questionText: "Who?" };
  const attempt = { id: "m6", materialId: null, status: "in_progress", language: "fil", questions: [question],
    summary: { allResolved: true, byType: { literal: { total: 1 }, inferential: { total: 0 }, critical: { total: 0 } } } };
  const f = mount("modules/module6/pages/ComprehensionPage.tsx", { attemptId: "m6" }, { comprehensionService: {
    getComprehension: async () => attempt, sendComprehensionAction: async () => ({ attempt, outcome: { completed: true } }) } }, "general_user");
  f.render(); await tick();
  const tree = f.render();
  const feedback = find(tree, node => node.type?.name === "SubmittedAnswerFeedback");
  assert.match(JSON.stringify(feedback.type(feedback.props)), /"Tama!"/);
  const prompt = find(tree, node => node.type?.name === "ScaffoldingPrompt");
  assert.equal(prompt.type(prompt.props), null);
  // A finished module activity offers only Finish Assessment, in Filipino.
  assert.ok(button(tree, "Tapusin ang Gawain"));
  assert.doesNotMatch(JSON.stringify(tree), /Ipasa ang sagot|Help me|Tulungan ako/);
});

test("final results show one score per final answer with no second-attempt or first-answer labels", async () => {
  const questions = [
    { id: "q1", type: "literal", resolved: true, options: ["A", "B", "C", "D"], firstOptionIndex: 0, firstAnswerCorrect: true,
      correctOptionIndex: 0, answerExplanation: "Because.", answerHistory: [{ optionIndex: 0, correct: true }], hintUsed: false, hint: null, questionText: "Who?" },
    // An activity saved under the old two-try rule: its second answer is never shown or scored.
    { id: "q2", type: "inferential", resolved: true, options: ["A", "B", "C", "D"], firstOptionIndex: 2, firstAnswerCorrect: false,
      correctOptionIndex: 1, answerExplanation: "Because.", answerHistory: [{ optionIndex: 2, correct: false }, { optionIndex: 1, correct: true }],
      hintUsed: false, hint: null, questionText: "Why?" },
  ];
  const summary = { totalQuestions: 2, firstCorrect: 1, firstAttemptPercentage: 50, hintsUsed: 0, allResolved: true,
    byType: { literal: { total: 1, firstCorrect: 1, firstAttemptPercentage: 100 }, inferential: { total: 1, firstCorrect: 0, firstAttemptPercentage: 0 },
      critical: { total: 0, firstCorrect: 0, firstAttemptPercentage: 0 } } };
  for (const language of ["en", "fil"] as const) {
    const attempt = { id: "m6", materialId: null, status: "completed", language, questions, summary };
    const f = mount("modules/module6/pages/ComprehensionPage.tsx", { attemptId: "m6" }, { comprehensionService: {
      getComprehension: async () => attempt, sendComprehensionAction: async () => ({ attempt, outcome: {} }) } }, "general_user");
    f.render(); await tick();
    const text = JSON.stringify(f.render());
    const ui = activityLanguage.getActivityText(language);
    assert.match(text, new RegExp(ui.t("Comprehension score")));
    assert.match(text, /50/);
    assert.match(text, new RegExp(ui.t("Each question has one final answer. Each correct answer earns one point.").replace(/[.]/g, "\\.")));
    assert.match(text, new RegExp(ui.t("{correct}/{total} correct ({percentage}%)", { correct: 1, total: 1, percentage: 100 }).replace(/[()%]/g, "\\$&")));
    for (const label of ["First-answer score", "Second answer:", "First answer:", "Correct on your first answer.", "Incorrect on your first answer.",
      "This score uses your first answer to each question, including answers given after using a hint. Second answers do not change this score.",
      "Questions where you used a hint:", "Correct on your first answer."]) {
      assert.ok(!text.includes(ui.t(label as any)), `${language}: ${label}`);
    }
    assert.ok(text.includes(ui.t("Your answer:")));
  }
});
