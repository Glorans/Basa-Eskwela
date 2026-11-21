import * as savedAttemptOrder from "../src/modules/module5/services/savedAttemptOrder.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { assignedReadingTarget } from "../src/modules/module5/services/assignedReadingNavigation.ts";
import * as comprehensionNavigation from "../src/modules/module5/services/comprehensionNavigation.ts";

const { comprehensionTargetForReading } = comprehensionNavigation;
import * as voiceFollow from "../src/pages/reading-activity/voiceFollow.ts";
import { storyParagraphs } from "../src/pages/reading-activity/storyDisplay.ts";
import * as activityLanguage from "../src/pages/reading-activity/activityLanguage.ts";
import * as resultWords from "../src/modules/module5/services/resultWords.ts";

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
      if (id.endsWith("/resultWords")) return resultWords;
      if (id.endsWith("/savedAttemptOrder")) return savedAttemptOrder;
      if (id === "react-router-dom") return { Link: "a", useParams: () => params, useLocation: () => ({ state: mocks.locationState }),
        useSearchParams: () => [new URLSearchParams({ roomId: "room", activityAssignmentId: "assignment", oralReadingAttemptId: "oral", ...mocks.searchParams }), () => {}],
        useNavigate: () => (target: string) => navigations.push(target) };
      // Pages use the real route helpers; a test may still replace comprehensionTargetForReading.
      if (id.endsWith("/comprehensionNavigation")) return { ...comprehensionNavigation, ...mocks.comprehensionNavigation };
      for (const [suffix, value] of Object.entries(mocks)) if (id.endsWith(suffix)) return suffix === "oralReadingService"
        ? { peekOralReadingAttemptNumber: () => undefined, getOralReadingAttemptNumber: async () => undefined, peekOralReadingAttempt: () => undefined, rememberOralReadingAttempt() {}, ...value } : value;
      if (id.endsWith(".css")) return {};
      if (id.includes("ActivityHeader")) return { default: "header" };
      if (id.includes("OralReadingSummary")) return { default: "oral-summary" };
      if (id.includes("RecordingPlayback")) return { default: "recording-playback" };
      if (id.endsWith("/comprehensionService") && !mocks.comprehensionService) return {
        getComprehensionForReading: async (readingId: string) => {
          (mocks.comprehensionLookups ??= []).push(readingId);
          if (mocks.linkedComprehensionError) throw Error("Unable to check your comprehension activity.");
          return typeof mocks.linkedComprehension === "function" ? mocks.linkedComprehension(readingId) : mocks.linkedComprehension ?? null;
        } };
      if (id.includes("FilipinoReadingFeedback")) return { default: "filipino-reading-feedback",
        FilipinoReadingAccuracyPanel: "filipino-accuracy-panel", FilipinoWordReviewPanel: "filipino-word-review-panel" };
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
  const inputs: Record<string, unknown>[] = [];
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
  // Completed results: no top back link; the Learning Room is the bottom button.
  assert.equal(find(f.render(), node => node.type === "button" && node.props.className === "m6-back-button"), undefined);
  const room = find(f.render(), node => node.type === "a" && node.props.children === "Back to Learning Room");
  assert.equal(room.props.to, "/dashboard/learning-rooms/room");
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
  assert.doesNotMatch(text, /Pagsusuri ng Bigkas|Ang pagsusuri ng bigkas ay para lamang sa mga babasahing Ingles/);
  // F4 lists no transcript differences; they are shown, in Filipino, in F5 only.
  assert.doesNotMatch(text, /Mga Salitang Iba ang Narinig Namin|Iba ang salitang naitala|hindi narinig"/);
  assert.match(text, /Ang Kuwento/);
  assert.match(text, /Ang Narinig ng Computer/);
  const different = find(tree, node => node.type === "button" && node.props.className?.includes("result-heard-word"));
  assert.equal(different.props.children[0], "aso");
  different.props.onClick();
  assert.match(JSON.stringify(f.render()), /Ang nasa kuwento: “pusa”\./);
  assert.doesNotMatch(text, /Azure|Pronunciation accuracy|Katumpakan ng pagbigkas/);
  // No pronunciation check exists for Filipino: no panels, no score, and the check is never offered.
  for (const type of ["pronunciation-feedback-panel", "pronunciation-accuracy-panel", "pronunciation-words-panel"]) {
    assert.equal(find(tree, node => node.type === type), undefined, type);
  }
  assert.deepEqual([...new Set(pronunciationChecks)], [undefined]);
  assert.doesNotMatch(text, /walang marka sa pagbigkas ang pagbasang ito|kaya wala itong minarkahang salita sa pagbasang ito/);
  // F2 has no feedback text-to-speech button; feedback from this saved attempt and the learner's recording remain.
  const feedbackPanel = find(tree, node => node.props?.id === "m5-panel-feedback");
  assert.equal(find(feedbackPanel, node => node.type === "feedback-speech"), undefined);
  assert.doesNotMatch(JSON.stringify(feedbackPanel), /Ang puna sa pagbigkas ay para lamang sa mga babasahing Ingles/);
  assert.equal(find(feedbackPanel, node => node.type === "filipino-reading-feedback").props.attempt, attempt);
  assert.ok(find(feedbackPanel, node => node.type === "recording-playback"));
  // The Filipino F2 card and modal describe reading feedback, not a pronunciation check.
  assert.equal(find(tree, node => node.props?.id === "m5-panel-feedback").props.title, "Puna sa Pagbasa");
  const card = find(tree, node => node.props?.className?.includes?.("result-panel-card--feedback"));
  assert.equal(find(card, node => node.props?.className === "result-panel-card-title").props.children, "Puna sa Pagbasa");
  assert.equal(find(card, node => node.props?.className === "result-panel-card-text").props.children, "Ihambing ang kuwento sa mga salitang narinig ng computer.");
  assert.doesNotMatch(text, /Puna sa Pagbigkas|Alamin kung gaano kalinaw/);
  // F3 and F4 keep their cards and modals, with truthful Filipino titles and this attempt's data.
  const accuracyModal = find(tree, node => node.props?.id === "m5-panel-accuracy");
  assert.equal(accuracyModal.props.title, "Katumpakan ng Pagbasa");
  assert.equal(find(accuracyModal, node => node.type === "filipino-accuracy-panel").props.attempt, attempt);
  const wordsModal = find(tree, node => node.props?.id === "m5-panel-words");
  assert.equal(wordsModal.props.title, "Mga Salitang Dapat Balikan");
  assert.equal(find(wordsModal, node => node.type === "filipino-word-review-panel").props.attempt, attempt);
  const accuracyCard = find(tree, node => node.props?.className?.includes?.("result-panel-card--accuracy"));
  assert.equal(find(accuracyCard, node => node.props?.className === "result-panel-card-title").props.children, "Katumpakan ng Pagbasa");
  assert.equal(JSON.stringify(find(accuracyCard, node => node.props?.className === "result-panel-card-value").props.children), JSON.stringify([70, "%"]), "the same saved score as F6");
  const wordsCard = find(tree, node => node.props?.className?.includes?.("result-panel-card--words"));
  assert.equal(find(wordsCard, node => node.props?.className === "result-panel-card-title").props.children, "Mga Salitang Dapat Balikan");
  assert.doesNotMatch(text, /Katumpakan ng Pagbigkas|Mali ang Bigkas/);
  // F6 is unchanged and reads the same saved attempt.
  assert.match(text, /"1 sa 2"/);
  assert.match(text, /50 salita bawat minuto/);
});

test("English F2 keeps its pronunciation panel and never shows the Filipino feedback", async () => {
  const attempt = { id: "oral", materialId: null, roomId: null, activityAssignmentId: null, moduleId: "module", passageId: null,
    language: "en", moduleTitle: "Story", readAloudOnly: false, pronunciationAccuracy: 70, readingSpeedWpm: 50,
    expectedWordCount: 2, transcript: "the cat", passageSnapshot: "the dog",
    wordMetrics: [{ type: "match", expected: "the", actual: "the" }, { type: "substitution", expected: "dog", actual: "cat" }] };
  const pronunciationChecks: (string | undefined)[] = [];
  const f = mount("pages/reading-activity/ReadingResultPage.tsx", { attemptId: "oral" }, {
    searchParams: { view: "feedback" }, pronunciationChecks,
    oralReadingService: { getOralReadingAttempt: async () => attempt },
    oralReadingProcessing: { getWordsToPractice: () => [] }, diagnosticTts: {},
    comprehensionNavigation: { comprehensionTargetForReading },
    useAuthenticatedProfile: { default: () => ({ profile: { nickname: "Ana" } }) },
  }, "general_user");
  f.render(); await tick();
  const tree = f.render();
  assert.equal(find(tree, node => node.type === "filipino-reading-feedback"), undefined);
  // English F2 keeps its card and modal wording.
  assert.equal(find(tree, node => node.props?.id === "m5-panel-feedback").props.title, "Pronunciation Feedback");
  const card = find(tree, node => node.props?.className?.includes?.("result-panel-card--feedback"));
  assert.equal(find(card, node => node.props?.className === "result-panel-card-title").props.children, "Pronunciation Feedback");
  assert.equal(find(card, node => node.props?.className === "result-panel-card-text").props.children, "Get tips about how clearly you said the words.");
  assert.doesNotMatch(JSON.stringify(tree), /Reading Feedback|Compare the story with the words the computer heard/);
  // English F3 and F4 keep their cards, modals and panels, with no Filipino panel.
  assert.equal(find(tree, node => node.props?.id === "m5-panel-accuracy").props.title, "Pronunciation Accuracy");
  assert.equal(find(tree, node => node.props?.id === "m5-panel-words").props.title, "Mispronounced Words");
  const englishAccuracyCard = find(tree, node => node.props?.className?.includes?.("result-panel-card--accuracy"));
  assert.equal(find(englishAccuracyCard, node => node.props?.className === "result-panel-card-text").props.children, "See your pronunciation accuracy score.");
  assert.equal(find(englishAccuracyCard, node => node.props?.className === "result-panel-card-value"), undefined, "no Reading Accuracy on the English F3 card");
  const englishWordsCard = find(tree, node => node.props?.className?.includes?.("result-panel-card--words"));
  assert.equal(find(englishWordsCard, node => node.props?.className === "result-panel-card-text").props.children, "Listen to words and practice saying them.");
  assert.equal(find(tree, node => node.type === "filipino-accuracy-panel"), undefined);
  assert.equal(find(tree, node => node.type === "filipino-word-review-panel"), undefined);
  const panel = find(tree, node => node.type === "pronunciation-feedback-panel");
  assert.equal(panel.props.autoStart, true);
  assert.equal(pronunciationChecks.at(-1), "oral");
  assert.ok(find(tree, node => node.type === "pronunciation-accuracy-panel"));
  assert.ok(find(tree, node => node.type === "pronunciation-words-panel"));
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
  // A second pass lets the linked M6 status load (no activity yet: Continue to Questions).
  f.render(); await tick();
  const tree = f.render();
  const text = JSON.stringify(tree);
  // The summary, then one card per function (F2-F6), then each panel's content, then the shared actions.
  const order = ["Reading Complete!", "You finished your reading activity! Explore your results below to see how you did.",
    "Pronunciation Feedback", "Pronunciation Accuracy", "Mispronounced Words", "Read-Aloud Transcript", "Oral Reading Result",
    "pronunciation-feedback-panel", "pronunciation-accuracy-panel", "pronunciation-words-panel", "The Story", "What We Heard",
    "Reading Accuracy", "How closely the words we heard matched the story.", "Your Reading Result", "Words Matched", "Reading Speed",
    "Continue to Questions", "Read again", "Back to my activities"];
  order.reduce((last, label) => { const at = text.indexOf(label, last + 1); assert.ok(at > last, `${label} is out of order`); return at; }, -1);
  // The summary title is the fixed "Reading Complete!"; it no longer includes the learner's name.
  assert.doesNotMatch(text, /"Ana"/);
  assert.doesNotMatch(text, /See what to practice|Back to my result|Azure/);
  // Transcript differences are not listed in F4 and are never called mispronunciations.
  assert.doesNotMatch(text, /Words We Heard Differently|not detected|read differently|skipped/);
  const panel = (id: string, current = f.render()) => find(current, node => node.props?.id === id);
  const card = (title: string) => find(f.render(), node => node.type === "button"
    && JSON.stringify(node.props.children).includes(title) && node.props["aria-haspopup"] === "dialog");
  const ids = ["feedback", "accuracy", "words", "transcript", "result"].map(id => `m5-panel-${id}`);
  const openPanels = () => ids.filter(id => panel(id).props.open);
  // Every panel starts closed; each card opens only its own panel.
  assert.deepEqual(openPanels(), []);
  for (const [title, id] of [["Pronunciation Feedback", "feedback"], ["Pronunciation Accuracy", "accuracy"], ["Mispronounced Words", "words"],
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
  assert.doesNotMatch(content("feedback"), /Reading Accuracy|words per minute|What We Heard|result-feedback-words|"80"|80%/);
  assert.equal(find(panel("m5-panel-feedback"), node => node.type === "feedback-speech"), undefined, "F2 has no feedback text-to-speech");
  assert.ok(find(panel("m5-panel-accuracy"), node => node.type === "pronunciation-accuracy-panel"));
  assert.doesNotMatch(content("accuracy"), /Reading Accuracy|words per minute|What We Heard|result-feedback-words|recording-playback|80%/);
  assert.ok(find(panel("m5-panel-words"), node => node.type === "pronunciation-words-panel"));
  // F3 and F4 place practice words in the story the learner read (with the title the screen hides).
  for (const id of ["accuracy", "words"]) {
    assert.deepEqual({ ...find(panel(`m5-panel-${id}`), node => node.type === `pronunciation-${id}-panel`).props.story },
      { passage: "The dog sat on the mat.", title: "Story" });
  }
  assert.doesNotMatch(content("words"), /Reading Accuracy|words per minute|What We Heard|recording-playback|80%|result-feedback-words|Listen to/);
  assert.match(content("transcript"), /The Story/);
  assert.match(content("transcript"), /What We Heard/);
  assert.match(content("transcript"), /Orange words are different from the story\./);
  assert.match(content("transcript"), /Sometimes the computer can make mistakes when listening\./);
  assert.doesNotMatch(content("transcript"), /Reading Accuracy|words per minute|Pronunciation|pronunciation|progress|80%/);
  // The fixture's metrics leave out the story's second "the", so the story cannot be lined up
  // word for word: no story word is marked as not heard by guesswork.
  assert.doesNotMatch(content("transcript"), /result-skipped-word|not heard/);
  assert.match(content("result"), /Reading Accuracy/);
  assert.match(content("result"), /"3 of 4"/);
  assert.match(content("result"), /"61 words per minute"/);
  assert.match(content("result"), /Open Read-Aloud Transcript to see which words were different\./);
  assert.match(content("result"), /Sometimes the computer can make mistakes when listening, especially with names\. If it heard a word wrongly, your real result may be a little higher\./);
  assert.doesNotMatch(content("result"), /What We Heard|The Story|Pronunciation|result-feedback-words|recording-playback/);
  // F6 never says words were "missed" and gives no speed judgement without a benchmark.
  assert.doesNotMatch(content("result"), /missed|slow|fast|good speed|poor/i);
  // F7 stays on the Reading History page; the result page does not embed it.
  assert.equal(find(f.render(), node => node.type === "reading-history"), undefined);
  assert.doesNotMatch(text, /Saved Oral Reading Assessments/);
  // The shared pronunciation check is offered for this English attempt but never started by rendering.
  const once = f.render();
  const check = find(panel("m5-panel-feedback", once), node => node.type === "pronunciation-feedback-panel").props.check;
  assert.equal(check.status, "idle");
  assert.equal(find(panel("m5-panel-accuracy", once), node => node.type === "pronunciation-accuracy-panel").props.check, check);
  assert.equal(find(panel("m5-panel-words", once), node => node.type === "pronunciation-words-panel").props.check, check);
  assert.doesNotMatch(text, /failed|poor|frustration/i);
  // "cat" lines up with the story's "dog": selecting it says what the story says.
  const heardWord = () => find(panel("m5-panel-transcript"), node => node.type === "button" && node.props.className?.includes("result-heard-word"));
  assert.equal(heardWord().props.children[0], "cat");
  assert.equal(heardWord().props["aria-pressed"], false);
  // The tap instruction is a visible info box, shown because orange words exist and can be tapped.
  assert.ok(find(panel("m5-panel-transcript"), node => node.props?.className === "result-info-box"
    && node.props.children === "Tap an orange word to compare it with the story."));
  assert.doesNotMatch(content("transcript"), /The story says/);
  heardWord().props.onClick();
  assert.equal(heardWord().props["aria-pressed"], true);
  assert.match(content("transcript"), /The story says: “dog”\./);
  heardWord().props.onClick();
  assert.doesNotMatch(content("transcript"), /The story says/);
  // F6: some words differed, so the transcript tip and the "may be a little higher" note are shown.
  assert.match(content("result"), /Open Read-Aloud Transcript to see which words were different\./);
  assert.doesNotMatch(content("result"), /every scored word/);
  assert.ok(find(tree, node => node.type === "progress" && node.props.value === 80));
  const questions = find(tree, node => node.type === "a" && node.props.children === "Continue to Questions");
  assert.equal(questions.props.to, "/dashboard/reading-materials/material/comprehension?roomId=room&activityAssignmentId=assignment&oralReadingAttemptId=oral");
  // Independent learners only get the button when a module passage target exists.
  const general = mountResult("general_user", { ...attempt, materialId: null, roomId: null, activityAssignmentId: null, moduleId: "module", passageId: null });
  general.render(); await tick();
  assert.doesNotMatch(JSON.stringify(general.render()), /Continue to Questions/);
  const withPassage = mountResult("general_user", { ...attempt, materialId: null, roomId: null, activityAssignmentId: null, moduleId: "module", passageId: "passage" });
  withPassage.render(); await tick();
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
  assert.match(JSON.stringify(tree), /Reading Complete!/);
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
  assert.doesNotMatch(JSON.stringify(f.render()), /Reading Complete!/);
  await tick();
  const failed = f.render();
  assert.match(JSON.stringify(failed), /Offline/);
  assert.doesNotMatch(JSON.stringify(failed), /Reading Complete!/);
  button(failed, "Retry").props.onClick();
  f.render(); await tick();
  assert.match(JSON.stringify(f.render()), /Reading Complete!/);
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

test("Reading History cards hold no comprehension links; M6 is reached through the reading result", async () => {
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
      savedAttemptOrder: savedAttemptOrder, SavedAssessmentModal: { default: "saved-assessment-modal" },
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
  // F7 has no M6 link at all; "reading feedback comes before questions" above tests Continue to Questions per role.
  for (const role of ["general_user", "student", "admin"]) assert.deepEqual(await links(role), [], role);
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

test("the M5 result shows the existing encouragement as text, without a mascot, and leaving it stops example audio", async () => {
  const played: unknown[][] = [];
  let stopped = 0;
  const speech = { play: async (...args: any[]) => { played.push(args); return true; }, stop() { stopped++; },
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
  // The summary is a neutral completion message, never a judgement that could contradict the result panels.
  const fil = activityLanguage.getActivityText("fil");
  assert.equal(message.props.children, fil.t("You finished your reading activity! Explore your results below to see how you did."));
  assert.ok(find(tree, node => node.type === "h2" && node.props.children === fil.t("Reading Complete!")));
  assert.doesNotMatch(JSON.stringify(find(tree, node => node.type === "header" && node.props.className === "result-feedback-hero")),
    /Wow|Nice job|Good try|practice/);
  // Transcript differences no longer have word buttons in F4, and rendering never plays audio.
  assert.equal(find(tree, node => node.type === "button" && node.props["aria-label"] === "Pakinggan ang pusa"), undefined);
  assert.deepEqual(played, []);
  f.unmount();
  assert.equal(stopped, 1);
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
  // F2: the mascot's bubble shows this question's own clue; the verdict stays in the feedback block.
  assert.equal(mascot().props.placement, "inline");
  assert.equal(mascot().props.mood, "tryAgain");
  assert.equal(mascot().props.message, "Think about it: Look at who the story names first.");
  // Closing the bubble removes the mascot entirely: no "Show the clue again" button is offered.
  assert.equal("reopenLabel" in mascot().props, false, "no clue-reopen button");
  assert.equal(mascot().props.live, true);
  assert.doesNotMatch(mascot().props.message, /incorrect|Ana is named first|Correct answer|try again/i);
  assert.equal(find(tree, node => node.props?.className === "m6-mascot-area").props.children.type, "reading-mascot");
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
  const explanation = answerFeedback.type(answerFeedback.props);
  // Text only: no voice controls anywhere in M6.
  const explanationText = JSON.stringify(explanation);
  for (const shown of ["Correct answer: ", "Ana is named first.", "Evidence from the passage: ", "Ana went to the market."]) {
    assert.ok(explanationText.includes(shown), shown);
  }
  assert.equal(find(explanation, node => node.type === "feedback-speech"), undefined);
  // The clue appears only in the mascot bubble: no separate box, not repeated on the page.
  assert.equal(find(tree, node => node.type?.name === "ScaffoldingPrompt"), undefined);
  assert.equal(find(tree, node => [node.props?.children].flat().some((child: unknown) =>
    typeof child === "string" && child.includes("Look at who the story names first"))), undefined, "no rendered copy outside the mascot");
  assert.equal(find(tree, node => node.type === "feedback-speech"), undefined);
  assert.equal(find(tree, node => node.type === "feedback-speech"), undefined, "no M6 listen buttons");
  // One way forward: Next Question.
  button(f.render(), "Next Question").props.onClick();
  assert.match(JSON.stringify(f.render()), /Where\?/);
  // The mascot never receives scores or answer keys.
  assert.doesNotMatch(JSON.stringify(Object.keys(mascot().props)), /score|correctOptionIndex|summary/i);
});

test("submitting an answer keeps the question on screen: no visible Please wait, one request, feedback only after the server confirms", async () => {
  for (const role of ["student", "general_user", "admin"]) {
    const base = { id: "q", type: "literal", resolved: false, options: ["A", "B", "C", "D"], answerHistory: [] as any[],
      firstOptionIndex: null as number | null, hintUsed: false, hint: null as string | null, questionText: "Who went to the market?" };
    let attempt: any = { id: "m6", materialId: null, status: "in_progress", language: "en", questions: [base, { ...base, id: "q2" }],
      summary: { allResolved: false, byType: { literal: { total: 2 }, inferential: { total: 0 }, critical: { total: 0 } } } };
    const sent: any[] = [];
    let confirm: (value: any) => void = () => {};
    const f = mount("modules/module6/pages/ComprehensionPage.tsx", { attemptId: "m6" }, { comprehensionService: {
      getComprehension: async () => attempt,
      sendComprehensionAction: (_id: string, action: any) => { sent.push(action); return new Promise(resolve => { confirm = resolve; }); },
    } }, role);
    f.render(); await tick();
    find(f.render(), node => node.type === "input" && node.props.value === 0).props.onChange();
    button(f.render(), "Submit answer").props.onClick();
    // While the server is saving: same question, Submit disabled and busy, no visible loading text.
    let tree = f.render();
    assert.match(JSON.stringify(tree), /Who went to the market\?/, `${role}: the question stays visible`);
    const submit = find(tree, item => item.type === "button" && JSON.stringify(item.props.children).includes("Submit answer"));
    assert.equal(submit.props.disabled, true, `${role}: duplicate submissions are blocked`);
    assert.equal(submit.props["aria-busy"], true);
    const status = find(tree, node => node.props?.role === "status" && node.props?.className === "m6-visually-hidden");
    assert.equal(status.props.children, "Please wait…", `${role}: screen readers still hear that it is saving`);
    assert.equal(find(tree, node => node.props?.className === "m6-loading"), undefined, "no visible Please wait message");
    assert.equal(find(tree, node => node.props?.role === "status" && node.props?.className !== "m6-visually-hidden"
      && [node.props?.children].flat().includes("Please wait…")), undefined);
    assert.equal(find(tree, node => node.type?.name === "SubmittedAnswerFeedback" && node.props.question.resolved), undefined,
      `${role}: no feedback before the server confirms`);
    submit.props.onClick(); // a second click while saving sends nothing
    assert.equal(sent.length, 1);
    // The server confirms: feedback appears in the same question interface.
    const answered = { ...base, resolved: true, correctOptionIndex: 0, answerHistory: [{ optionIndex: 0, correct: true }],
      firstOptionIndex: 0, firstAnswerCorrect: true, answerExplanation: "Ana is named first.", supportingEvidence: "Ana went to the market." };
    attempt = { ...attempt, questions: [answered, attempt.questions[1]] };
    confirm({ attempt, outcome: { correct: true, resolved: true, final: true } }); await tick();
    tree = f.render();
    assert.equal(find(tree, node => node.props?.className === "m6-visually-hidden").props.children, "");
    const feedback = find(tree, node => node.type?.name === "SubmittedAnswerFeedback");
    assert.match(JSON.stringify(feedback.type(feedback.props)), /"Correct!"|Correct/);
  }
});

test("a failed answer save shows an error, keeps the selected answer and offers Retry without showing feedback", async () => {
  const base = { id: "q", type: "literal", resolved: false, options: ["A", "B", "C", "D"], answerHistory: [] as any[],
    firstOptionIndex: null as number | null, hintUsed: false, hint: null as string | null, questionText: "Who?" };
  const attempt: any = { id: "m6", materialId: null, status: "in_progress", language: "en", questions: [base],
    summary: { allResolved: false, byType: { literal: { total: 1 }, inferential: { total: 0 }, critical: { total: 0 } } } };
  const f = mount("modules/module6/pages/ComprehensionPage.tsx", { attemptId: "m6" }, { comprehensionService: {
    getComprehension: async () => attempt,
    sendComprehensionAction: async () => { throw new Error("Unable to save. Please retry."); },
  } }, "admin");
  f.render(); await tick();
  find(f.render(), node => node.type === "input" && node.props.value === 2).props.onChange();
  button(f.render(), "Submit answer").props.onClick(); await tick();
  const tree = f.render();
  assert.ok(find(tree, node => node.props?.role === "alert"), "the error is shown");
  assert.ok(button(tree, "Retry saving"), "the same answer can be retried");
  assert.equal(find(tree, node => node.type === "input" && node.props.value === 2).props.checked, true, "the selection is kept");
  assert.equal(find(tree, node => node.type?.name === "SubmittedAnswerFeedback" && node.props.question.resolved), undefined);
  assert.match(JSON.stringify(tree), /Who\?/);
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
  // A correct answer keeps the congratulatory flow: no clue, no reopen button.
  const mascot = find(tree, node => node.type === "reading-mascot");
  assert.equal("reopenLabel" in mascot.props, false);
  assert.doesNotMatch(mascot.props.message, /Pag-isipan Ito/);
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

test("M6 has no voice feature, its mascot is inline, and M5 keeps its audio", () => {
  const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
  const m6 = ["modules/module6/pages/ComprehensionPage.tsx", "modules/module6/services/comprehensionService.ts",
    "modules/module6/components/StoryDrawer.tsx"].map(read).join("\n");
  assert.doesNotMatch(m6, /FeedbackSpeech|feedbackSpeech|getFeedbackSpeech|synthesize|\/api\/tts|new Audio|<audio|speechSynthesis/);
  const page = read("modules/module6/pages/ComprehensionPage.tsx");
  assert.match(page, /<ReadingMascot placement="inline"/);
  assert.doesNotMatch(page, /overlay-left|protectSelector|avoidSelector/);
  // The inline mascot is plain page flow: no portal, no fixed or absolute placement of the dock.
  const mascot = read("components/reading-feedback/ReadingMascot.tsx");
  const inline = mascot.slice(mascot.indexOf('if (placement === "inline")'), mascot.indexOf("const popup = visible"));
  assert.doesNotMatch(inline, /createPortal|style\.|position/);
  const css = read("components/reading-feedback/ReadingFeedback.css");
  assert.match(css, /\.reading-mascot-dock--inline \{\s*position: static;/);
  // M5 keeps the learner's recording and the F4 example words (Philippine voice); F2 has no feedback text-to-speech.
  const result = read("pages/reading-activity/ReadingResultPage.tsx");
  assert.doesNotMatch(result, /<FeedbackSpeechControls /);
  assert.match(result, /<RecordingPlayback /);
  assert.match(read("modules/module5/components/PronunciationFeedback.tsx"), /speech\.play\(word, "en", undefined, "american"\)/);
});

test("F5/F6 when every scored word matched: no tap instruction or legend, and wording that matches the result", async () => {
  const attempt = { id: "oral", userId: "reader", moduleId: "module", language: "en", moduleTitle: "Seeds",
    pronunciationAccuracy: 100, readingSpeedWpm: 101.2, expectedWordCount: 3, transcript: "Seeds need water", passageSnapshot: "Seeds need water.",
    wordMetrics: [{ type: "match", expected: "seeds", actual: "seeds" }, { type: "match", expected: "need", actual: "need" },
      { type: "match", expected: "water", actual: "water" }] };
  const f = mount("pages/reading-activity/ReadingResultPage.tsx", { attemptId: "oral" }, {
    oralReadingService: { getOralReadingAttempt: async () => attempt },
    oralReadingProcessing: { getWordsToPractice: () => [] }, diagnosticTts: {},
    comprehensionNavigation: { comprehensionTargetForReading },
    useAuthenticatedProfile: { default: () => ({ profile: { id: "reader", nickname: "Ana" } }) },
  });
  f.render(); await tick();
  const tree = f.render();
  const content = (id: string) => JSON.stringify(find(tree, node => node.props?.id === `m5-panel-${id}`));
  assert.doesNotMatch(content("transcript"), /result-info-box|Tap an orange word|Orange words are different|result-heard-word/);
  assert.match(content("result"), /We heard every scored word of the story! Great reading!/);
  assert.match(content("result"), /"3 of 3"/);
  assert.match(content("result"), /"101 words per minute"/);
  assert.doesNotMatch(content("result"), /Open Read-Aloud Transcript|a little higher|almost every word/);
  assert.match(content("result"), /"Sometimes the computer can make mistakes when listening\."/);
  // Only F2 may start a check, and only while it is the open panel (none is open here).
  const f2 = find(find(tree, node => node.props?.id === "m5-panel-feedback"), node => node.type === "pronunciation-feedback-panel");
  assert.equal(f2.props.autoStart, false);
});

// --- M5 result <-> completed M6 result navigation -----------------------------------------------

const READING = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SECOND_READING = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const savedReading = (overrides: Record<string, unknown> = {}) => ({ id: READING, materialId: "material", roomId: "room",
  activityAssignmentId: "assignment", moduleId: null, passageId: null, language: "en", moduleTitle: "Story", readAloudOnly: false,
  pronunciationAccuracy: 80, readingSpeedWpm: 60, expectedWordCount: 1, transcript: "dog", passageSnapshot: "dog",
  wordMetrics: [{ type: "match", expected: "dog", actual: "dog" }], ...overrides });
const NEXT_LABELS = ["Continue to Questions", "View Comprehension Result", "Magpatuloy sa mga Tanong", "Tingnan ang Resulta sa Pag-unawa"];
async function readingResult(role: string, reading: any, extra: Record<string, unknown> = {}) {
  const mocks: Record<string, any> = { oralReadingService: { getOralReadingAttempt: async () => reading },
    oralReadingProcessing: { getWordsToPractice: () => [] }, diagnosticTts: {},
    useAuthenticatedProfile: { default: () => ({ profile: { nickname: "Ana" } }) }, ...extra };
  const f = mount("pages/reading-activity/ReadingResultPage.tsx", { attemptId: reading.id }, mocks, role);
  f.render(); await tick();
  const checking = JSON.stringify(f.render());
  await tick();
  const tree = f.render();
  const next = find(tree, node => node.type === "a" && NEXT_LABELS.includes(node.props.children));
  return { f, mocks, checking, tree, next };
}

test("M5 result: no M6 activity or one in progress keeps Continue to Questions; a completed one opens its saved result", async () => {
  const start = "/dashboard/reading-materials/material/comprehension?roomId=room&activityAssignmentId=assignment&oralReadingAttemptId=" + READING;
  const none = await readingResult("student", savedReading());
  assert.match(none.checking, /Checking your questions…/, "no button is offered until the saved status is known");
  assert.doesNotMatch(none.checking, /Continue to Questions|View Comprehension Result/);
  assert.deepEqual([none.next.props.children, none.next.props.to], ["Continue to Questions", start]);
  assert.deepEqual(none.mocks.comprehensionLookups, [READING], "the lookup uses this exact saved reading");

  const inProgress = await readingResult("student", savedReading(), { linkedComprehension: { id: "m6-open", status: "in_progress" } });
  assert.deepEqual([inProgress.next.props.children, inProgress.next.props.to], ["Continue to Questions", start], "resume keeps the existing path");

  const done = await readingResult("student", savedReading(), { linkedComprehension: { id: "m6-done", status: "completed" } });
  assert.deepEqual([done.next.props.children, done.next.props.to], ["View Comprehension Result", "/dashboard/comprehension/m6-done/results"]);
  assert.doesNotMatch(JSON.stringify(done.tree), /Continue to Questions/);

  // Independent Learner: module reading, results on the activity page.
  const module = { materialId: null, roomId: null, activityAssignmentId: null, moduleId: "module", passageId: "passage" };
  const general = await readingResult("general_user", savedReading(module), { linkedComprehension: { id: "m6-il", status: "completed" } });
  assert.deepEqual([general.next.props.children, general.next.props.to], ["View Comprehension Result", "/m3/general/comprehension/m6-il"]);
  const generalNew = await readingResult("general_user", savedReading(module));
  assert.equal(generalNew.next.props.children, "Continue to Questions");
  assert.match(generalNew.next.props.to, /^\/m3\/general\/modules\/module\/comprehension\?passageId=passage&oralReadingAttemptId=/);

  // Filipino wording.
  const fil = await readingResult("student", savedReading({ language: "fil" }), { linkedComprehension: { id: "m6-fil", status: "completed" } });
  assert.equal(fil.next.props.children, "Tingnan ang Resulta sa Pag-unawa");
});

test("M5 result: each reading of the same passage uses its own M6 activity, and a reload asks the server again", async () => {
  const byReading = (id: string) => (id === READING ? { id: "m6-first", status: "completed" } : null);
  const first = await readingResult("student", savedReading(), { linkedComprehension: byReading });
  const second = await readingResult("student", savedReading({ id: SECOND_READING }), { linkedComprehension: byReading });
  assert.equal(first.next.props.to, "/dashboard/comprehension/m6-first/results");
  assert.equal(second.next.props.children, "Continue to Questions");
  assert.match(second.next.props.to, new RegExp(`oralReadingAttemptId=${SECOND_READING}$`));
  // A new page load (refresh or signing in again) reads the saved status again; nothing is kept in the browser.
  const reopened = await readingResult("student", savedReading(), { linkedComprehension: byReading });
  assert.deepEqual(reopened.mocks.comprehensionLookups, [READING]);
  assert.equal(reopened.next.props.children, "View Comprehension Result");
});

test("M5 result: a failed status check falls back to Continue to Questions; no lookup without an M6 path", async () => {
  const failed = await readingResult("student", savedReading(), { linkedComprehensionError: true });
  assert.equal(failed.next.props.children, "Continue to Questions", "the start path reopens a saved activity, never a duplicate");
  const cases: [string, any][] = [["admin", savedReading()], ["student", savedReading({ readAloudOnly: true })],
    ["general_user", savedReading({ materialId: null, roomId: null, activityAssignmentId: null, moduleId: "module", passageId: null })]];
  for (const [role, reading] of cases) {
    const page = await readingResult(role, reading);
    assert.equal(page.mocks.comprehensionLookups, undefined, `${role}: no M6 activity can exist, so nothing is checked`);
    assert.doesNotMatch(JSON.stringify(page.tree), /Checking your questions|View Comprehension Result|Continue to Questions/);
  }
});

const completedM6 = (overrides: Record<string, unknown> = {}) => ({ id: "m6", status: "completed", language: "en",
  materialId: "material", roomId: "room", activityAssignmentId: "assignment", moduleId: null, passageId: null, oralReadingAttemptId: READING,
  summary: { totalQuestions: 1, firstCorrect: 1, hintsUsed: 0, firstAttemptPercentage: 100, allResolved: true,
    byType: { literal: { total: 1, firstCorrect: 1, firstAttemptPercentage: 100 }, inferential: { total: 0 }, critical: { total: 0 } } },
  questions: [{ id: "q1", type: "literal", resolved: true, options: ["A", "B"], answerHistory: [], firstOptionIndex: 0, firstAnswerCorrect: true,
    questionText: "Who?", correctOptionIndex: 0 }], ...overrides });
function linksIn(node: any, found: [unknown, unknown][] = []): [unknown, unknown][] {
  if (!node || typeof node !== "object") return found;
  if (Array.isArray(node)) { node.forEach((child) => linksIn(child, found)); return found; }
  if (node.type === "a") found.push([node.props.children, node.props.to]);
  linksIn(node.props?.children, found);
  return found;
}
async function resultsPage(role: string, attempt: any) {
  const calls: string[] = [];
  const f = mount("modules/module6/pages/ComprehensionPage.tsx", { attemptId: "m6" }, { comprehensionService: {
    getComprehension: async () => attempt,
    startComprehension: async () => { calls.push("start"); throw Error("must not start"); },
    sendComprehensionAction: async () => { calls.push("action"); throw Error("must not change"); },
  } }, role);
  f.render(); await tick();
  const tree = f.render();
  const nav = find(tree, node => node.type === "nav" && node.props.className === "m6-actions m6-result-actions") ?? null;
  return { f, tree, nav, buttons: nav ? linksIn(nav) : [], calls };
}

test("M6 results: both ways back, at the end of the results card, using the saved links", async () => {
  // Student, assigned story in a Learning Room.
  const assigned = await resultsPage("student", completedM6());
  assert.deepEqual(assigned.buttons, [["Back to Reading Result", `/dashboard/read-aloud/results/${READING}`],
    ["Back to Learning Room", "/dashboard/learning-rooms/room"]]);
  const card = find(assigned.tree, node => node.type === "section" && node.props.className === "m6-card");
  const children = [card.props.children].flat(Infinity).filter(Boolean);
  assert.equal(children.at(-1).type, "nav", "the buttons are the last thing in the results card");
  // Student, module in a room; and a module from My Materials.
  const roomModule = await resultsPage("student", completedM6({ materialId: null, activityAssignmentId: null, moduleId: "module", passageId: "passage" }));
  assert.deepEqual(roomModule.buttons[1], ["Back to Learning Room", "/dashboard/learning-rooms/room"]);
  const ownModule = await resultsPage("student", completedM6({ materialId: null, roomId: null, activityAssignmentId: null, moduleId: "module", passageId: "passage" }));
  assert.deepEqual(ownModule.buttons, [["Back to Reading Result", `/dashboard/read-aloud/results/${READING}`],
    ["Back to Reading Module", "/dashboard/materials/module?passageId=passage"]]);
  // Independent Learner: no Learning Rooms, so the reading's module.
  const general = await resultsPage("general_user", completedM6({ materialId: null, roomId: null, activityAssignmentId: null, moduleId: "module", passageId: "passage" }));
  assert.deepEqual(general.buttons, [["Back to Reading Result", `/m3/general/read-aloud/results/${READING}`],
    ["Back to Reading Module", "/m3/general/modules/module?passageId=passage"]]);
  // Opening saved results starts or changes nothing.
  for (const page of [assigned, roomModule, ownModule, general]) assert.deepEqual(page.calls, []);
  // Completed results have no top back link (it duplicated the buttons); the heading comes first.
  for (const page of [assigned, roomModule, ownModule, general]) {
    assert.equal(find(page.tree, node => node.props?.className === "m6-activity-toolbar"), undefined);
    assert.equal(find(page.tree, node => node.props?.className === "m6-back-button"), undefined);
    const main = find(page.tree, node => node.type === "main");
    assert.equal([main.props.children].flat(Infinity).filter(Boolean)[0].type, "h1");
  }
});

test("M6 results: a missing or invalid reading link shows a note instead of a wrong reading", async () => {
  for (const link of [null, undefined, "", "not-a-reading-id", "../../admin"]) {
    const page = await resultsPage("student", completedM6({ oralReadingAttemptId: link }));
    assert.deepEqual(page.buttons, [["Back to Learning Room", "/dashboard/learning-rooms/room"]], String(link));
    assert.match(JSON.stringify(page.nav), /The reading result for these answers is not available\./);
    assert.doesNotMatch(JSON.stringify(page.tree), /read-aloud\/results/);
  }
});

test("M6 results: Filipino wording, and no navigation buttons while questions are still open", async () => {
  const fil = await resultsPage("student", completedM6({ language: "fil" }));
  assert.deepEqual(fil.buttons.map(([label]) => label), ["Bumalik sa Resulta ng Pagbasa", "Bumalik sa Silid-Aralan"]);
  const open = await resultsPage("general_user", completedM6({ status: "in_progress", materialId: null, roomId: null, activityAssignmentId: null,
    moduleId: "module", passageId: "passage", summary: { ...completedM6().summary, allResolved: false },
    questions: [{ ...completedM6().questions[0], resolved: false, firstOptionIndex: null, firstAnswerCorrect: null }] }));
  assert.equal(open.nav, null);
});

test("M6 results: the mascot keeps its completion message and dismiss button, at the lower left, never a strip above the results", async () => {
  const page = await resultsPage("student", completedM6());
  const main = find(page.tree, node => node.type === "main");
  assert.match(main.props.className, /\bm6-page--results\b/);
  assert.doesNotMatch(main.props.className, /m6-page--questions/);
  const mascot = find(page.tree, node => node.type === "reading-mascot");
  assert.deepEqual([mascot.props.placement, mascot.props.mood, mascot.props.eventId], ["inline", "celebrate", "m6:completed"]);
  const mascotSource = readFileSync(new URL("../src/components/reading-feedback/ReadingMascot.tsx", import.meta.url), "utf8");
  assert.match(mascotSource, /className="reading-mascot-close" aria-label=\{t\("Close"\)\}/, "the X is unchanged");
  const css = readFileSync(new URL("../src/modules/module6/pages/ComprehensionPage.css", import.meta.url), "utf8");
  for (const [width, page] of [["1040px", ".m6-page--assigned.m6-page--results"], ["1300px", ".m6-page--results"]]) {
    const start = css.indexOf(`@container m6-results-shell (min-width: ${width}) {`);
    assert.ok(start > 0, width);
    const wide = css.slice(start, css.indexOf("@container", start + 1));
    assert.ok(wide.includes(`${page} .m6-stage > .m6-mascot-area {`), width);
  assert.match(wide, /right: calc\(100% - 14px\);/, "a slight overlap with the card's outer edge only");
  assert.match(wide, /width: min\(280px, calc\(\(100cqw - 100%\) \/ 2 \+ 6px\)\);/, "never wider than the green area beside the card");
  // Lower left, as in the question flow: the helper sits at the bottom of the visible area.
  assert.match(wide, /justify-content: flex-end;/);
  assert.match(wide, /position: sticky; bottom: 12px;/);
  assert.doesNotMatch(wide, /top: 16px/);
  }
  // Narrower areas: at the lower left just after the card (never above it, never over it).
  const narrow = css.slice(css.indexOf("/* Completed results: the mascot is never a strip above the card."), css.indexOf("@container m6-results-shell"));
  const rule = narrow.slice(narrow.indexOf(".m6-page--results .m6-stage > .m6-mascot-area {"), narrow.indexOf("}", narrow.indexOf(".m6-page--results .m6-stage > .m6-mascot-area {")));
  for (const declaration of ["order: 1;", "justify-self: start;"]) assert.ok(rule.includes(declaration), declaration);
  assert.doesNotMatch(rule, /position: (sticky|fixed|absolute)/, "never floats over the full-width card");
  // Closing it leaves nothing behind: an empty mascot area is hidden.
  assert.match(css, /\.m6-page \.m6-stage > \.m6-mascot-area:empty \{ display: none; \}/);
  // The question page layout is untouched.
  assert.match(css, /@container m6-shell \(min-width: 940px\) \{/);
});

// --- M6 introduction: one assessment per learning activity --------------------------------------------

test("M6 introduction labels follow the server's saved state for the reading's activity, for Admin and Independent Learner", async () => {
  for (const role of ["admin", "general_user"] as const) {
    const base = role === "admin" ? "/admin/comprehension" : "/m3/general/comprehension";
    const intro = (lookup: () => Promise<unknown>, starts: unknown[]) => mount("modules/module6/pages/ComprehensionPage.tsx", { moduleId: "module" }, {
      searchParams: { passageId: "passage", oralReadingAttemptId: READING, roomId: "", activityAssignmentId: "" },
      comprehensionService: { getComprehensionForReading: lookup, startComprehension: async (input: unknown) => { starts.push(input); return {}; } },
    }, role);
    const labels = (tree: any): string[] => JSON.stringify(tree).match(/Start Comprehension|Continue Comprehension|View Comprehension Results|Start or reopen|Retry comprehension|Open Comprehension/g) ?? [];

    // While checking: no button at all.
    let release: (value: unknown) => void = () => {};
    const starts: unknown[] = [];
    const checking = intro(() => new Promise(resolve => { release = resolve; }), starts);
    checking.render(); await tick();
    assert.deepEqual(labels(checking.render()), [], `${role}: nothing to press until the server answers`);
    assert.match(JSON.stringify(checking.render()), /Checking your questions…/);
    release(null); await tick();
    assert.deepEqual(labels(checking.render()), ["Start Comprehension"], `${role}: no assessment yet`);

    // Unfinished: Continue Comprehension opens that same attempt; nothing is started.
    const open = intro(async () => ({ id: "m6-open", status: "in_progress" }), starts);
    open.render(); await tick();
    assert.deepEqual(labels(open.render()), ["Continue Comprehension"]);
    button(open.render(), "Continue Comprehension").props.onClick();
    assert.deepEqual(open.navigations, [`${base}/m6-open`]);

    // Completed: only View Comprehension Results, to the saved read-only result; never Start/Retry.
    const done = intro(async () => ({ id: "m6-done", status: "completed" }), starts);
    done.render(); await tick();
    assert.deepEqual(labels(done.render()), ["View Comprehension Results"], `${role}: a completed assessment is never offered again`);
    button(done.render(), "View Comprehension Results").props.onClick();
    assert.deepEqual(done.navigations, [`${base}/m6-done`]);
    assert.deepEqual(starts, [], "Continue and View never send a start request");

    // The check fails: a way to check again, never a start button.
    let fail = true;
    const failed = intro(async () => { if (fail) throw Error("offline"); return { id: "m6-done", status: "completed" }; }, starts);
    failed.render(); await tick();
    assert.deepEqual(labels(failed.render()), []);
    fail = false;
    button(failed.render(), "Check again").props.onClick(); failed.render(); await tick();
    assert.deepEqual(labels(failed.render()), ["View Comprehension Results"]);
  }
});

test("an extra attempt saved before the one-assessment rule opens the activity's assessment instead", async () => {
  const page = mount("modules/module6/pages/ComprehensionPage.tsx", { attemptId: "m6-extra" }, { comprehensionService: {
    getComprehension: async () => ({ ...ilAttempt("in_progress"), id: "m6-extra", activityAttemptId: "m6-first" }),
  } }, "admin");
  page.render(); await tick();
  assert.deepEqual(page.navigations, ["/admin/comprehension/m6-first"]);
  assert.equal(find(page.render(), node => node.type === "fieldset"), undefined, "the extra attempt is never shown for answering");
  // A completed extra attempt (a saved result) stays viewable as it was saved: no redirect.
  const saved = await resultsPage("admin", { ...ilAttempt("completed"), id: "m6", activityAttemptId: "m6-first" } as any);
  assert.deepEqual(saved.calls, []);
  assert.deepEqual(saved.f.navigations, [], "no redirect away from a saved result");
  assert.equal(saved.buttons.length, 2, "its results and ways back are shown");
});

// --- Role-based M6 workflow ------------------------------------------------------------------------

const ilQuestions = (resolved: boolean) => (["literal", "inferential", "critical"] as const).map((type, index) => ({
  id: `q${index}`, type, questionText: `${type}?`, options: ["A", "B", "C", "D"], answerHistory: [],
  resolved, firstOptionIndex: resolved ? 0 : null, firstAnswerCorrect: resolved ? index !== 2 : null, correctOptionIndex: resolved ? 0 : null }));
const ilAttempt = (status: "in_progress" | "completed", resolved = status === "completed") => ({
  id: "m6-il", status, language: "en", materialId: null, roomId: null, activityAssignmentId: null, moduleId: "module", passageId: "passage",
  oralReadingAttemptId: READING, questions: ilQuestions(resolved),
  summary: { totalQuestions: 3, firstCorrect: resolved ? 2 : 0, hintsUsed: 0, firstAttemptPercentage: resolved ? 67 : 0, allResolved: resolved,
    byType: { literal: { total: 1, firstCorrect: resolved ? 1 : 0, firstAttemptPercentage: 100 },
      inferential: { total: 1, firstCorrect: resolved ? 1 : 0, firstAttemptPercentage: 100 }, critical: { total: 1, firstCorrect: 0, firstAttemptPercentage: 0 } } } });

test("Independent Learner M5 -> M6: starts from its own reading with no classroom, finishes, and returns", async () => {
  // 1. M5 result: Continue to Questions targets this exact reading, with no room or assignment.
  const result = await readingResult("general_user", savedReading({ materialId: null, roomId: null, activityAssignmentId: null, moduleId: "module", passageId: "passage" }));
  const target = new URL(result.next.props.to, "http://x");
  assert.equal(target.pathname, "/m3/general/modules/module/comprehension");
  assert.deepEqual(Object.fromEntries(target.searchParams), { passageId: "passage", oralReadingAttemptId: READING });

  // 2. M6 start: the request carries the module, passage and reading only.
  const inputs: Record<string, unknown>[] = [];
  const start = mount("modules/module6/pages/ComprehensionPage.tsx", { moduleId: "module" }, {
    searchParams: { passageId: "passage", oralReadingAttemptId: READING, roomId: "", activityAssignmentId: "" },
    comprehensionService: { getComprehensionForReading: async () => null, startComprehension: async (input: Record<string, unknown>) => { inputs.push(input); return { ...ilAttempt("in_progress"), language: "en" }; } },
  }, "general_user");
  start.render(); await tick();
  assert.deepEqual(inputs, [], "an Independent Learner starts by choice, never automatically");
  button(start.render(), "Start Comprehension").props.onClick(); await tick();
  assert.equal(inputs.length, 1);
  const sent = JSON.parse(JSON.stringify(inputs[0]));
  assert.ok(sent.submissionId);
  delete sent.submissionId;
  assert.deepEqual(sent, { moduleId: "module", passageId: "passage", oralReadingAttemptId: READING });
  assert.deepEqual(start.navigations, ["/m3/general/comprehension/m6-il"]);

  // 3. All three question types answered: Finish Assessment completes this attempt only.
  const actions: any[] = [];
  let saved: any = ilAttempt("in_progress", true);
  const finish = mount("modules/module6/pages/ComprehensionPage.tsx", { attemptId: "m6-il" }, { comprehensionService: {
    getComprehension: async () => saved,
    startComprehension: async () => { throw Error("must not start again"); },
    sendComprehensionAction: async (id: string, action: any) => { actions.push([id, action]); saved = ilAttempt("completed"); return { attempt: saved, outcome: { completed: true } }; },
  } }, "general_user");
  finish.render(); await tick();
  button(finish.render(), "Finish Assessment").props.onClick(); await tick(); await tick();
  assert.equal(JSON.stringify(actions), JSON.stringify([["m6-il", { action: "complete" }]]));
  const done = finish.render();
  assert.match(JSON.stringify(done), /Your comprehension results/);
  assert.match(JSON.stringify(done), /"67"|67,"%"|\[67/);
  assert.deepEqual(finish.navigations, [], "Independent Learner results show in place; no Student-only route");
  assert.deepEqual(linksIn(find(done, node => node.type === "nav")), [
    ["Back to Reading Result", `/m3/general/read-aloud/results/${READING}`], ["Back to Reading Module", "/m3/general/modules/module?passageId=passage"]]);

  // 4. Back on M5, the completed attempt is recognised; reopening it starts nothing.
  const back = await readingResult("general_user", savedReading({ materialId: null, roomId: null, activityAssignmentId: null, moduleId: "module", passageId: "passage" }),
    { linkedComprehension: { id: "m6-il", status: "completed" } });
  assert.deepEqual([back.next.props.children, back.next.props.to], ["View Comprehension Result", "/m3/general/comprehension/m6-il"]);
  const reopened = await resultsPage("general_user", { ...ilAttempt("completed"), id: "m6" });
  assert.deepEqual(reopened.calls, []);
  assert.equal(reopened.buttons.length, 2);
});

test("Admin M6 routes are Admin-only and reuse the existing comprehension page", () => {
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const adminBlock = app.slice(app.indexOf('<Route element={<RequireRole allowedRoles={["admin"]} />}>'), app.indexOf("{/* Teacher routes */}"));
  for (const route of ['path="oral-reading/modules/:moduleId/comprehension"', 'path="comprehension/:attemptId"']) {
    assert.match(adminBlock, new RegExp(`${route.replace(/[/:]/g, "\\$&")}\\s*element=\\{<ComprehensionPage role="admin" \\/>\\}`), route);
  }
  // No other role's block gains an Admin page. Teachers have M6 only as approved-Teacher practice routes.
  const roles = [...app.matchAll(/<ComprehensionPage role="(\w+)"/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(roles)].sort(), ["admin", "general_user", "student", "system_admin", "teacher"]);
  const teacherBlock = app.slice(app.indexOf("{/* Teacher routes */}"), app.indexOf("{/* Independent learner routes */}"));
  assert.deepEqual([...teacherBlock.matchAll(/path="([^"]+)"\s*element=\{<ComprehensionPage role="(\w+)" \/>\}/g)].map((m) => `${m[1]}|${m[2]}`),
    ["practice/modules/:moduleId/comprehension|teacher", "practice/comprehension/:attemptId|teacher"]);
  assert.equal((teacherBlock.match(/<ComprehensionPage/g) ?? []).length, 2);
  assert.doesNotMatch(adminBlock, /role="teacher"/);
  // Admin practice is never a classroom, assignment or uploaded-material activity.
  for (const reading of [savedReading(), savedReading({ materialId: null, moduleId: "module", passageId: "passage", roomId: "room" }),
    savedReading({ materialId: null, moduleId: "module", passageId: null, roomId: null, activityAssignmentId: null })]) {
    assert.equal(comprehensionTargetForReading("admin", reading), null);
  }
});

test("Admin M5 -> M6: own module reading, finish, results, back to the reading, and reopen without a new activity", async () => {
  const module = { materialId: null, roomId: null, activityAssignmentId: null, moduleId: "module", passageId: "passage" };
  // 1. M5 result: Continue to Questions targets this exact reading on the Admin's practice route.
  const result = await readingResult("admin", savedReading(module));
  assert.deepEqual(result.mocks.comprehensionLookups, [READING], "the saved status is looked up for this reading only");
  const target = new URL(result.next.props.to, "http://x");
  assert.equal(result.next.props.children, "Continue to Questions");
  assert.equal(target.pathname, "/admin/oral-reading/modules/module/comprehension");
  assert.deepEqual(Object.fromEntries(target.searchParams), { passageId: "passage", oralReadingAttemptId: READING });

  // 2. M6 start: by choice, with the module, passage and reading only (never a classroom).
  const inputs: Record<string, unknown>[] = [];
  const adminAttempt = (status: "in_progress" | "completed", resolved?: boolean) => ({ ...ilAttempt(status, resolved), id: "m6-admin" });
  const start = mount("modules/module6/pages/ComprehensionPage.tsx", { moduleId: "module" }, {
    searchParams: { passageId: "passage", oralReadingAttemptId: READING, roomId: "", activityAssignmentId: "" },
    comprehensionService: { getComprehensionForReading: async () => null, startComprehension: async (input: Record<string, unknown>) => { inputs.push(input); return adminAttempt("in_progress"); } },
  }, "admin");
  start.render(); await tick();
  assert.deepEqual(inputs, [], "nothing starts automatically");
  button(start.render(), "Start Comprehension").props.onClick(); await tick();
  const sent = JSON.parse(JSON.stringify(inputs[0]));
  assert.ok(sent.submissionId);
  delete sent.submissionId;
  assert.deepEqual(sent, { moduleId: "module", passageId: "passage", oralReadingAttemptId: READING });
  assert.deepEqual(start.navigations, ["/admin/comprehension/m6-admin"]);

  // 3. Literal, inferential and critical answered: the same page, scoring and Finish Assessment.
  const actions: any[] = [];
  let saved: any = adminAttempt("in_progress", true);
  const finish = mount("modules/module6/pages/ComprehensionPage.tsx", { attemptId: "m6-admin" }, { comprehensionService: {
    getComprehension: async () => saved,
    startComprehension: async () => { throw Error("must not start again"); },
    sendComprehensionAction: async (id: string, action: any) => { actions.push([id, action]); saved = adminAttempt("completed"); return { attempt: saved, outcome: { completed: true } }; },
  } }, "admin");
  finish.render(); await tick();
  assert.deepEqual(["literal", "inferential", "critical"].every((type) => saved.questions.some((q: any) => q.type === type)), true);
  button(finish.render(), "Finish Assessment").props.onClick(); await tick(); await tick();
  assert.equal(JSON.stringify(actions), JSON.stringify([["m6-admin", { action: "complete" }]]));
  const done = finish.render();
  assert.match(JSON.stringify(done), /Your comprehension results/);
  assert.match(JSON.stringify(done), /"67"|67,"%"|\[67/);
  assert.equal(find(done, node => node.props?.className === "m6-activity-toolbar"), undefined, "no duplicate top link on results");
  // 4. Both ways back: the Admin's saved reading and the Admin's Oral Reading page, never a Learning Room.
  assert.deepEqual(linksIn(find(done, node => node.type === "nav")), [
    ["Back to Reading Result", `/admin/read-aloud/results/${READING}`], ["Back to Oral Reading", "/admin/oral-reading"]]);

  // 5. Back on M5: View Comprehension Result reopens the same saved activity; nothing is started or changed.
  const back = await readingResult("admin", savedReading(module), { linkedComprehension: { id: "m6-admin", status: "completed" } });
  assert.deepEqual([back.next.props.children, back.next.props.to], ["View Comprehension Result", "/admin/comprehension/m6-admin"]);
  const reopened = await resultsPage("admin", { ...adminAttempt("completed"), id: "m6" });
  assert.deepEqual(reopened.calls, []);
  assert.deepEqual(reopened.buttons, [["Back to Reading Result", `/admin/read-aloud/results/${READING}`], ["Back to Oral Reading", "/admin/oral-reading"]]);
});

test("Admin M6 on a module the Admin did not create shows the server's refusal and offers the way back", async () => {
  const refused = mount("modules/module6/pages/ComprehensionPage.tsx", { moduleId: "module" }, {
    searchParams: { passageId: "passage", oralReadingAttemptId: READING, roomId: "", activityAssignmentId: "" },
    comprehensionService: { getComprehensionForReading: async () => null, startComprehension: async () => { throw Error("Admin comprehension practice is available only for published modules you created."); } },
  }, "admin");
  refused.render(); await tick();
  button(refused.render(), "Start Comprehension").props.onClick(); await tick();
  const tree = refused.render();
  assert.match(JSON.stringify(find(tree, node => node.props?.role === "alert")), /only for published modules you created/);
  assert.deepEqual(refused.navigations, []);
  const back = find(tree, node => node.type === "button" && node.props.className === "m6-back-button");
  assert.match(JSON.stringify(back.props.children), /Back to Oral Reading/);
  back.props.onClick();
  assert.deepEqual(refused.navigations, ["/admin/oral-reading"]);
});
