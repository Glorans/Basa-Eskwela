const assert = require("node:assert/strict");
const test = require("node:test");
const { mkdtemp, readdir, rm } = require("node:fs/promises");
const { readdirSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const express = require("express");

const { createSpeechRouter, MAX_TTS_TEXT_LENGTH, SPEECH_UPLOAD_LIMITS } = require("../routes/speech");
const { SPEECH_RATE_LIMITS, createRequestLimiter } = require("../services/speechAccess");
const { SupabaseAuthenticationError } = require("../services/supabaseAdmin");
const { authorizeOralReadingPracticeRequest } = require("../services/oralReadingAttemptService");

// Token -> profile. Lookups are stubbed; the real M5 self-practice role rule decides access.
const PROFILES = {
  student: { id: "student-1", role: "student" },
  "student-2": { id: "student-2", role: "student" },
  general: { id: "general-1", role: "general_user" },
  admin: { id: "admin-1", role: "admin" },
  teacher: { id: "teacher-1", role: "teacher", teacher_status: "approved" },
  pending: { id: "teacher-2", role: "teacher", teacher_status: "pending" },
  unassigned: { id: "unassigned-1", role: null },
  "no-profile": { id: "missing-1", role: undefined, missing: true },
};

const authDependencies = {
  async getAuthenticatedSupabaseUser(req) {
    const token = /^Bearer\s+(.+)$/i.exec(req.get("authorization") ?? "")?.[1]?.trim();
    if (!token || !PROFILES[token]) throw new SupabaseAuthenticationError();
    return { id: PROFILES[token].id };
  },
  getSupabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        eq: (_column, id) => ({
          single: async () => {
            const profile = Object.values(PROFILES).find((item) => item.id === id);
            return profile && !profile.missing
              ? { data: { id, full_name: "", nickname: null, role: profile.role }, error: null }
              : { data: null, error: { code: "PGRST116", message: "missing" } };
          },
        }),
      }),
    }),
  }),
};

async function startSpeechServer(options = {}) {
  const uploadDirectory = await mkdtemp(path.join(tmpdir(), "readflow-speech-"));
  const calls = { transcribe: [], synthesize: [], authorizeSawUpload: [] };
  const logs = [];
  const router = createSpeechRouter({
    uploadDirectory,
    authorize: async (req) => {
      // Authorization must finish before multer writes anything.
      calls.authorizeSawUpload.push(readdirSync(uploadDirectory).length > 0 || Boolean(req.file));
      return authorizeOralReadingPracticeRequest(req, authDependencies);
    },
    transcribe: async (file, languageCode) => {
      calls.transcribe.push({ file, languageCode });
      return { text: "isang araw", confidence: 0.9 };
    },
    synthesize: async (text, languageCode, synthesisOptions) => {
      calls.synthesize.push(synthesisOptions ? { text, languageCode, ...synthesisOptions } : { text, languageCode });
      if (synthesisOptions?.voiceProfile && options.philippineVoiceFailure) {
        throw Object.assign(new Error("voice rejected"), { code: options.philippineVoiceFailure });
      }
      if (options.ttsFailure) throw Object.assign(new Error(`provider rejected ${text} Bearer secret-token`), { code: 7 });
      return Buffer.from("mp3-bytes");
    },
    log: (...entry) => logs.push(entry),
    ...options.router,
  });
  const app = express();
  app.use(express.json());
  app.use(router);
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base, calls, logs, uploadDirectory,
    async close() {
      await new Promise((resolve) => server.close(resolve));
      await rm(uploadDirectory, { recursive: true, force: true });
    },
  };
}

function audioForm({ language = "en", bytes = Buffer.from("wav-audio"), extraFields = 0, extraFile = false, type = "audio/wav" } = {}) {
  const form = new FormData();
  form.append("audio", new Blob([bytes], { type }), "part.wav");
  form.append("language", language);
  for (let index = 0; index < extraFields; index++) form.append(`extra${index}`, "x");
  if (extraFile) form.append("audio", new Blob([bytes], { type }), "second.wav");
  return form;
}

const auth = (token) => (token === undefined ? {} : { Authorization: `Bearer ${token}` });

function postAudio(base, token, formOptions) {
  return fetch(`${base}/api/diagnostic/audio`, { method: "POST", headers: auth(token), body: audioForm(formOptions) });
}

function postTts(base, token, body = { text: "aso", language: "fil" }) {
  return fetch(`${base}/api/tts`, {
    method: "POST",
    headers: { ...auth(token), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// The success path removes its temporary file in a finally block after responding.
async function waitForEmptyDirectory(directory) {
  for (let attempt = 0; attempt < 50; attempt++) {
    if ((await readdir(directory)).length === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.deepEqual(await readdir(directory), []);
}

test("speech budgets and upload limits are configured, with no recording-duration limit", () => {
  assert.deepEqual(SPEECH_RATE_LIMITS, {
    stt: { limit: 60, windowMs: 600000 },
    tts: { limit: 100, windowMs: 600000 },
  });
  // Fields: language, plus M2's recordingId and segmentIndex (DT1).
  assert.deepEqual(SPEECH_UPLOAD_LIMITS, { fileSize: 10485760, files: 1, fields: 5, fieldSize: 1024, parts: 6 });
  assert.equal(Object.keys(SPEECH_UPLOAD_LIMITS).some((key) => /duration|second/i.test(key)), false);
});

test("missing or blank tokens are rejected with 401 by the real token check before any upload", async () => {
  const uploadDirectory = await mkdtemp(path.join(tmpdir(), "readflow-speech-default-"));
  let transcribed = false;
  let synthesized = false;
  // Default authorization (no stubs): the bearer token is parsed before Supabase is contacted.
  const app = express();
  app.use(express.json());
  app.use(createSpeechRouter({
    uploadDirectory,
    transcribe: async () => { transcribed = true; return { text: "x" }; },
    synthesize: async () => { synthesized = true; return Buffer.from("x"); },
    log: () => {},
  }));
  const server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const headers of [{}, { Authorization: "Bearer " }, { Authorization: "Basic abc" }]) {
      const audio = await fetch(`${base}/api/diagnostic/audio`, { method: "POST", headers, body: audioForm() });
      assert.equal(audio.status, 401);
      assert.deepEqual(await audio.json(), { success: false, code: "AUTH_REQUIRED", message: "Your session has expired. Please sign in again." });
      const tts = await fetch(`${base}/api/tts`, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ text: "dog", language: "en" }) });
      assert.equal(tts.status, 401);
    }
    assert.equal(transcribed, false);
    assert.equal(synthesized, false);
    assert.deepEqual(await readdir(uploadDirectory), []);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(uploadDirectory, { recursive: true, force: true });
  }
});

test("an invalid token is rejected with 401 and nothing is processed", async () => {
  const speech = await startSpeechServer();
  try {
    assert.equal((await postAudio(speech.base, "forged")).status, 401);
    assert.equal((await postTts(speech.base, "forged")).status, 401);
    assert.deepEqual(speech.calls.transcribe, []);
    assert.deepEqual(speech.calls.synthesize, []);
    assert.deepEqual(await readdir(speech.uploadDirectory), []);
  } finally { await speech.close(); }
});

test("teachers (approved or pending) and accounts without a role receive 403", async () => {
  const speech = await startSpeechServer();
  try {
    for (const token of ["teacher", "pending", "unassigned"]) {
      const audio = await postAudio(speech.base, token);
      assert.equal(audio.status, 403, token);
      assert.equal((await audio.json()).code, "SPEECH_FORBIDDEN");
      assert.equal((await postTts(speech.base, token)).status, 403, token);
    }
    assert.deepEqual(speech.calls.transcribe, []);
    assert.deepEqual(speech.calls.synthesize, []);
    assert.deepEqual(await readdir(speech.uploadDirectory), []);
  } finally { await speech.close(); }
});

test("a profile lookup failure is a safe 503 without processing", async () => {
  const speech = await startSpeechServer();
  try {
    const response = await postAudio(speech.base, "no-profile");
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, "STT_PERMISSION");
    assert.deepEqual(speech.calls.transcribe, []);
    assert.equal(JSON.stringify(speech.logs).includes("no-profile"), false);
  } finally { await speech.close(); }
});

test("students, independent learners and admins transcribe English and Filipino and leave no temporary file", async () => {
  const speech = await startSpeechServer();
  try {
    for (const [token, language, languageCode] of [["student", "en", "en-US"], ["general", "fil", "fil-PH"], ["admin", "en", "en-US"]]) {
      const response = await postAudio(speech.base, token, { language });
      assert.equal(response.status, 200, token);
      const body = await response.json();
      assert.equal(body.success, true);
      assert.equal(body.transcription.text, "isang araw");
      assert.equal(speech.calls.transcribe.at(-1).languageCode, languageCode);
      await waitForEmptyDirectory(speech.uploadDirectory);
    }
    assert.equal(speech.calls.authorizeSawUpload.every((sawUpload) => sawUpload === false), true);
  } finally { await speech.close(); }
});

test("authorized TTS keeps the English and Filipino language mapping and audio response", async () => {
  const speech = await startSpeechServer();
  try {
    for (const [token, language, languageCode] of [["student", "en", "en-US"], ["general", "fil", "fil-PH"], ["admin", "fil", "fil-PH"]]) {
      const response = await postTts(speech.base, token, { text: "  bahay  ", language });
      assert.equal(response.status, 200, token);
      assert.equal(response.headers.get("content-type"), "audio/mpeg");
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(Buffer.from(await response.arrayBuffer()).toString(), "mp3-bytes");
      assert.deepEqual(speech.calls.synthesize.at(-1), { text: "bahay", languageCode });
    }
    // Existing validation still applies after authorization.
    assert.equal((await postTts(speech.base, "student", { text: "x".repeat(MAX_TTS_TEXT_LENGTH + 1), language: "en" })).status, 400);
    assert.equal((await postTts(speech.base, "student", { text: "dog", language: "es" })).status, 400);
  } finally { await speech.close(); }
});

test("M5 feedback may ask for the Philippine voice; other values are rejected before synthesis", async () => {
  const speech = await startSpeechServer();
  try {
    const response = await postTts(speech.base, "general", { text: "Mahusay!", language: "fil", voiceProfile: "philippine" });
    assert.equal(response.status, 200);
    assert.deepEqual(speech.calls.synthesize.at(-1), { text: "Mahusay!", languageCode: "fil-PH", voiceProfile: "philippine" });
    const before = speech.calls.synthesize.length;
    for (const voiceProfile of ["en-US-GuyNeural", "", 1, null]) {
      assert.equal((await postTts(speech.base, "student", { text: "dog", language: "en", voiceProfile })).status, 400, String(voiceProfile));
    }
    assert.equal(speech.calls.synthesize.length, before);
  } finally { await speech.close(); }
});

test("an unusable Philippine voice falls back once to the default voice; quota and permission errors do not", async () => {
  for (const code of ["STT_INVALID_AUDIO", "STT_PROVIDER_ERROR"]) {
    const speech = await startSpeechServer({ philippineVoiceFailure: code });
    try {
      const response = await postTts(speech.base, "student", { text: "Great job", language: "en", voiceProfile: "philippine" });
      assert.equal(response.status, 200, code);
      assert.deepEqual(speech.calls.synthesize, [
        { text: "Great job", languageCode: "en-US", voiceProfile: "philippine" },
        { text: "Great job", languageCode: "en-US" },
      ]);
      assert.match(JSON.stringify(speech.logs), /Philippine feedback voice unavailable/);
      assert.doesNotMatch(JSON.stringify(speech.logs), /Great job/);
    } finally { await speech.close(); }
  }
  for (const code of ["STT_QUOTA", "STT_PERMISSION", "STT_DEADLINE"]) {
    const speech = await startSpeechServer({ philippineVoiceFailure: code });
    try {
      const response = await postTts(speech.base, "student", { text: "Great job", language: "en", voiceProfile: "philippine" });
      assert.equal(response.status, 500, code);
      assert.equal(speech.calls.synthesize.length, 1, `${code}: no second request`);
    } finally { await speech.close(); }
  }
});

test("an oversized recording part returns 413 and leaves no temporary file", async () => {
  const speech = await startSpeechServer();
  try {
    const response = await postAudio(speech.base, "student", { bytes: Buffer.alloc(SPEECH_UPLOAD_LIMITS.fileSize + 1) });
    assert.equal(response.status, 413);
    assert.equal((await response.json()).code, "AUDIO_TOO_LARGE");
    assert.deepEqual(speech.calls.transcribe, []);
    await waitForEmptyDirectory(speech.uploadDirectory);
    // A part exactly at the limit is still accepted.
    assert.equal((await postAudio(speech.base, "student", { bytes: Buffer.alloc(SPEECH_UPLOAD_LIMITS.fileSize) })).status, 200);
    await waitForEmptyDirectory(speech.uploadDirectory);
  } finally { await speech.close(); }
});

test("extra files, extra fields and oversized fields are rejected without transcription", async () => {
  const speech = await startSpeechServer();
  try {
    const twoFiles = await postAudio(speech.base, "student", { extraFile: true });
    assert.equal(twoFiles.status, 400);
    const manyFields = await postAudio(speech.base, "student", { extraFields: 5 });
    assert.equal(manyFields.status, 400);
    const longField = await postAudio(speech.base, "student", { language: "e".repeat(SPEECH_UPLOAD_LIMITS.fieldSize + 1) });
    assert.equal(longField.status, 413);
    assert.deepEqual(speech.calls.transcribe, []);
    await waitForEmptyDirectory(speech.uploadDirectory);
  } finally { await speech.close(); }
});

test("per-user STT and TTS throttling returns 429 with Retry-After and resets after the window", async () => {
  let time = 1_000_000;
  const speech = await startSpeechServer({ router: {
    rateLimits: { stt: { limit: 2, windowMs: 60_000 }, tts: { limit: 1, windowMs: 60_000 } },
    now: () => time,
  } });
  try {
    assert.equal((await postAudio(speech.base, "student")).status, 200);
    assert.equal((await postAudio(speech.base, "student")).status, 200);
    const limited = await postAudio(speech.base, "student");
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get("retry-after"), "60");
    assert.deepEqual(await limited.json(), { success: false, code: "SPEECH_RATE_LIMITED", message: "Too many speech requests. Please wait a few minutes, then try again." });
    assert.equal(speech.calls.transcribe.length, 2);

    // Budgets are per user and per endpoint.
    assert.equal((await postAudio(speech.base, "student-2")).status, 200);
    assert.equal((await postTts(speech.base, "student")).status, 200);
    assert.equal((await postTts(speech.base, "student")).status, 429);

    // Rejected (401/403) requests never consume a learner's budget.
    assert.equal((await postAudio(speech.base, "teacher")).status, 403);

    time += 60_000;
    assert.equal((await postAudio(speech.base, "student")).status, 200);
    await waitForEmptyDirectory(speech.uploadDirectory);
  } finally { await speech.close(); }
});

test("a throttled upload is never written to disk", async () => {
  const speech = await startSpeechServer({ router: { rateLimits: { stt: { limit: 0, windowMs: 60_000 }, tts: { limit: 0, windowMs: 60_000 } } } });
  try {
    assert.equal((await postAudio(speech.base, "student", { bytes: Buffer.alloc(256 * 1024) })).status, 429);
    assert.equal((await postTts(speech.base, "student")).status, 429);
    assert.deepEqual(await readdir(speech.uploadDirectory), []);
    assert.deepEqual(speech.calls.transcribe, []);
    assert.deepEqual(speech.calls.synthesize, []);
  } finally { await speech.close(); }
});

test("a TTS provider failure logs only the error class, never the text or token", async () => {
  const speech = await startSpeechServer({ ttsFailure: true });
  try {
    const response = await postTts(speech.base, "student", { text: "secret phrase", language: "en" });
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { success: false, message: "Unable to generate pronunciation audio. Please try again." });
    const logged = JSON.stringify(speech.logs);
    assert.match(logged, /Diagnostic text-to-speech synthesis failed/);
    assert.doesNotMatch(logged, /secret phrase|secret-token|Bearer/);
  } finally { await speech.close(); }
});

test("the in-memory limiter prunes expired users once it is full", () => {
  let time = 0;
  const limiter = createRequestLimiter({ limit: 1, windowMs: 10, now: () => time, maxKeys: 2 });
  assert.equal(limiter.take("a").allowed, true);
  assert.equal(limiter.take("b").allowed, true);
  assert.equal(limiter.take("a").allowed, false);
  time = 10;
  assert.equal(limiter.take("c").allowed, true);
  assert.equal(limiter.take("a").allowed, true);
});

test("M5 'Hear American English' is English only and never falls back to another voice", async () => {
  const speech = await startSpeechServer();
  try {
    assert.equal((await postTts(speech.base, "student", { text: "Santos", language: "en", voiceProfile: "american" })).status, 200);
    assert.deepEqual(speech.calls.synthesize.at(-1), { text: "Santos", languageCode: "en-US", voiceProfile: "american" });
    const before = speech.calls.synthesize.length;
    assert.equal((await postTts(speech.base, "student", { text: "aso", language: "fil", voiceProfile: "american" })).status, 400);
    assert.equal(speech.calls.synthesize.length, before, "refused before synthesis");
  } finally { await speech.close(); }
  const failing = await startSpeechServer({ philippineVoiceFailure: "STT_PROVIDER_ERROR" });
  try {
    assert.equal((await postTts(failing.base, "student", { text: "Santos", language: "en", voiceProfile: "american" })).status, 500);
    assert.equal(failing.calls.synthesize.length, 1, "no fallback to a voice that may not be American English");
  } finally { await failing.close(); }
});
