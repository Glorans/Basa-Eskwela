// M5 Filipino "Listen to {word}": one story word through the real /api/tts route, the real
// M5 reading-practice role check and the real synthesizer, with a fake Speech SDK.
// No Azure, no network beyond 127.0.0.1, no database, no real accounts.
const assert = require("node:assert/strict");
const test = require("node:test");
const { mkdtemp, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const express = require("express");

const { createSpeechRouter } = require("../routes/speech");
const { SupabaseAuthenticationError } = require("../services/supabaseAdmin");
const { authorizeReadingPracticeRequest } = require("../services/oralReadingAttemptService");
const { synthesizeSpeech } = require("../services/azureSpeechService");

const ENV = Object.freeze({ AZURE_SPEECH_KEY: "a".repeat(84), AZURE_SPEECH_REGION: "southeastasia" });

// Token -> synthetic profile. Only the profile lookup is stubbed; the real role rule decides.
const PROFILES = {
  student: { id: "11111111-1111-4111-8111-111111111111", role: "student" },
  learner: { id: "22222222-2222-4222-8222-222222222222", role: "general_user" },
  admin: { id: "33333333-3333-4333-8333-333333333333", role: "admin" },
  teacher: { id: "44444444-4444-4444-8444-444444444444", role: "teacher", teacher_status: "approved" },
  pending: { id: "55555555-5555-4555-8555-555555555555", role: "teacher", teacher_status: "pending" },
  rejected: { id: "66666666-6666-4666-8666-666666666666", role: "teacher", teacher_status: "rejected" },
  norole: { id: "77777777-7777-4777-8777-777777777777", role: null },
};

const authDependencies = {
  prefetchProfile: false,
  async getAuthenticatedSupabaseUser(req) {
    const token = /^Bearer\s+(.+)$/i.exec(req.get("authorization") ?? "")?.[1]?.trim();
    if (!token || !PROFILES[token]) throw new SupabaseAuthenticationError();
    return { id: PROFILES[token].id };
  },
  getSupabaseAdmin: () => ({
    from: () => ({ select: () => ({ eq: (_column, id) => ({ single: async () => {
      const profile = Object.values(PROFILES).find((item) => item.id === id);
      return { data: { id, full_name: "", nickname: null, role: profile.role, teacher_status: profile.teacher_status ?? null }, error: null };
    } }) }) }),
  }),
};

/** Just enough of microsoft-cognitiveservices-speech-sdk 1.52 for synthesis. */
function fakeSdk({ fail = false, failDefault = false } = {}) {
  const synthesizers = [];
  const sdk = {
    ResultReason: { SynthesizingAudioCompleted: 8, Canceled: 1 },
    CancellationErrorCode: { NoError: 0, ServiceError: 6 },
    CancellationDetails: { fromResult: () => ({ errorCode: 6 }) },
    OutputFormat: { Detailed: 1 },
    SpeechSynthesisOutputFormat: { Audio24Khz48KBitRateMonoMp3: "mp3" },
    SpeechRecognizer: { enableTelemetry() {} },
    SpeechConfig: { fromSubscription: () => ({ setProperty() {} }) },
    SpeechSynthesizer: class {
      constructor(config) { this.config = config; synthesizers.push(this); }
      speakSsmlAsync(ssml, ok) { this.ssml = ssml; setImmediate(() => ok(fail ? { reason: 1 } : { reason: 8, audioData: Uint8Array.from([0xff, 0xf3, 7]).buffer })); }
      speakTextAsync(text, ok) { this.text = text; setImmediate(() => ok(failDefault ? { reason: 1 } : { reason: 8, audioData: Uint8Array.from([0xff, 0xf3, 8]).buffer })); }
      close(ok) { ok?.(); }
    },
  };
  return { sdk, synthesizers };
}

async function start(t, { fail = false, failDefault = false } = {}) {
  const uploadDirectory = await mkdtemp(path.join(tmpdir(), "m5-word-tts-"));
  const fake = fakeSdk({ fail, failDefault });
  const calls = [];
  const logs = [];
  const router = createSpeechRouter({
    uploadDirectory,
    authorizeReadAloud: (req) => authorizeReadingPracticeRequest(req, authDependencies),
    authorize: (req) => authorizeReadingPracticeRequest(req, authDependencies),
    // The real synthesizer, with the fake SDK in place of Azure.
    synthesize: (text, languageCode, options) => {
      calls.push({ text, languageCode, ...options });
      return synthesizeSpeech(text, languageCode, { ...options, sdkFactory: () => fake.sdk, env: ENV, log: () => {} });
    },
    receipts: { record: async () => null },
    log: (...entry) => logs.push(entry),
  });
  const app = express().use(express.json()).use(router);
  const server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); await rm(uploadDirectory, { recursive: true, force: true }); });
  const post = (token, body) => fetch(`http://127.0.0.1:${server.address().port}/api/tts`, {
    method: "POST",
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { post, calls, logs, synthesizers: fake.synthesizers };
}

// Exactly what the "Listen to {word}" button sends (diagnosticTts.ts).
const WORD = { text: "Araw-araw", language: "fil", voiceProfile: "philippine" };

test("every reading-practice role hears the story word in fil-PH-BlessicaNeural (Student, Independent Learner, Admin, approved Teacher)", async (t) => {
  const server = await start(t);
  for (const token of ["student", "learner", "admin", "teacher"]) {
    const response = await server.post(token, WORD);
    assert.equal(response.status, 200, token);
    assert.equal(response.headers.get("content-type"), "audio/mpeg");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [0xff, 0xf3, 7]);
  }
  assert.deepEqual(server.calls, Array(4).fill({ text: "Araw-araw", languageCode: "fil-PH", voiceProfile: "philippine" }));
  for (const synth of server.synthesizers) {
    assert.equal(synth.config.speechSynthesisVoiceName, "fil-PH-BlessicaNeural");
    assert.equal(synth.ssml, '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="fil-PH">'
      + '<voice name="fil-PH-BlessicaNeural"><prosody rate="-10%">Araw-araw</prosody></voice></speak>');
  }
});

test("unauthorised requests are refused before any synthesis", async (t) => {
  const server = await start(t);
  assert.equal((await server.post(undefined, WORD)).status, 401, "no token");
  assert.equal((await server.post("not-a-token", WORD)).status, 401, "invalid token");
  for (const token of ["pending", "rejected", "norole"]) assert.equal((await server.post(token, WORD)).status, 403, token);
  assert.deepEqual(server.calls, []);
  assert.equal(server.synthesizers.length, 0);
});

test("accented and quoted story words are escaped, not altered", async (t) => {
  const server = await start(t);
  assert.equal((await server.post("student", { ...WORD, text: "bátà" })).status, 200);
  assert.equal((await server.post("student", { ...WORD, text: "Ito'y" })).status, 200);
  assert.match(server.synthesizers[0].ssml, /<prosody rate="-10%">bátà<\/prosody>/);
  assert.match(server.synthesizers[1].ssml, /<prosody rate="-10%">Ito&apos;y<\/prosody>/);
});

test("an unusable Philippine voice falls back once to the configured fil-PH voice, as for all M5 feedback", async (t) => {
  const server = await start(t, { fail: true });
  const response = await server.post("student", WORD);
  assert.equal(response.status, 200);
  assert.deepEqual(server.calls, [{ text: "Araw-araw", languageCode: "fil-PH", voiceProfile: "philippine" }, { text: "Araw-araw", languageCode: "fil-PH" }]);
  assert.equal(server.synthesizers[1].config.speechSynthesisVoiceName, "fil-PH-BlessicaNeural");
  assert.equal(server.synthesizers[1].text, "Araw-araw");
});

test("a provider failure is a safe 500 without the word in the log, so the button can show its error", async (t) => {
  const server = await start(t, { fail: true, failDefault: true });
  const response = await server.post("student", WORD);
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { success: false, message: "Unable to generate pronunciation audio. Please try again." });
  assert.equal(server.calls.length, 2, "one fallback, no retry loop");
  assert.doesNotMatch(JSON.stringify(server.logs), /Araw-araw/);
});

test("the existing limits still apply to a word request", async (t) => {
  const server = await start(t);
  assert.equal((await server.post("student", { ...WORD, text: "   " })).status, 400);
  assert.equal((await server.post("student", { ...WORD, text: "a".repeat(1001) })).status, 400);
  assert.equal((await server.post("student", { ...WORD, voiceProfile: "american" })).status, 400, "American voice is English only");
  assert.equal((await server.post("student", { ...WORD, language: "tl" })).status, 400);
  assert.deepEqual(server.calls, []);
});
