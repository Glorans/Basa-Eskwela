const assert = require("node:assert/strict");
const test = require("node:test");
const { once } = require("node:events");
const express = require("express");
const { createOralReadingRouter } = require("../routes/oralReading");
const { createRequestLimiter } = require("../services/speechAccess");
const { OralReadingAuthorizationError } = require("../services/oralReadingAttemptService");
const { SpeechConfigurationError, SpeechTranscriptionError } = require("../services/speechErrors");

const ATTEMPT_EN = "11111111-1111-4111-8111-111111111111";
const ATTEMPT_FIL = "22222222-2222-4222-8222-222222222222";
const OTHERS = "33333333-3333-4333-8333-333333333333";
const PASSAGE = "Every Saturday morning, Lina walks with her grandfather.";

async function start(t, { assess, limit = 60 } = {}) {
  const calls = { assess: [] };
  const attempts = {
    [ATTEMPT_EN]: { id: ATTEMPT_EN, language: "en", passageSnapshot: PASSAGE },
    [ATTEMPT_FIL]: { id: ATTEMPT_FIL, language: "fil", passageSnapshot: "Tuwing Sabado ng umaga." },
  };
  const app = express();
  app.use(createOralReadingRouter({
    authorizeOralReadingPracticeRequest: async (req) => {
      if (req.get("authorization") !== "Bearer learner") throw new OralReadingAuthorizationError("Not allowed.");
      return { user: { id: "learner-1" }, profile: { role: "general_user" } };
    },
    getOralReadingAttempt: async (_requester, attemptId) => {
      if (!attempts[attemptId]) throw new OralReadingAuthorizationError("This oral-reading result is not available to your account.");
      return attempts[attemptId];
    },
    assessPronunciation: async (buffer, language, reference) => {
      calls.assess.push({ bytes: buffer.length, language, reference });
      if (assess) return assess();
      return { provider: "azure", locale: "en-US", scale: "0-100", utterances: [{ text: "Every Saturday", accuracy: 88, fluency: 90, words: [] }] };
    },
    pronunciationLimiter: createRequestLimiter({ limit, windowMs: 60000 }),
  }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function post(attemptId, { token = "learner", type = "audio/wav", extra } = {}) {
    const form = new FormData();
    form.append("audio", new Blob([Buffer.from("RIFF-test")], { type }), "part.wav");
    if (extra) form.append("referenceText", extra);
    const response = await fetch(`${base}/attempts/${attemptId}/pronunciation`, {
      method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form,
    });
    return { status: response.status, body: await response.json() };
  }
  return { calls, post };
}

test("English pronunciation uses the saved passage as the reference, never browser text", async (t) => {
  const app = await start(t);
  const ok = await app.post(ATTEMPT_EN);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.pronunciation.utterances[0].accuracy, 88);
  assert.deepEqual(app.calls.assess, [{ bytes: 9, language: "en", reference: PASSAGE }]);
  // An extra field is a malformed upload; no client reference text is ever used.
  const injected = await app.post(ATTEMPT_EN, { extra: "forged reference" });
  assert.equal(injected.status, 400);
  assert.equal(app.calls.assess.length, 1);
});

test("Filipino readings get no Azure pronunciation call", async (t) => {
  const app = await start(t);
  const result = await app.post(ATTEMPT_FIL);
  assert.equal(result.status, 422);
  assert.equal(result.body.code, "PRONUNCIATION_UNSUPPORTED");
  assert.deepEqual(app.calls.assess, []);
});

test("another learner's attempt, missing auth and non-WAV uploads are refused before Azure", async (t) => {
  const app = await start(t);
  assert.equal((await app.post(OTHERS)).status, 403);
  assert.equal((await app.post(ATTEMPT_EN, { token: "nobody" })).status, 403);
  const webm = await app.post(ATTEMPT_EN, { type: "audio/webm" });
  assert.equal(webm.status, 400);
  assert.equal(webm.body.code, "STT_INVALID_AUDIO");
  assert.deepEqual(app.calls.assess, []);
});

test("pronunciation requests are throttled per learner", async (t) => {
  const app = await start(t, { limit: 1 });
  assert.equal((await app.post(ATTEMPT_EN)).status, 200);
  const limited = await app.post(ATTEMPT_EN);
  assert.equal(limited.status, 429);
  assert.equal(limited.body.code, "SPEECH_RATE_LIMITED");
});

test("missing Azure configuration and provider failures return safe codes", async (t) => {
  for (const [error, status, code] of [
    [new SpeechConfigurationError(), 503, "SPEECH_NOT_CONFIGURED"],
    [new SpeechTranscriptionError("STT_QUOTA"), 503, "STT_QUOTA"],
    [new Error("raw sdk detail key=abc"), 502, "STT_PROVIDER_ERROR"],
  ]) {
    const app = await start(t, { assess: () => { throw error; } });
    const result = await app.post(ATTEMPT_EN);
    assert.equal(result.status, status);
    assert.equal(result.body.code, code);
    assert.doesNotMatch(result.body.message, /raw sdk|key=/);
  }
});

test("a silent part returns an empty assessment instead of failing the whole reading", async (t) => {
  const app = await start(t, { assess: () => { throw new SpeechTranscriptionError("NO_SPEECH"); } });
  const result = await app.post(ATTEMPT_EN);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.pronunciation.utterances, []);
});
