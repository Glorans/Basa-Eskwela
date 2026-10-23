const assert = require("node:assert/strict");
const test = require("node:test");
const { EventEmitter, once } = require("node:events");
const { createServer } = require("node:http");
const { WebSocket } = require("ws");
const { attachDiagnosticSpeechSocket } = require("../routes/diagnosticSpeechSocket");
const { testReceipts } = require("./fixtures/diagnosticTrust");
const { buildStreamingRequest, createDiagnosticSpeechSession, developmentLog } = require("../services/diagnosticSpeechStream");

class FakeRecognitionStream extends EventEmitter {
  bytes = 0;
  ended = false;
  destroyed = false;
  blocked = false;
  write(frame) { this.bytes += frame.length; return !this.blocked; }
  end() { this.ended = true; }
  destroy() { this.destroyed = true; this.emit("close"); }
  result(text, isFinal = false, seconds = 1) {
    this.emit("data", { results: [{ isFinal, text, confidence: 0.9, ...(isFinal ? { endOffsetTicks: seconds * 1e7 } : {}) }] });
  }
}

function fakeClock() {
  let now = 0;
  let next = 0;
  const jobs = new Map();
  return {
    jobs,
    setTimeout(fn, delay) { const id = ++next; jobs.set(id, { at: now + delay, fn }); return id; },
    clearTimeout(id) { jobs.delete(id); },
    advance(ms) {
      const target = now + ms;
      while (true) {
        const entry = [...jobs].filter(([, job]) => job.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!entry) break;
        jobs.delete(entry[0]); now = entry[1].at; entry[1].fn();
      }
      now = target;
    },
  };
}

function fixture() {
  const streams = [], messages = [], requests = [], logs = [];
  const clock = fakeClock();
  let closes = 0;
  const session = createDiagnosticSpeechSession({
    language: "en", send: (data) => messages.push(data), close: () => { closes++; },
    timers: clock, log: (event, details) => logs.push({ event, details }),
    createStream: (request) => { requests.push(request); const stream = new FakeRecognitionStream(); streams.push(stream); return stream; },
  });
  return { session, streams, messages, requests, logs, clock, get closes() { return closes; } };
}

test("stream config uses LINEAR16 mono 16k and continuous interim recognition in both Azure locales", () => {
  for (const [language, code] of [["en", "en-US"], ["fil", "fil-PH"]]) {
    assert.deepEqual(buildStreamingRequest(language), {
      encoding: "LINEAR16", sampleRateHertz: 16000, channels: 1, languageCode: code, interimResults: true,
    });
  }
  assert.throws(() => buildStreamingRequest("unknown"));
});

test("interims are replaceable; finals are ordered and deduplicated by time, not repeated words", () => {
  const f = fixture();
  f.streams[0].result("one day");
  f.streams[0].result("one day a frog");
  assert.equal(f.messages.filter((m) => m.type === "final").length, 0);
  f.streams[0].result("frog", true, 1);
  f.streams[0].result("frog", true, 1);
  f.streams[0].result("frog", true, 2);
  assert.deepEqual(f.messages.filter((m) => m.type === "final").map((m) => [m.sequence, m.text]), [[1, "frog"], [2, "frog"]]);
  f.session.dispose();
  assert.equal(f.clock.jobs.size, 0);
});

test("31 seconds with natural silence/final results keeps the same stream alive", () => {
  const f = fixture();
  for (let i = 0; i < 310; i++) {
    f.session.acceptAudio(Buffer.alloc(3200)); // Silence is still PCM, not an end message.
    if (i === 30) f.streams[0].result("one day", true);
    f.clock.advance(100);
  }
  assert.equal(f.streams.length, 1);
  assert.equal(f.streams[0].ended, false);
  assert.equal(f.closes, 0);
  f.session.dispose();
});

test("a duplicate old final cannot erase a newer interim or terminate recognition", () => {
  const f = fixture();
  f.streams[0].result("one day a frog", true, 1);
  f.streams[0].result("sat on a lily pad");
  const count = f.messages.length;
  f.streams[0].result("one day a frog", true, 1);
  assert.equal(f.messages.length, count);
  assert.equal(f.messages.at(-1).text, "sat on a lily pad");
  assert.equal(f.streams[0].ended, false);
  f.session.dispose();
});

test("unfinalized speech at stop or rotation selects fallback instead of silently dropping words", () => {
  for (const rotating of [false, true]) {
    const f = fixture();
    f.streams[0].result("one day", true, 1);
    if (rotating) {
      for (let index = 0; index < 2400; index++) {
        f.session.acceptAudio(Buffer.alloc(3200)); f.clock.advance(100);
      }
    } else f.session.stop();
    f.streams[0].result("a frog sat");
    f.streams[0].emit("end");
    assert.equal(f.messages.some(message => message.type === "complete"), false);
    assert.equal(f.messages.at(-1).type, "error");
    assert.equal(f.closes, 1);
    assert.equal(f.clock.jobs.size, 0);
  }
});

test("manual stop half-closes Azure and waits for final results before completion", () => {
  const f = fixture();
  f.session.acceptAudio(Buffer.alloc(3200));
  f.session.stop(); f.session.stop();
  assert.equal(f.streams[0].ended, true);
  assert.equal(f.closes, 0);
  f.streams[0].result("the frog smiled", true);
  f.streams[0].emit("end");
  assert.deepEqual(f.messages.at(-1), { type: "complete", finalCount: 1, audioBytes: 3200 });
  assert.equal(f.closes, 1);
  assert.equal(f.clock.jobs.size, 0);
});

test("complete FINAL log preserves provider wording and order, excludes interims and duplicate finals, and includes the trailing final", () => {
  const f = fixture();
  f.streams[0].result("1 day.", true, 1);
  f.streams[0].result("1 day.", true, 1);
  f.streams[0].result("interim words only");
  f.streams[0].result("A frog, sat on a lily pad.", true, 2);
  f.session.stop();
  f.streams[0].result("Still a rock...", true, 3);
  f.streams[0].emit("end");
  const completed = f.logs.filter(item => item.event === "complete final transcript");
  assert.equal(completed.length, 1);
  assert.equal(completed[0].details.text, "1 day. A frog, sat on a lily pad. Still a rock...");
  assert.equal(completed[0].details.finalCount, 3);
  assert.deepEqual(f.logs.filter(item => item.event === "final transcript").map(item => item.details.sequence), [1, 2, 3]);
});

test("stream transcript logging is enabled only in development", () => {
  const previousEnvironment = process.env.NODE_ENV;
  const previousInfo = console.info;
  const logged = [];
  console.info = (...args) => logged.push(args);
  try {
    for (const environment of ["production", "test", "development"]) {
      process.env.NODE_ENV = environment;
      developmentLog("complete final transcript", { text: "provider transcript" });
    }
    assert.deepEqual(logged, [["[DiagnosticStreaming] complete final transcript", { text: "provider transcript" }]]);
  } finally {
    console.info = previousInfo;
    if (previousEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousEnvironment;
  }
});

test("four-minute rotation buffers new audio, drains in order, and supports stop during rotation", () => {
  const f = fixture();
  for (let i = 0; i < 2400; i++) { f.session.acceptAudio(Buffer.alloc(3200)); f.clock.advance(100); }
  assert.equal(f.streams[0].ended, true);
  f.session.acceptAudio(Buffer.alloc(1600));
  f.session.stop();
  f.streams[0].result("first", true, 240);
  f.streams[0].emit("end");
  assert.equal(f.streams.length, 2);
  assert.equal(f.streams[1].bytes, 1600);
  assert.equal(f.streams[1].ended, true);
  f.streams[1].result("second", true, 1);
  f.streams[1].emit("end");
  assert.deepEqual(f.messages.filter((m) => m.type === "final").map((m) => m.text), ["first", "second"]);
  assert.equal(f.messages.at(-1).audioBytes, 2400 * 3200 + 1600);
  assert.ok(f.requests.every(request => request.languageCode === "en-US"));
  assert.deepEqual(f.logs.filter(item => item.event === "complete final transcript"), [{
    event: "complete final transcript",
    details: { languageCode: "en-US", finalCount: 2, text: "first second" },
  }]);
  assert.equal(f.clock.jobs.size, 0);
});

for (const failure of ["error", "end", "close", "interruption", "invalid-frame", "backpressure", "finalization-timeout"]) {
  test(`${failure} safely releases the Azure stream and leaves upload fallback available`, () => {
    const f = fixture();
    if (failure === "interruption") f.clock.advance(10001);
    else if (failure === "invalid-frame") f.session.acceptAudio(Buffer.alloc(3));
    else if (failure === "backpressure") {
      f.streams[0].blocked = true;
      for (let i = 0; i < 53; i++) f.session.acceptAudio(Buffer.alloc(3200));
    } else if (failure === "finalization-timeout") { f.session.stop(); f.clock.advance(15001); }
    else f.streams[0].emit(failure, new Error("secret credential path"));
    assert.equal(f.messages.at(-1).type, "error");
    assert.doesNotMatch(JSON.stringify(f.messages), /secret|credential/);
    assert.equal(f.streams[0].destroyed, true);
    assert.equal(f.clock.jobs.size, 0);
    assert.equal(f.closes, 1);
  });
}

test("WebSocket endpoint authenticates configuration, accepts PCM, finalizes, and rejects other origins", async (t) => {
  const server = createServer();
  const azure = new FakeRecognitionStream();
  const socketServer = attachDiagnosticSpeechSocket(server, {
    receipts: testReceipts(),
    authorize: async (token) => {
      assert.equal(token, "test-session-token");
      return { user: { id: "learner" }, profile: { role: "student" } };
    },
    createSession: (options) => createDiagnosticSpeechSession({ ...options, createStream: () => azure, log: () => {} }),
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { socketServer.dispose(); await new Promise((resolve) => server.close(resolve)); });
  const url = `ws://127.0.0.1:${server.address().port}/ws/diagnostic/speech`;
  const ws = new WebSocket(url, { origin: "http://localhost:5173" });
  await once(ws, "open");
  const next = () => once(ws, "message").then(([raw]) => JSON.parse(raw));
  let response = next();
  ws.send(JSON.stringify({ type: "configure", accessToken: "test-session-token", language: "en", encoding: "LINEAR16", sampleRate: 16000, channels: 1 }));
  assert.equal((await response).type, "ready");
  ws.send(Buffer.alloc(3200));
  ws.send(JSON.stringify({ type: "stop" }));
  // Let the real transport deliver the messages before the mock Azure drain.
  while (!azure.ended) await new Promise((resolve) => setTimeout(resolve, 5));
  response = next();
  azure.result("hello", true);
  assert.equal((await response).type, "final");
  const closed = once(ws, "close");
  azure.emit("end");
  await closed;
  assert.equal(azure.bytes, 3200);
  assert.equal(azure.destroyed, true);
  const rejected = new WebSocket(url, { origin: "https://unrelated.example" });
  const [error] = await once(rejected, "error");
  assert.match(error.message, /403/);
});

test("WebSocket disconnect during asynchronous authentication does not open Azure", async (t) => {
  const server = createServer();
  let finishAuth;
  let created = 0;
  const socketServer = attachDiagnosticSpeechSocket(server, {
    receipts: testReceipts(),
    authorize: () => new Promise((resolve) => { finishAuth = resolve; }),
    createSession: () => { created++; throw new Error("Should not run"); },
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { socketServer.dispose(); await new Promise((resolve) => server.close(resolve)); });
  const ws = new WebSocket(`ws://127.0.0.1:${server.address().port}/ws/diagnostic/speech`, { origin: "http://localhost:5173" });
  await once(ws, "open");
  ws.send(JSON.stringify({ type: "configure", accessToken: "test", language: "en", encoding: "LINEAR16", sampleRate: 16000, channels: 1 }));
  while (!finishAuth) await new Promise((resolve) => setTimeout(resolve, 5));
  const closed = once(ws, "close"); ws.close(); await closed;
  finishAuth({ user: { id: "test" }, profile: { role: "student" } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(created, 0);
});
