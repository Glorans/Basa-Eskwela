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
        effects.push(() => { previous?.cleanup?.(); slots[index] = { deps, cleanup: callback() }; });
      }
    },
  };
  const module = { exports: {} as any };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, {
    module, exports: module.exports, Error, URLSearchParams, crypto: { randomUUID: () => "submission" },
    window: { setInterval: () => 1, clearInterval() {}, location: { reload() {} } },
    require: (id: string) => {
      if (id === "react") return react;
      if (id.endsWith("/activityLanguage")) return activityLanguage;
      if (id === "react-router-dom") return { Link: "a", useParams: () => params, useLocation: () => ({ state: mocks.locationState }),
        useSearchParams: () => [new URLSearchParams({ roomId: "room", activityAssignmentId: "assignment", oralReadingAttemptId: "oral", ...mocks.searchParams })],
        useNavigate: () => (target: string) => navigations.push(target) };
      for (const [suffix, value] of Object.entries(mocks)) if (id.endsWith(suffix)) return value;
      if (id.endsWith(".css")) return {};
      if (id.includes("ActivityHeader")) return { default: "header" };
      if (id.includes("OralReadingSummary")) return { default: "oral-summary" };
      if (id.includes("RecordingPlayback")) return { default: "recording-playback" };
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
  };
}

async function recordingFixture(options: { saved?: boolean; saveError?: boolean; transcriptionError?: boolean; standalone?: boolean; readAloudOnly?: boolean; statusError?: boolean; viewReading?: boolean; recordingUploadError?: boolean } = {}) {
  let started = 0, stopped = 0, processed = 0;
  const submissions: any[] = [];
  const statusUpdates: any[] = [];
  const uploads: { attemptId: string; segments: Blob[]; afterNavigations: number }[] = [];
  let mounted: { navigations: string[] } | undefined;
  const navigationCount = () => mounted?.navigations.length ?? 0;
  const recorder = {
    audioSegments: [] as Blob[], audioURLs: [] as string[], segmentDurationsSeconds: [] as number[],
    isRecording: false, isStarting: false, isStopping: false, message: "Ready", recordingDurationSeconds: null as number | null,
    resetRecording() { recorder.audioSegments = []; recorder.audioURLs = []; recorder.recordingDurationSeconds = null; },
    async startRecording() { started++; recorder.isRecording = true; },
    stopRecording() {
      stopped++; recorder.isRecording = false; recorder.audioSegments = [new Blob(["one"]), new Blob(["two"])];
      recorder.audioURLs = ["blob:one", "blob:two"]; recorder.segmentDurationsSeconds = [25, 5]; recorder.recordingDurationSeconds = 30;
    },
  };
  const input = { submissionId: "fixed-submission", transcript: "recognized words" };
  const page = mount("pages/reading-activity/ReadAloudPage.tsx", options.standalone ? { moduleId: "module" } : { materialId: "material" }, {
    searchParams: options.viewReading ? { viewReading: "1" } : {},
    classroomService: { updateReadingActivityStatus: async (...args: any[]) => {
      statusUpdates.push(args);
      if (options.statusError && statusUpdates.length === 1) throw Error("Status update failed");
    } },
    useAudioRecorder: { useAudioRecorder: () => recorder },
    useVoiceFollowStoryScroll: { useVoiceFollowStoryScroll: () => ({ onStreamReady() {}, onStreamStopped() {} }) },
    voiceFollow,
    storyDisplay: { storyParagraphs },
    diagnosticAudio: { uploadDiagnosticAudio() {} },
    oralReadingProcessing: { ORAL_READING_SEGMENT_DURATION_SECONDS: 25, ORAL_READING_MAX_RECORDING_SECONDS: 300,
      processOralReading: async () => { processed++; if (options.transcriptionError) throw Error("NO_SPEECH"); return input; } },
    oralReadingService: {
      getOwnOralReadingAttempts: async () => [],
      getAssignedReadingProgress: async () => [{ roomId: "room", materialId: "material", activityAssignmentId: "assignment", oralReadingAttemptId: options.saved ? "oral" : null, readAloudOnly: options.readAloudOnly ?? false }],
      getOralReadingModule: async () => ({ id: null, materialId: "material", activityAssignmentId: "assignment", roomId: "room", passage: "Full teacher assigned passage", language: "en", readAloudOnly: options.readAloudOnly ?? false }),
      createOralReadingAttempt: async (body: any) => {
        submissions.push(body);
        if (options.saveError && submissions.length === 1) throw Error("Network response lost");
        return { id: "oral", moduleId: null, materialId: "material", activityAssignmentId: "assignment", roomId: "room" };
      },
      uploadOralReadingRecording: async (attemptId: string, segments: Blob[]) => {
        uploads.push({ attemptId, segments: [...segments], afterNavigations: navigationCount() });
        if (options.recordingUploadError && uploads.length === 1) throw Error("Recording upload failed");
      },
      RECORDING_UPLOAD_ERROR: "Your result is saved, but recording upload failed. Retry saving the recording before leaving this page.",
    },
    comprehensionNavigation: { comprehensionTargetForReading }, assignedReadingNavigation: { assignedReadingTarget },
  }, options.standalone ? "general_user" : "student");
  mounted = page;
  page.render(); await tick();
  return { ...page, recorder, submissions, statusUpdates, uploads, counts: () => ({ started, stopped, processed }) };
}

test("the saved result's recording is uploaded once, in recorder order, before the feedback opens", async () => {
  const f = await recordingFixture();
  button(f.render(), "Start Recording").props.onClick();
  button(f.render(), "Stop Recording").props.onClick();
  f.render(); f.render(); await tick(); f.render();
  assert.equal(f.uploads.length, 1);
  assert.equal(f.uploads[0].attemptId, "oral");
  assert.deepEqual(await Promise.all(f.uploads[0].segments.map((blob) => blob.text())), ["one", "two"]);
  assert.equal(f.uploads[0].afterNavigations, 0, "upload completes before navigation");
  assert.deepEqual(f.navigations, ["/dashboard/read-aloud/results/oral"]);
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
  const context = { roomId: "room", materialId: "material", activityAssignmentId: "assignment", oralReadingAttemptId: "oral" };
  assert.equal(assignedReadingTarget({ ...context, readAloudOnly: false }), assignedReadingTarget(context));
  assert.equal(assignedReadingTarget({ ...context, readAloudOnly: false }), "/dashboard/read-aloud/results/oral");
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
  assert.match(rendered, /Pronunciation Accuracy/);
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
  assert.ok(find(f.render(), node => node.type === "oral-summary" && node.props.attemptId === "oral"));
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

test("reading feedback comes before questions, in order, with gentle highlights and a link to the exact M6 activity", async () => {
  const attempt = { id: "oral", materialId: "material", roomId: "room", activityAssignmentId: "assignment",
    moduleId: null, language: "en", moduleTitle: "Story", readAloudOnly: false, pronunciationAccuracy: 80,
    readingSpeedWpm: 61.4, expectedWordCount: 4, transcript: "The cat sat mat",
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
  const order = ["Great reading, ", "Nice job! A few words need practice.", "Pronunciation Accuracy", "Words to Practice",
    "What we heard", "Your Reading Result", "Continue to Questions", "Read again", "Back to my activities"];
  order.reduce((last, label) => { const at = text.indexOf(label); assert.ok(at > last, `${label} is out of order`); return at; }, -1);
  assert.match(text, /"Ana"/);
  assert.match(text, /not heard/);
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
