const assert = require("node:assert/strict");
const test = require("node:test");
const { EventEmitter, once } = require("node:events");
const { createServer } = require("node:http");
const { WebSocket } = require("ws");

const { attachDiagnosticSpeechSocket } = require("../routes/diagnosticSpeechSocket");
const { testReceipts } = require("./fixtures/diagnosticTrust");
const { createDiagnosticSpeechSession } = require("../services/diagnosticSpeechStream");
const { SPEECH_STREAM_SESSION_LIMIT } = require("../services/speechAccess");
const { SupabaseAuthenticationError } = require("../services/supabaseAdmin");
const { authorizeOralReadingPracticeRequest } = require("../services/oralReadingAttemptService");

const ORIGIN = "http://localhost:5173";

// Token -> profile. Lookups are stubbed; the real M5 self-practice role rule decides access.
const PROFILES = {
  student: { id: "student-1", role: "student" },
  "student-2": { id: "student-2", role: "student" },
  general: { id: "general-1", role: "general_user" },
  admin: { id: "admin-1", role: "admin" },
  teacher: { id: "teacher-1", role: "teacher" },
  pending: { id: "teacher-2", role: "teacher" },
  unassigned: { id: "unassigned-1", role: null },
};

const authDependencies = {
  async getAuthenticatedSupabaseUser(req) {
    const token = /^Bearer\s+(.+)$/i.exec(req.get("authorization") ?? "")?.[1]?.trim();
    if (!token || !PROFILES[token]) throw new SupabaseAuthenticationError();
    return { id: PROFILES[token].id };
  },
  getSupabaseAdmin: () => ({
    from: () => ({ select: () => ({ eq: (_column, id) => ({
      single: async () => {
        const profile = Object.values(PROFILES).find((item) => item.id === id);
        return { data: { id, full_name: "", nickname: null, role: profile.role }, error: null };
      },
    }) }) }),
  }),
};

class FakeRecognitionStream extends EventEmitter {
  bytes = 0;
  ended = false;
  destroyed = false;
  write(frame) { this.bytes += frame.length; return true; }
  end() { this.ended = true; }
  destroy() { this.destroyed = true; this.emit("close"); }
}

async function startSocket(t, options = {}) {
  const server = createServer();
  const streams = [];
  const authorizeCalls = [];
  const socketServer = attachDiagnosticSpeechSocket(server, {
    receipts: testReceipts(),
    authorize: async (token) => {
      authorizeCalls.push(token);
      return authorizeOralReadingPracticeRequest({ get: () => `Bearer ${token}` }, authDependencies);
    },
    createSession: (sessionOptions) => createDiagnosticSpeechSession({
      ...sessionOptions,
      log: () => {},
      createStream: (request) => { const stream = new FakeRecognitionStream(); stream.request = request; streams.push(stream); return stream; },
    }),
    ...options,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { socketServer.dispose(); await new Promise((resolve) => server.close(resolve)); });
  return { socketServer, streams, authorizeCalls, url: `ws://127.0.0.1:${server.address().port}/ws/diagnostic/speech` };
}

async function connect(url) {
  const ws = new WebSocket(url, { origin: ORIGIN });
  ws.messages = [];
  ws.closeEvent = new Promise((resolve) => ws.on("close", (code, reason) => resolve({ code, reason: String(reason) })));
  ws.on("message", (raw) => ws.messages.push(JSON.parse(raw)));
  await once(ws, "open");
  return ws;
}

function configure(ws, accessToken, language = "en") {
  ws.send(JSON.stringify({ type: "configure", accessToken, language, encoding: "LINEAR16", sampleRate: 16000, channels: 1 }));
}

async function waitFor(condition) {
  for (let attempt = 0; attempt < 200 && !condition(); attempt++) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(condition(), "condition was not reached");
}

async function startStream(url, token, language) {
  const ws = await connect(url);
  configure(ws, token, language);
  await waitFor(() => ws.messages.length > 0);
  return ws;
}

test("the per-user session-start budget is 12 per 10 minutes", () => {
  assert.deepEqual(SPEECH_STREAM_SESSION_LIMIT, { limit: 12, windowMs: 600000 });
});

test("missing or invalid tokens are rejected before Azure is opened", async (t) => {
  const socket = await startSocket(t);
  for (const configureMessage of [
    { type: "configure", language: "en", encoding: "LINEAR16", sampleRate: 16000, channels: 1 },
    { type: "configure", accessToken: "", language: "en", encoding: "LINEAR16", sampleRate: 16000, channels: 1 },
  ]) {
    const ws = await connect(socket.url);
    ws.send(JSON.stringify(configureMessage));
    assert.equal((await ws.closeEvent).code, 1008);
    assert.equal(ws.messages[0].code, "STREAM_UNAVAILABLE");
  }
  const forged = await startStream(socket.url, "forged");
  assert.equal((await forged.closeEvent).code, 1008);
  assert.deepEqual(forged.messages.map((message) => message.type), ["error"]);
  assert.equal(socket.streams.length, 0);
  assert.equal(socket.socketServer.activeStreams.size, 0);
});

test("teachers (approved or pending) and accounts without a role are rejected without Azure", async (t) => {
  const socket = await startSocket(t);
  for (const token of ["teacher", "pending", "unassigned"]) {
    const ws = await startStream(socket.url, token);
    assert.equal((await ws.closeEvent).code, 1008, token);
    assert.equal(ws.messages[0].type, "error", token);
  }
  assert.equal(socket.streams.length, 0);
  assert.equal(socket.socketServer.activeStreams.size, 0);
});

test("students, independent learners and admins stream English and Filipino as before", async (t) => {
  const socket = await startSocket(t);
  for (const [token, language, languageCode] of [
    ["student", "en", "en-US"], ["general", "fil", "fil-PH"], ["admin", "en", "en-US"],
  ]) {
    const ws = await startStream(socket.url, token, language);
    assert.deepEqual(ws.messages[0], { type: "ready", encoding: "LINEAR16", sampleRate: 16000, channels: 1 }, token);
    const stream = socket.streams.at(-1);
    assert.equal(stream.request.languageCode, languageCode);
    ws.send(Buffer.alloc(3200));
    await waitFor(() => stream.bytes === 3200);
    ws.close();
    await ws.closeEvent;
    await waitFor(() => stream.destroyed);
  }
  await waitFor(() => socket.socketServer.activeStreams.size === 0);
});

test("a second stream from the same account replaces the first; other accounts are unaffected", async (t) => {
  const socket = await startSocket(t);
  const first = await startStream(socket.url, "student");
  const other = await startStream(socket.url, "student-2");
  const second = await startStream(socket.url, "student");
  assert.equal(second.messages[0].type, "ready");

  const firstClose = await first.closeEvent;
  assert.equal(firstClose.code, 4000);
  assert.equal(first.messages.at(-1).code, "STREAM_REPLACED");
  assert.equal(socket.streams[0].destroyed, true, "the replaced Azure stream is closed");
  assert.equal(socket.streams[2].destroyed, false);
  assert.equal(other.readyState, WebSocket.OPEN);
  assert.equal(socket.socketServer.activeStreams.size, 2);

  // Audio still reaches only the active stream.
  second.send(Buffer.alloc(3200));
  await waitFor(() => socket.streams[2].bytes === 3200);
  assert.equal(socket.streams[0].bytes, 0);
  second.close(); other.close();
  await waitFor(() => socket.socketServer.activeStreams.size === 0);
});

test("tracking is released on disconnect, completed stream, failure and shutdown; reconnection works", async (t) => {
  const socket = await startSocket(t);
  const { activeStreams } = socket.socketServer;

  // Client disconnect.
  const disconnected = await startStream(socket.url, "student");
  assert.equal(activeStreams.size, 1);
  disconnected.close();
  await waitFor(() => activeStreams.size === 0);

  // Immediate reconnection after a dropped connection the server has not noticed yet.
  const dropped = await startStream(socket.url, "student");
  const reconnected = await startStream(socket.url, "student");
  assert.equal(reconnected.messages[0].type, "ready");
  assert.equal((await dropped.closeEvent).code, 4000);
  assert.equal(activeStreams.size, 1);

  // Completed stream (stop -> Azure finalizes -> server closes the socket).
  reconnected.send(Buffer.alloc(3200));
  const azure = socket.streams.at(-1);
  await waitFor(() => azure.bytes === 3200);
  reconnected.send(JSON.stringify({ type: "stop" }));
  await waitFor(() => azure.ended);
  azure.emit("end");
  assert.equal((await reconnected.closeEvent).code, 1000);
  await waitFor(() => activeStreams.size === 0);

  // Azure failure mid-stream.
  const failing = await startStream(socket.url, "student");
  socket.streams.at(-1).emit("error", new Error("provider"));
  await failing.closeEvent;
  await waitFor(() => activeStreams.size === 0);

  // Abrupt connection failure.
  const broken = await startStream(socket.url, "student");
  broken.terminate();
  await waitFor(() => activeStreams.size === 0);

  // Server shutdown clears every tracked stream.
  await startStream(socket.url, "student");
  await startStream(socket.url, "general");
  assert.equal(activeStreams.size, 2);
  socket.socketServer.dispose();
  assert.equal(activeStreams.size, 0);
});

test("exceeding the per-user session-start budget is rejected without Azure and resets later", async (t) => {
  let time = 1_000_000;
  const socket = await startSocket(t, { sessionLimit: { limit: 2, windowMs: 60_000 }, now: () => time });
  for (let index = 0; index < 2; index++) {
    const ws = await startStream(socket.url, "student");
    assert.equal(ws.messages[0].type, "ready");
    ws.close();
    await ws.closeEvent;
  }
  // Rejected (unauthorized) attempts never consume a learner's budget.
  const teacher = await startStream(socket.url, "teacher");
  await teacher.closeEvent;

  const limited = await startStream(socket.url, "student");
  assert.deepEqual(await limited.closeEvent, { code: 1013, reason: "Too many diagnostic streams" });
  assert.equal(limited.messages[0].code, "SPEECH_RATE_LIMITED");
  assert.equal(socket.streams.length, 2, "no Azure stream for the rejected start");

  const otherUser = await startStream(socket.url, "general");
  assert.equal(otherUser.messages[0].type, "ready");
  otherUser.close();

  time += 60_000;
  const afterWindow = await startStream(socket.url, "student");
  assert.equal(afterWindow.messages[0].type, "ready");
  afterWindow.close();
  await waitFor(() => socket.socketServer.activeStreams.size === 0);
});

test("a disconnect during authorization neither opens Azure nor uses the budget", async (t) => {
  let release;
  let calls = 0;
  const student = { user: { id: "student-1" }, profile: { role: "student" } };
  const socket = await startSocket(t, {
    sessionLimit: { limit: 1, windowMs: 60_000 },
    // The first authorization is held open; later ones resolve immediately.
    authorize: () => (++calls === 1 ? new Promise((resolve) => { release = resolve; }) : Promise.resolve(student)),
  });
  const ws = await connect(socket.url);
  configure(ws, "student");
  await waitFor(() => Boolean(release));
  ws.close();
  await ws.closeEvent;
  release(student);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(socket.streams.length, 0);
  assert.equal(socket.socketServer.activeStreams.size, 0);

  // With a budget of one, a later real start still succeeds.
  const next = await startStream(socket.url, "student");
  assert.equal(next.messages[0].type, "ready");
  next.close();
  await waitFor(() => socket.socketServer.activeStreams.size === 0);
});

test("other origins are still refused before any authorization", async (t) => {
  const socket = await startSocket(t);
  const rejected = new WebSocket(socket.url, { origin: "https://unrelated.example" });
  const [error] = await once(rejected, "error");
  assert.match(error.message, /403/);
  assert.deepEqual(socket.authorizeCalls, []);
});

// DT1: receipts are issued only to streams that name the active M2 diagnostic.
async function finishStream(ws, stream, text) {
  ws.send(Buffer.alloc(3200));
  await waitFor(() => stream.bytes === 3200);
  stream.emit("data", { results: [{ isFinal: true, endOffsetTicks: 10000000, text: text }] });
  ws.send(JSON.stringify({ type: "stop" }));
  await waitFor(() => stream.ended);
  stream.emit("end");
  await waitFor(() => ws.messages.some((message) => message.type === "complete"));
  return ws.messages.find((message) => message.type === "complete");
}

function configureDiagnostic(ws, accessToken, language, diagnostic) {
  ws.send(JSON.stringify({ type: "configure", accessToken, language, encoding: "LINEAR16", sampleRate: 16000, channels: 1, diagnostic }));
}

test("DT1: M5 voice-follow streams work without a receipt secret and never receive a receipt", async (t) => {
  const { createTranscriptReceiptService } = require("../services/diagnosticTranscriptReceipts");
  const socket = await startSocket(t, { receipts: createTranscriptReceiptService({ getSecret: () => undefined }) });
  const ws = await startStream(socket.url, "student", "fil");
  assert.equal(ws.messages[0].type, "ready");
  const complete = await finishStream(ws, socket.streams.at(-1), "isang araw");
  assert.deepEqual(complete, { type: "complete", finalCount: 1, audioBytes: 3200 });
});

test("DT1: an M2 stream needs the active diagnostic and a configured secret, then gets a bound receipt", async (t) => {
  const { createTranscriptReceiptService } = require("../services/diagnosticTranscriptReceipts");
  const unsigned = await startSocket(t, { receipts: createTranscriptReceiptService({ getSecret: () => undefined }) });
  const noSecret = await connect(unsigned.url);
  configureDiagnostic(noSecret, "student", "en", { assessmentId: "grade5-en-passage-v3", assessmentVersion: "3.0" });
  assert.equal((await noSecret.closeEvent).code, 1008);
  assert.equal(unsigned.streams.length, 0);

  const receipts = testReceipts();
  const socket = await startSocket(t, { receipts });
  for (const diagnostic of [{ assessmentId: "grade5-en-passage-v3", assessmentVersion: "2.0" },
    { assessmentId: "grade5-fil-passage-v3", assessmentVersion: "3.0" }, { assessmentId: "m5-passage" }, null, "x"]) {
    const ws = await connect(socket.url);
    configureDiagnostic(ws, "student", "en", diagnostic);
    assert.equal((await ws.closeEvent).code, 1008, JSON.stringify(diagnostic));
  }
  assert.equal(socket.streams.length, 0);

  const ws = await connect(socket.url);
  configureDiagnostic(ws, "student", "en", { assessmentId: "grade5-en-passage-v3", assessmentVersion: "3.0" });
  await waitFor(() => ws.messages.length > 0);
  const complete = await finishStream(ws, socket.streams.at(-1), "Mia walked");
  const claims = receipts.verify(complete.receipt);
  assert.deepEqual([claims.sub, claims.lang, claims.aid, claims.aver, claims.src, claims.text],
    ["student-1", "en", "grade5-en-passage-v3", "3.0", "stream", "Mia walked"]);
});
