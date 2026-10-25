import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { after, beforeEach, test } from "node:test";

// M2 diagnostic and M5 read-aloud share these two Azure speech clients. The real
// modules are loaded; only the axios instance and the session reader are replaced.

type PostCall = { url: string; body: unknown; config: { headers?: Record<string, string>; responseType?: string } };
let posts: PostCall[] = [];
let postReply: () => Promise<unknown>;
let sessionHeaders: () => Promise<Record<string, string>>;

const globals = globalThis as typeof globalThis & {
  __speechApi?: unknown;
  __speechAuth?: (message: string) => Promise<Record<string, string>>;
};
globals.__speechApi = {
  post(url: string, body: unknown, config: PostCall["config"] = {}) {
    posts.push({ url, body, config });
    return postReply();
  },
};
globals.__speechAuth = () => sessionHeaders();

const audioUrl = new URL("../src/modules/module2/services/diagnosticAudio.ts", import.meta.url).href;
const ttsUrl = new URL("../src/modules/module2/services/diagnosticTts.ts", import.meta.url).href;
const errorUrl = new URL("../src/modules/module2/services/diagnosticAudioError.ts", import.meta.url).href;
const speechWavUrl = new URL("../src/modules/module2/services/speechWav.ts", import.meta.url).href;
const fake = (source: string) => `data:text/javascript,${encodeURIComponent(source)}`;

const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  if (context.parentURL === audioUrl || context.parentURL === ttsUrl) {
    if (specifier.endsWith("/services/api")) {
      return { url: fake("export default globalThis.__speechApi;"), shortCircuit: true };
    }
    if (specifier.endsWith("/services/authHeaders")) {
      return { url: fake("export const getSessionAuthHeaders = (message) => globalThis.__speechAuth(message);"), shortCircuit: true };
    }
    if (specifier === "./diagnosticAudioError") return { url: errorUrl, shortCircuit: true };
    if (specifier === "./speechWav") return { url: speechWavUrl, shortCircuit: true };
  }
  return nextResolve(specifier, context);
} });

const { uploadDiagnosticAudio } = await import(audioUrl) as typeof import("../src/modules/module2/services/diagnosticAudio.ts");
const { synthesizeDiagnosticSpeech } = await import(ttsUrl) as typeof import("../src/modules/module2/services/diagnosticTts.ts");
const { DiagnosticAudioUploadError } = await import(errorUrl) as typeof import("../src/modules/module2/services/diagnosticAudioError.ts");
const { getActivityText } = await import(new URL("../src/pages/reading-activity/activityLanguage.ts", import.meta.url).href) as typeof import("../src/pages/reading-activity/activityLanguage.ts");

after(() => {
  hooks.deregister();
  delete globals.__speechApi;
  delete globals.__speechAuth;
});

beforeEach(() => {
  posts = [];
  sessionHeaders = async () => ({ Authorization: "Bearer session.jwt" });
  postReply = async () => ({ data: { success: true, message: "ok", transcription: { text: "isang araw" } } });
});

const segment = () => new Blob(["webm"], { type: "audio/webm;codecs=opus" });
// Browser decoding is unavailable in Node; the converter is replaced by one that
// records its input and returns a WAV part, as convertToSpeechWav does.
let converted: Blob[] = [];
const toWav = async (audio: Blob) => { converted.push(audio); return new Blob(["RIFF"], { type: "audio/wav" }); };

test("M2/M5 transcription uploads send the session bearer token with the English or Filipino part", async () => {
  for (const language of ["en", "fil"] as const) {
    posts = [];
    converted = [];
    const result = await uploadDiagnosticAudio(segment(), language, undefined, toWav);
    assert.equal(result.transcription?.text, "isang araw");
    assert.equal(posts.length, 1);
    assert.equal(posts[0].url, "/api/diagnostic/audio");
    assert.deepEqual(posts[0].config.headers, { Authorization: "Bearer session.jwt" });
    const form = posts[0].body as FormData;
    assert.equal(form.get("language"), language);
    assert.equal((form.get("audio") as File).name, "diagnostic-recording.wav");
    assert.equal((form.get("audio") as File).type, "audio/wav");
    assert.equal(converted.length, 1, "the WebM part is converted to WAV for Azure");
  }
});

test("without a session no upload is attempted and the learner is asked to sign in again", async () => {
  sessionHeaders = async () => { throw new Error("no session"); };
  await assert.rejects(uploadDiagnosticAudio(segment(), "fil", undefined, toWav), (error: unknown) => {
    assert.ok(error instanceof DiagnosticAudioUploadError);
    assert.equal(error.code, "AUTH_REQUIRED");
    assert.equal(error.httpStatus, 401);
    assert.equal(error.message, "Your session has expired. Please sign in again.");
    return true;
  });
  assert.equal(posts.length, 0);
});

test("401, 403, 413 and 429 responses keep their safe server code and message", async () => {
  const replies = [
    [401, "AUTH_REQUIRED", "Your session has expired. Please sign in again."],
    [403, "SPEECH_FORBIDDEN", "Speech practice is not available for this account."],
    [413, "AUDIO_TOO_LARGE", "This part of the recording is too large to process. Please record it again."],
    [429, "SPEECH_RATE_LIMITED", "Too many speech requests. Please wait a few minutes, then try again."],
  ] as const;
  for (const [status, code, message] of replies) {
    postReply = async () => { throw { isAxiosError: true, response: { status, data: { success: false, code, message } } }; };
    await assert.rejects(uploadDiagnosticAudio(segment(), "en", undefined, toWav), (error: unknown) => {
      assert.ok(error instanceof DiagnosticAudioUploadError);
      assert.equal(error.code, code);
      assert.equal(error.httpStatus, status);
      assert.equal(error.message, message);
      return true;
    });
  }
});

test("pronunciation audio requests send the session bearer token and keep the blob response", async () => {
  postReply = async () => ({ data: new Blob(["mp3"], { type: "audio/mpeg" }) });
  for (const language of ["en", "fil"] as const) {
    posts = [];
    const audio = await synthesizeDiagnosticSpeech("bahay", language);
    assert.equal(audio.type, "audio/mpeg");
    assert.equal(posts[0].url, "/api/tts");
    assert.deepEqual(posts[0].body, { text: "bahay", language });
    assert.deepEqual(posts[0].config, { headers: { Authorization: "Bearer session.jwt" }, responseType: "blob" });
  }
});

test("pronunciation audio is not requested without a session", async () => {
  sessionHeaders = async () => { throw new Error("Your session has expired. Please sign in again."); };
  await assert.rejects(synthesizeDiagnosticSpeech("dog", "en"), { message: "Your session has expired. Please sign in again." });
  assert.equal(posts.length, 0);
});

test("new speech access messages are translated on Filipino activity screens", () => {
  const filipino = getActivityText("fil");
  for (const message of [
    "Your session has expired. Please sign in again.",
    "Speech practice is not available for this account.",
    "This part of the recording is too large to process. Please record it again.",
    "Too many speech requests. Please wait a few minutes, then try again.",
    "Speech processing is temporarily unavailable. Please try again later.",
  ]) {
    const translated = filipino.message(new Error(message), "Retry");
    assert.notEqual(translated, message);
    assert.notEqual(translated, filipino.t("Retry"));
  }
});

test("an M2 part longer than the 30 s limit fails clearly instead of uploading trimmed audio", async () => {
  const globalAudio = globalThis as Record<string, unknown>;
  globalAudio.AudioContext = class {
    async decodeAudioData() { return { duration: 40, length: 40 * 48000 }; }
    async close() {}
  };
  globalAudio.OfflineAudioContext = class {};
  try {
    await assert.rejects(uploadDiagnosticAudio(segment(), "fil"), (error: unknown) => {
      assert.ok(error instanceof DiagnosticAudioUploadError);
      assert.equal(error.code, "STT_INVALID_AUDIO");
      assert.equal(error.message, "This part of the recording could not be prepared. Please record it again.");
      return true;
    });
    assert.equal(posts.length, 0, "no partial transcript can be scored");
  } finally {
    delete globalAudio.AudioContext;
    delete globalAudio.OfflineAudioContext;
  }
});
