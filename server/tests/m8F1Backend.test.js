// M8 F1 backend wiring, with no database: the speech endpoint's receipt, the reading save, and
// the daily-login route. The database behaviour is in m8F1XpRewardsProposal.test.js.
const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { createHash } = require("node:crypto");
const { createReadAloudAudioHandler } = require("../routes/readAloudAudio");
const { createM8RewardsRouter } = require("../routes/m8Rewards");
const { parseReadingContext, recordTranscriptReceipt, transcriptSha256, verifySavedReading } = require("../services/readingVerification");
const { SupabaseAuthenticationError } = require("../services/supabaseAdmin");

const LEARNER = { user: { id: "learner-1" }, profile: { role: "student" } };
const sha = (text) => createHash("sha256").update(text, "utf8").digest("hex");

function client(result = { data: { verified: true }, error: null }) {
  const calls = [];
  return { calls, getSupabaseAdmin: () => ({ rpc: async (name, args) => { calls.push({ name, args }); return result; } }) };
}

test("the receipt hash matches the transcript the browser sends back", () => {
  const azure = "  The  quick\nbrown\tfox ";
  const browser = azure.replace(/\s+/g, " ").trim(); // oralReadingProcessing.ts
  assert.equal(transcriptSha256(azure), sha("The quick brown fox"));
  assert.equal(transcriptSha256(browser), transcriptSha256(azure));
  assert.notEqual(transcriptSha256("The quick brown fox."), transcriptSha256(azure), "any change in the words breaks the match");
  assert.equal(transcriptSha256("Si Ñino ay masaya"), sha("Si Ñino ay masaya"), "Filipino letters are hashed as UTF-8");
});

const MODULE_ID = "11111111-1111-4111-8111-111111111111";
const PASSAGE_ID = "22222222-2222-4222-8222-222222222222";
const MATERIAL_ID = "33333333-3333-4333-8333-333333333333";
const SUBMISSION_ID = "44444444-4444-4444-8444-444444444444";
const UPLOAD = { language: "fil", query: { moduleId: MODULE_ID, passageId: PASSAGE_ID, submissionId: SUBMISSION_ID } };
const serverSource = async () => ({ id: MODULE_ID, passageId: PASSAGE_ID, passage: "Server text", language: "fil" });

test("the reading context needs a submission and a source, and only well-formed IDs", () => {
  assert.deepEqual(parseReadingContext(UPLOAD.query), UPLOAD.query);
  assert.deepEqual(parseReadingContext({ materialId: MATERIAL_ID, submissionId: SUBMISSION_ID, name: "Santos" }), { materialId: MATERIAL_ID, submissionId: SUBMISSION_ID }, "story names are ignored");
  assert.equal(parseReadingContext({}), null, "an older page sends nothing");
  assert.equal(parseReadingContext({ moduleId: MODULE_ID }), null, "no submission");
  assert.equal(parseReadingContext({ submissionId: SUBMISSION_ID }), null, "no source");
  assert.equal(parseReadingContext({ moduleId: "not-an-id", submissionId: SUBMISSION_ID }), null);
  assert.equal(parseReadingContext({ moduleId: [MODULE_ID, MODULE_ID], submissionId: SUBMISSION_ID }), null, "repeated query values");
});

test("receipts bind the server's own passage, only for learners, and failures never reach M5", async () => {
  const fake = client({ data: "id", error: null });
  const seen = [];
  const loadReadingSource = async (requester, context) => { seen.push([requester.user.id, context]); return serverSource(); };
  assert.equal(await recordTranscriptReceipt(LEARNER, UPLOAD, "Ang bata", { ...fake, loadReadingSource }), true);
  assert.deepEqual(seen, [["learner-1", UPLOAD.query]], "access is checked for the signed-in learner");
  assert.deepEqual(fake.calls, [{ name: "m5_record_transcript_receipt", args: {
    p_user: "learner-1", p_language: "fil", p_sha256: sha("Ang bata"), p_source: PASSAGE_ID, p_passage_text: "Server text", p_submission: SUBMISSION_ID,
  } }], "the text comes from the server, not the browser");

  const material = client({ data: "id", error: null });
  await recordTranscriptReceipt(LEARNER, { language: "en", query: { materialId: MATERIAL_ID, submissionId: SUBMISSION_ID } }, "Text",
    { ...material, loadReadingSource: async () => ({ id: null, materialId: MATERIAL_ID, passageId: null, passage: "M", language: "en" }) });
  assert.equal(material.calls[0].args.p_source, MATERIAL_ID);

  const none = client();
  const deps = { ...none, loadReadingSource: serverSource };
  assert.equal(await recordTranscriptReceipt({ user: { id: "a" }, profile: { role: "admin" } }, UPLOAD, "Text", deps), false);
  assert.equal(await recordTranscriptReceipt(undefined, UPLOAD, "Text", deps), false);
  assert.equal(await recordTranscriptReceipt(LEARNER, { language: "fil", query: {} }, "Text", deps), false, "older page");
  assert.equal(await recordTranscriptReceipt(LEARNER, { language: "en", query: UPLOAD.query }, "Text", deps), false, "language disagrees with the source");
  assert.equal(await recordTranscriptReceipt(LEARNER, UPLOAD, "Text", { ...none, log: () => assert.fail("expected refusal is not logged"),
    loadReadingSource: async () => { throw Object.assign(new Error("not yours"), { statusCode: 403 }); } }), false, "no access, no receipt");
  assert.equal(none.calls.length, 0);

  const logged = [];
  const log = (...args) => logged.push(args);
  assert.equal(await recordTranscriptReceipt(LEARNER, UPLOAD, "Text", { log, loadReadingSource: serverSource, ...client({ data: null, error: { code: "PGRST202" } }) }), false);
  assert.equal(logged.length, 0, "the proposal not being installed yet is not logged");
  assert.equal(await recordTranscriptReceipt(LEARNER, UPLOAD, "Text", { log, loadReadingSource: serverSource, ...client({ data: null, error: { code: "57014", message: "secret text" } }) }), false);
  assert.deepEqual(logged[0][1], { code: "57014", name: undefined }, "no message or transcript in the log");
  assert.equal(await recordTranscriptReceipt(LEARNER, UPLOAD, "Text", { log, loadReadingSource: serverSource, getSupabaseAdmin: () => { throw new Error("not configured"); } }), false);
});

test("a real M5 access refusal stops the receipt through the real loader", async () => {
  const blocked = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }), rpc: async () => assert.fail("no receipt") };
  assert.equal(await recordTranscriptReceipt(LEARNER, UPLOAD, "Text", { getSupabaseAdmin: () => blocked, log: () => assert.fail("not a fault") }), false);
});

test("verifying a saved reading uses the saved transcript and never fails the save", async () => {
  const fake = client();
  assert.deepEqual(await verifySavedReading(LEARNER, { id: "attempt-1", transcript: "Saved text" }, fake), { verified: true });
  assert.deepEqual(fake.calls[0].args, { p_attempt: "attempt-1", p_user: "learner-1", p_sha256: sha("Saved text") });
  assert.deepEqual(await verifySavedReading({ user: { id: "a" }, profile: { role: "admin" } }, { id: "x", transcript: "t" }, client()),
    { verified: false, reason: "not_learner" });
  const failing = await verifySavedReading(LEARNER, { id: "x", transcript: "t" }, { log: () => {}, getSupabaseAdmin: () => { throw new Error("down"); } });
  assert.deepEqual(failing, { verified: false, reason: "unavailable" });
  assert.deepEqual(await verifySavedReading(LEARNER, { id: "x", transcript: "t" }, { getSupabaseAdmin: () => ({}) }),
    { verified: false, reason: "unavailable" }, "a client without RPC support is tolerated");
});

function fakeResponse() {
  const response = {
    statusCode: 200, locals: { speechRequester: LEARNER }, headers: {}, body: null, writableFinished: true,
    on() {}, set(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; },
  };
  return response;
}
const wavRequest = (body = { language: "en" }, query = {}) => ({
  body, query, file: { path: "unused.wav", mimetype: "audio/wav", size: 100 }, readAloudReceivedAt: Date.now(),
});
const handlerWith = (overrides) => createReadAloudAudioHandler({
  remove: async () => {}, timing: () => {}, log: () => {}, transcribe: async () => ({ text: "Azure text" }), ...overrides,
});

test("the read-aloud endpoint records the receipt before replying and only for real transcripts", async () => {
  const order = [];
  const recordReceipt = async (requester, { language, query }, text) => { order.push(["receipt", requester.user.id, language, query.submissionId, text]); };
  const response = fakeResponse();
  const json = response.json.bind(response);
  response.json = (body) => { order.push(["reply"]); return json(body); };
  await handlerWith({ recordReceipt })(wavRequest({ language: "fil" }, { submissionId: "s-1" }), response);
  assert.deepEqual(order, [["receipt", "learner-1", "fil", "s-1", "Azure text"], ["reply"]]);
  assert.equal(response.body.transcription.text, "Azure text");
  assert.equal(response.body.transcription.receipt, undefined, "the response shape is unchanged");

  const silent = [];
  await handlerWith({ recordReceipt: async () => silent.push(1), transcribe: async () => ({ text: "" }) })(wavRequest(), fakeResponse());
  assert.equal(silent.length, 0, "no speech, no receipt");
});

async function withApp(dependencies, run) {
  const app = express();
  app.use(express.json());
  app.use("/api/m8", createM8RewardsRouter(dependencies));
  const server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  try {
    return await run(`http://127.0.0.1:${server.address().port}/api/m8/daily-login`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("daily login: the identity comes from the verified token, never from the request", async () => {
  const fake = client({ data: { eligible: true, awarded: true, xp: 10, date: "2026-11-07" }, error: null });
  await withApp({ ...fake, getAuthenticatedSupabaseUser: async () => ({ id: "verified-user" }) }, async (url) => {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: "someone-else", p_user: "someone-else", date: "2020-01-01", xp: 1000 }) });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true, eligible: true, awarded: true, xp: 10, date: "2026-11-07" });
  });
  assert.deepEqual(fake.calls, [{ name: "m8_claim_daily_login", args: { p_user: "verified-user" } }]);
});

test("daily login: signed-out is refused, nothing is installed is harmless, failures are safe, abuse is throttled", async () => {
  const signedOut = client();
  await withApp({ ...signedOut, getAuthenticatedSupabaseUser: async () => { throw new SupabaseAuthenticationError(); } }, async (url) => {
    assert.equal((await fetch(url, { method: "POST" })).status, 401);
  });
  assert.equal(signedOut.calls.length, 0);

  const authed = { getAuthenticatedSupabaseUser: async () => ({ id: "u" }) };
  await withApp({ ...authed, ...client({ data: null, error: { code: "PGRST202" } }) }, async (url) => {
    const response = await fetch(url, { method: "POST" });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true, eligible: false, awarded: false });
  });

  const logged = [];
  await withApp({ ...authed, log: (...args) => logged.push(args), ...client({ data: null, error: { code: "23000", message: "detail" } }) }, async (url) => {
    const response = await fetch(url, { method: "POST" });
    assert.equal(response.status, 500);
    assert.equal(JSON.stringify(await response.json()).includes("detail"), false);
  });
  assert.deepEqual(logged[0][1], { code: "23000" });

  const limited = client({ data: { eligible: true, awarded: false }, error: null });
  await withApp({ ...authed, ...limited, limiter: { take: () => ({ allowed: false, retryAfterSeconds: 7 }) } }, async (url) => {
    const response = await fetch(url, { method: "POST" });
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("retry-after"), "7");
  });
  assert.equal(limited.calls.length, 0);
});
