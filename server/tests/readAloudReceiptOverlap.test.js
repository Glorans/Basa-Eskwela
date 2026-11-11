// Performance: the M8 receipt's reading-source lookup overlaps Azure recognition, with the same outcome.
// No database or Azure: injected fakes only.
const test = require("node:test");
const assert = require("node:assert/strict");
const { createReadAloudAudioHandler } = require("../routes/readAloudAudio");
const { prepareTranscriptReceipt, recordTranscriptReceipt } = require("../services/readingVerification");

const LEARNER = { user: { id: "learner-1" }, profile: { role: "student" } };
const MODULE_ID = "11111111-1111-4111-8111-111111111111";
const PASSAGE_ID = "22222222-2222-4222-8222-222222222222";
const MATERIAL_ID = "33333333-3333-4333-8333-333333333333";
const SUBMISSION_ID = "44444444-4444-4444-8444-444444444444";
const QUERY = { moduleId: MODULE_ID, passageId: PASSAGE_ID, submissionId: SUBMISSION_ID };
const SOURCE = { id: MODULE_ID, passageId: PASSAGE_ID, passage: "Server text", language: "en" };
const rpcClient = (result = { data: "id", error: null }) => {
  const calls = [];
  return { calls, getSupabaseAdmin: () => ({ rpc: async (name, args) => { calls.push({ name, args }); return result; } }) };
};

test("the early source lookup runs only when a receipt would be recorded", async () => {
  const loads = [];
  const loadReadingSource = async (requester, context) => { loads.push(context); return SOURCE; };
  assert.equal(prepareTranscriptReceipt({ user: { id: "a" }, profile: { role: "admin" } }, { query: QUERY }, { loadReadingSource }), null);
  assert.equal(prepareTranscriptReceipt({ user: { id: "t" }, profile: { role: "teacher" } }, { query: QUERY }, { loadReadingSource }), null);
  assert.equal(prepareTranscriptReceipt(undefined, { query: QUERY }, { loadReadingSource }), null);
  assert.equal(prepareTranscriptReceipt(LEARNER, { query: {} }, { loadReadingSource }), null, "older page: no context");
  assert.equal(prepareTranscriptReceipt({ user: { id: "g" }, profile: { role: "general_user" } },
    { query: { materialId: MATERIAL_ID, submissionId: SUBMISSION_ID } }, { loadReadingSource }), null, "personal uploads earn no awards");
  assert.equal(loads.length, 0);
  assert.deepEqual(await prepareTranscriptReceipt(LEARNER, { query: QUERY }, { loadReadingSource }), SOURCE);
  assert.deepEqual(loads, [QUERY]);
});

test("a prepared source records the same receipt and keeps the same refusal and failure rules", async () => {
  const fake = rpcClient();
  const inline = async () => assert.fail("the prepared source replaces the inline load");
  assert.equal(await recordTranscriptReceipt(LEARNER, { language: "en", query: QUERY }, "Azure text",
    { ...fake, loadReadingSource: inline, preparedSource: Promise.resolve(SOURCE) }), true);
  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0].name, "m5_record_transcript_receipt");
  assert.equal(fake.calls[0].args.p_passage_text, "Server text", "bound to the server's own passage");
  assert.equal(fake.calls[0].args.p_submission, SUBMISSION_ID);

  assert.equal(await recordTranscriptReceipt(LEARNER, { language: "fil", query: QUERY }, "Text",
    { ...rpcClient(), preparedSource: Promise.resolve(SOURCE) }), false, "language disagrees with the server source");

  const refused = Object.assign(new Error("Forbidden"), { statusCode: 403 });
  const expectedRejection = Promise.reject(refused); expectedRejection.catch(() => {});
  assert.equal(await recordTranscriptReceipt(LEARNER, { language: "en", query: QUERY }, "Text",
    { ...rpcClient(), log: () => assert.fail("an expected refusal is not logged"), preparedSource: expectedRejection }), false);

  const logged = [];
  const fault = Promise.reject(new Error("database down")); fault.catch(() => {});
  assert.equal(await recordTranscriptReceipt(LEARNER, { language: "en", query: QUERY }, "Text",
    { ...rpcClient(), log: (...entry) => logged.push(entry), preparedSource: fault }), false, "M5 continues without a receipt");
  assert.equal(logged.length, 1, "a real fault is still reported");
});

function fakeResponse() {
  return {
    statusCode: 200, locals: { speechRequester: LEARNER }, headers: {}, body: null, writableFinished: true,
    on() {}, set(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; },
  };
}
const wavRequest = () => ({ body: { language: "en" }, query: QUERY, file: { path: "unused.wav", mimetype: "audio/wav", size: 100 }, readAloudReceivedAt: Date.now() });
const base = { remove: async () => {}, timing: () => {}, log: () => {}, contextArchived: async () => false };

test("the read-aloud route starts the source lookup before recognition ends and records the receipt before replying", async () => {
  const order = [];
  const response = fakeResponse();
  const json = response.json.bind(response);
  response.json = (body) => { order.push("reply"); return json(body); };
  await createReadAloudAudioHandler({
    ...base,
    prepareReceipt: (requester, { query }) => { order.push(`prepare:${requester.user.id}:${query.submissionId}`); return Promise.resolve(SOURCE); },
    transcribe: async () => { order.push("recognize"); return { text: "Azure text" }; },
    recordReceipt: async (requester, info, text, deps) => { order.push(`receipt:${text}:${(await deps.preparedSource).passage}`); },
  })(wavRequest(), response);
  assert.deepEqual(order, [`prepare:learner-1:${SUBMISSION_ID}`, "recognize", "receipt:Azure text:Server text", "reply"]);
  assert.equal(response.body.transcription.text, "Azure text");
});

test("a failed recognition or a failed early lookup never changes the transcription reply", async () => {
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);
  try {
    const failed = fakeResponse();
    const pending = Promise.reject(new Error("source failed")); pending.catch(() => {});
    await createReadAloudAudioHandler({
      ...base,
      prepareReceipt: () => pending,
      transcribe: async () => { throw Object.assign(new Error("azure"), { code: "STT_FAILED" }); },
      recordReceipt: async () => assert.fail("no transcript, no receipt"),
    })(wavRequest(), failed);
    assert.notEqual(failed.statusCode, 200);

    const ok = fakeResponse();
    await createReadAloudAudioHandler({
      ...base,
      prepareReceipt: (requester, info) => prepareTranscriptReceipt(requester, info, { loadReadingSource: async () => { throw new Error("down"); } }),
      transcribe: async () => ({ text: "Azure text" }),
      recordReceipt: (requester, info, text, deps) => recordTranscriptReceipt(requester, info, text, { ...deps, ...rpcClient(), log: () => {} }),
    })(wavRequest(), ok);
    assert.equal(ok.statusCode, 200);
    assert.equal(ok.body.transcription.text, "Azure text");
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(unhandled, []);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});

test("a substituted receipt recorder gets no default early lookup", async () => {
  const seen = [];
  await createReadAloudAudioHandler({
    ...base,
    transcribe: async () => ({ text: "Azure text" }),
    recordReceipt: async (...args) => { seen.push(args.length); },
  })(wavRequest(), fakeResponse());
  assert.deepEqual(seen, [3], "the original three-argument call");
});
