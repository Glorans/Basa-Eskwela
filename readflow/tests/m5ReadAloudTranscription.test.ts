import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { after, afterEach, beforeEach, mock, test } from "node:test";

// The real M5 transcription client is loaded; only the axios instance and the
// session reader are replaced. No request leaves the process.

type PostCall = { url: string; body: FormData; config: { headers?: Record<string, string>; signal?: AbortSignal; onUploadProgress?: unknown } };
let posts: PostCall[] = [];
let postReply: () => Promise<unknown>;
let sessionHeaders: () => Promise<Record<string, string>>;

const globals = globalThis as typeof globalThis & {
  __readAloudApi?: unknown;
  __readAloudAuth?: (message: string) => Promise<Record<string, string>>;
};
globals.__readAloudApi = {
  post(url: string, body: FormData, config: PostCall["config"] = {}) {
    posts.push({ url, body, config });
    return postReply();
  },
};
globals.__readAloudAuth = () => sessionHeaders();

const serviceUrl = new URL("../src/modules/module5/services/oralReadingTranscription.ts", import.meta.url).href;
const errorUrl = new URL("../src/modules/module2/services/diagnosticAudioError.ts", import.meta.url).href;
const speechWavUrl = new URL("../src/modules/module2/services/speechWav.ts", import.meta.url).href;
const fake = (source: string) => `data:text/javascript,${encodeURIComponent(source)}`;

const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  if (context.parentURL === serviceUrl) {
    if (specifier.endsWith("/services/api")) return { url: fake("export default globalThis.__readAloudApi;"), shortCircuit: true };
    if (specifier.endsWith("/services/authHeaders")) {
      return { url: fake("export const getSessionAuthHeaders = (message) => globalThis.__readAloudAuth(message);"), shortCircuit: true };
    }
    if (specifier.endsWith("/diagnosticAudioError")) return { url: errorUrl, shortCircuit: true };
    if (specifier.endsWith("/speechWav")) return { url: speechWavUrl, shortCircuit: true };
  }
  return nextResolve(specifier, context);
} });

const { RECOGNITION_TIMEOUT_MESSAGE, SLOW_UPLOAD_MESSAGE, UPLOAD_STALL_TIMEOUT_MS, assessOralReadingPronunciation, pronunciationTimeoutMs, recognitionTimeoutMs, transcribeOralReadingRecording } = await import(serviceUrl) as typeof import("../src/modules/module5/services/oralReadingTranscription.ts");
const { DiagnosticAudioUploadError } = await import(errorUrl) as typeof import("../src/modules/module2/services/diagnosticAudioError.ts");
const { SpeechWavTooLongError } = await import(speechWavUrl) as typeof import("../src/modules/module2/services/speechWav.ts");

after(() => {
  hooks.deregister();
  delete globals.__readAloudApi;
  delete globals.__readAloudAuth;
});

beforeEach(() => {
  posts = [];
  sessionHeaders = async () => ({ Authorization: "Bearer session.jwt" });
  postReply = async () => ({ data: { success: true, message: "ok", transcription: { text: "Every Saturday Lia helps her lola", confidence: 0.9 } } });
});

const recording = () => new Blob(["whole webm reading"], { type: "audio/webm;codecs=opus" });
const toWav = async () => new Blob(["RIFF whole reading"], { type: "audio/wav" });

test("the whole recording is converted once and sent in one request, in English or Filipino", async () => {
  for (const language of ["en", "fil"] as const) {
    posts = [];
    const converted: Blob[] = [];
    const source = recording();
    const transcription = await transcribeOralReadingRecording(source, language, { recordingDurationSeconds: 40, convert: async (audio: Blob) => { converted.push(audio); return toWav(); } });
    assert.deepEqual(transcription, { text: "Every Saturday Lia helps her lola", confidence: 0.9 });
    assert.deepEqual(converted, [source], "the saved WebM itself is what gets transcribed");
    assert.equal(posts.length, 1);
    assert.equal(posts[0].url, "/api/read-aloud/audio");
    assert.deepEqual(posts[0].config.headers, { Authorization: "Bearer session.jwt" });
    assert.equal(posts[0].body.get("language"), language);
    assert.equal((posts[0].body.get("audio") as File).type, "audio/wav");
    assert.equal(await (posts[0].body.get("audio") as File).text(), "RIFF whole reading");
    assert.deepEqual([...posts[0].body.keys()], ["audio", "language"]);
  }
});

const rejectsWith = (work: Promise<unknown>, code: string) => assert.rejects(work, (error: unknown) => {
  assert.ok(error instanceof DiagnosticAudioUploadError);
  assert.equal(error.code, code);
  return true;
});

test("nothing is uploaded without a session, or when the recording cannot be prepared whole", async () => {
  sessionHeaders = async () => { throw new Error("no session"); };
  await rejectsWith(transcribeOralReadingRecording(recording(), "en", { recordingDurationSeconds: 40, convert: toWav }), "AUTH_REQUIRED");
  sessionHeaders = async () => ({ Authorization: "Bearer session.jwt" });
  await rejectsWith(transcribeOralReadingRecording(recording(), "en", { recordingDurationSeconds: 40, convert: async () => { throw new SpeechWavTooLongError(); } }), "AUDIO_TOO_LONG");
  await rejectsWith(transcribeOralReadingRecording(recording(), "fil", { recordingDurationSeconds: 40, convert: async () => { throw new Error("decode failed"); } }), "STT_INVALID_AUDIO");
  assert.equal(posts.length, 0);
});

test("server and network failures reject with a safe code and never return partial text", async () => {
  postReply = async () => { throw { isAxiosError: true, response: { status: 504, data: { success: false, code: "STT_DEADLINE", message: "Speech processing timed out. Please try again." } } }; };
  await rejectsWith(transcribeOralReadingRecording(recording(), "en", { recordingDurationSeconds: 40, convert: toWav }), "STT_DEADLINE");
  postReply = async () => { throw { isAxiosError: true, code: "ERR_NETWORK" }; };
  await rejectsWith(transcribeOralReadingRecording(recording(), "en", { recordingDurationSeconds: 40, convert: toWav }), "STT_PROVIDER_ERROR");
  postReply = async () => ({ data: { success: true, message: "ok", transcription: { text: "   " } } });
  await rejectsWith(transcribeOralReadingRecording(recording(), "en", { recordingDurationSeconds: 40, convert: toWav }), "NO_SPEECH");
  // A retry sends the same recording again and can succeed.
  postReply = async () => ({ data: { success: true, message: "ok", transcription: { text: "Lia sweeps" } } });
  assert.equal((await transcribeOralReadingRecording(recording(), "en", { recordingDurationSeconds: 40, convert: toWav })).text, "Lia sweeps");
});

// The upload is timed by its progress and Azure by the server deadline. These
// drive a fake request whose upload progress and reply the test controls.
afterEach(() => mock.timers.reset());

type Progress = (event: { loaded: number; total?: number }) => void;
function controlledPost() {
  const state = { progress: undefined as Progress | undefined, signal: undefined as AbortSignal | undefined, reply: undefined as ((value: unknown) => void) | undefined };
  const post = (_form: FormData, config: { signal: AbortSignal; onUploadProgress: Progress }) => new Promise<{ data: any }>((resolve, reject) => {
    state.progress = config.onUploadProgress;
    state.signal = config.signal;
    state.reply = (data) => resolve({ data });
    config.signal.addEventListener("abort", () => reject(Object.assign(new Error("canceled"), { isAxiosError: true, code: "ERR_CANCELED" })));
  });
  return { state, post };
}
const settle = async () => { for (let index = 0; index < 5; index++) await Promise.resolve(); };

test("steps are reported in order: preparing, sending, then processing once the upload completes", async () => {
  const steps: string[] = [];
  const { state, post } = controlledPost();
  const work = transcribeOralReadingRecording(recording(), "fil", { recordingDurationSeconds: 60, convert: toWav, post, onStep: (step) => steps.push(step) });
  await settle();
  assert.deepEqual(steps, ["preparing", "uploading"]);
  state.progress!({ loaded: 5, total: 10 });
  assert.deepEqual(steps, ["preparing", "uploading"]);
  state.progress!({ loaded: 10, total: 10 });
  assert.deepEqual(steps, ["preparing", "uploading", "recognizing"]);
  state.reply!({ success: true, message: "ok", transcription: { text: "Tuwing Sabado" } });
  assert.equal((await work).text, "Tuwing Sabado");
});

test("a slow upload that keeps moving is not cut off; a stalled one is aborted as a slow connection", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const moving = controlledPost();
  const ok = transcribeOralReadingRecording(recording(), "en", { recordingDurationSeconds: 300, convert: toWav, post: moving.post });
  await settle();
  // Ten minutes of slow but steady progress: each event restarts the stall window.
  for (let second = 1; second <= 600; second++) {
    mock.timers.tick(1000);
    moving.state.progress!({ loaded: second, total: 601 });
  }
  assert.equal(moving.state.signal!.aborted, false);
  moving.state.progress!({ loaded: 601, total: 601 });
  moving.state.reply!({ success: true, message: "ok", transcription: { text: "Lia sweeps" } });
  assert.equal((await ok).text, "Lia sweeps");

  const stalled = controlledPost();
  const failed = transcribeOralReadingRecording(recording(), "en", { recordingDurationSeconds: 300, convert: toWav, post: stalled.post });
  await settle();
  stalled.state.progress!({ loaded: 1, total: 100 });
  mock.timers.tick(UPLOAD_STALL_TIMEOUT_MS);
  await assert.rejects(failed, (error: unknown) => {
    assert.ok(error instanceof DiagnosticAudioUploadError);
    assert.equal(error.message, SLOW_UPLOAD_MESSAGE);
    return true;
  });
  assert.equal(stalled.state.signal!.aborted, true, "the stalled upload is cancelled, not left running");
});

test("after the upload, the browser waits for the server deadline, then aborts with a timeout", async () => {
  assert.equal(recognitionTimeoutMs(20), 160_000);
  assert.equal(recognitionTimeoutMs(300), 300_000);
  mock.timers.enable({ apis: ["setTimeout"] });
  const { state, post } = controlledPost();
  const work = transcribeOralReadingRecording(recording(), "en", { recordingDurationSeconds: 300, convert: toWav, post });
  await settle();
  state.progress!({ loaded: 10, total: 10 });
  // Azure needs about 150 s for five minutes of audio: far past the 45 s stall window.
  mock.timers.tick(recognitionTimeoutMs(300) - 1);
  assert.equal(state.signal!.aborted, false);
  mock.timers.tick(1);
  await assert.rejects(work, (error: unknown) => {
    assert.ok(error instanceof DiagnosticAudioUploadError);
    assert.equal(error.code, "STT_DEADLINE");
    assert.equal(error.message, RECOGNITION_TIMEOUT_MESSAGE);
    return true;
  });
  assert.equal(state.signal!.aborted, true);
});

test("leaving the page or starting over aborts the request so it never runs behind a retry", async () => {
  const caller = new AbortController();
  const { state, post } = controlledPost();
  const work = transcribeOralReadingRecording(recording(), "en", { recordingDurationSeconds: 30, convert: toWav, post, signal: caller.signal });
  await settle();
  caller.abort();
  await assert.rejects(work);
  assert.equal(state.signal!.aborted, true);
});

// Pronunciation check of the whole saved recording: one request, same deadline rules.
const wavOfSeconds = (seconds: number) => new Blob([new Uint8Array(44 + seconds * 32000)], { type: "audio/wav" });
function controlledPronunciation() {
  const state = { url: "", form: undefined as FormData | undefined, ...controlledPost().state };
  const post = (attemptId: string, form: FormData, config: { signal: AbortSignal; onUploadProgress: Progress }) => {
    state.url = attemptId;
    state.form = form;
    return new Promise<{ data: any }>((resolve, reject) => {
      state.progress = config.onUploadProgress;
      state.signal = config.signal;
      state.reply = (data) => resolve({ data });
      config.signal.addEventListener("abort", () => reject(Object.assign(new Error("canceled"), { isAxiosError: true, code: "ERR_CANCELED" })));
    });
  };
  return { state, post };
}

test("the pronunciation check sends the whole recording once and waits for its full assessment", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const { state, post } = controlledPronunciation();
  let assessing = 0;
  const work = assessOralReadingPronunciation("attempt-1", wavOfSeconds(36), { post, onAssessing: () => { assessing++; } });
  await settle();
  assert.equal(state.url, "attempt-1");
  assert.deepEqual([...state.form!.keys()], ["audio"], "no reference text is sent from the browser");
  state.progress!({ loaded: 10, total: 10 });
  assert.equal(assessing, 1);
  // A 36 s reading takes Azure about 18 s at twice real time: well past the 45 s stall window is still fine.
  mock.timers.tick(recognitionTimeoutMs(36) - 1);
  assert.equal(state.signal!.aborted, false);
  const summary = { parts: 1, utterances: 3, accuracy: 84, fluency: 77, wordsToPractice: ["orchard"], assessedSeconds: 36, complete: true, unassessedSeconds: 0 };
  state.reply!({ success: true, saved: true, check: { status: "completed", saved: true, checkedAt: "2026-11-05T08:00:00Z", summary } });
  const result = await work;
  assert.deepEqual(result, { summary, saved: true, checkedAt: "2026-11-05T08:00:00Z" });
});

test("several saved files go in one request, in order, with a wait long enough for every file", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const { state, post } = controlledPronunciation();
  const work = assessOralReadingPronunciation("attempt-1", [wavOfSeconds(30), wavOfSeconds(30), wavOfSeconds(30)], { post });
  await settle();
  // The server matches these names against the saved recording's files.
  assert.deepEqual(state.form!.getAll("audio").map((file) => (file as File).name), ["part-0.wav", "part-1.wav", "part-2.wav"]);
  state.progress!({ loaded: 10, total: 10 });
  // One file's deadline would expire here; three files are still being checked.
  mock.timers.tick(recognitionTimeoutMs(90) + 1);
  assert.equal(state.signal!.aborted, false);
  assert.equal(pronunciationTimeoutMs(3, 90), 3 * 150_000 + 45_000);
  mock.timers.tick(pronunciationTimeoutMs(3, 90));
  await assert.rejects(work, (error: unknown) => error instanceof DiagnosticAudioUploadError && error.code === "STT_DEADLINE");
});

test("an unsaved result is never reported as saved", async () => {
  const { state, post } = controlledPronunciation();
  const work = assessOralReadingPronunciation("attempt-1", [wavOfSeconds(10), wavOfSeconds(5)], { post });
  await settle();
  assert.deepEqual([...state.form!.keys()], ["audio", "audio"]);
  const summary = { parts: 2, utterances: 1, accuracy: 70, fluency: 60, wordsToPractice: [], assessedSeconds: 15, complete: true, unassessedSeconds: 0 };
  state.reply!({ success: true, saved: false, code: "PRONUNCIATION_NOT_SAVED",
    message: "Your pronunciation check finished, but its result could not be saved.", check: { saved: false, summary } });
  const result = await work;
  assert.equal(result.saved, false);
  assert.match(result.notice ?? "", /could not be saved/);
});

test("a check already running for the reading is reported as in progress, not as a failure", async () => {
  const post = async () => {
    throw Object.assign(new Error("Request failed"), { isAxiosError: true,
      response: { status: 409, data: { code: "PRONUNCIATION_CHECK_IN_PROGRESS", message: "A pronunciation check for this reading is already running." } } });
  };
  await assert.rejects(assessOralReadingPronunciation("attempt-1", wavOfSeconds(10), { post }),
    (error: unknown) => error instanceof Error && error.name === "PronunciationCheckInProgressError");
});

test("a pronunciation check that runs past the deadline, or is cancelled, is aborted", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const late = controlledPronunciation();
  const timedOut = assessOralReadingPronunciation("attempt-1", wavOfSeconds(60), { post: late.post });
  await settle();
  late.state.progress!({ loaded: 10, total: 10 });
  mock.timers.tick(recognitionTimeoutMs(60));
  await assert.rejects(timedOut, (error: unknown) => error instanceof DiagnosticAudioUploadError && error.code === "STT_DEADLINE");
  assert.equal(late.state.signal!.aborted, true);

  const caller = new AbortController();
  const cancelled = controlledPronunciation();
  const work = assessOralReadingPronunciation("attempt-1", wavOfSeconds(60), { post: cancelled.post, signal: caller.signal });
  await settle();
  caller.abort();
  await assert.rejects(work);
  assert.equal(cancelled.state.signal!.aborted, true);
});

test("a failed pronunciation reply is an error, never an empty result", async () => {
  const { state, post } = controlledPronunciation();
  const work = assessOralReadingPronunciation("attempt-1", wavOfSeconds(10), { post });
  await settle();
  state.reply!({ success: false, code: "STT_QUOTA", message: "Speech services are busy. Please try again later." });
  await assert.rejects(work, /busy/);
});
