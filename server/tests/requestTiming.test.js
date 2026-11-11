// Server-Timing instrumentation: durations only, added to M6/M7/Teacher reading responses (success and
// error), never replacing a route's own Server-Timing. No network beyond a local test server.
const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { recordAuthMs, requestTiming } = require("../services/requestTiming");

async function serve(t, app) {
  const server = app.listen(0, "127.0.0.1");
  t.after(() => server.close());
  await new Promise((resolve) => server.once("listening", resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

test("responses carry auth and total server time, and nothing else", async (t) => {
  const app = express();
  app.use("/api/comprehension", requestTiming);
  app.get("/api/comprehension/ok", async (req, res) => { recordAuthMs(12.34); await new Promise((r) => setTimeout(r, 5)); res.json({ ok: true }); });
  app.get("/api/comprehension/denied", (req, res) => { recordAuthMs(3); res.status(401).json({ success: false }); });
  const base = await serve(t, app);
  for (const [path, status] of [["/api/comprehension/ok", 200], ["/api/comprehension/denied", 401]]) {
    const response = await fetch(base + path, { headers: { Authorization: "Bearer secret-token-value" } });
    assert.equal(response.status, status);
    const header = response.headers.get("server-timing");
    assert.match(header, /^auth;dur=\d+\.\d, app;dur=\d+\.\d$/);
    assert.doesNotMatch(header, /secret|Bearer/);
  }
  const ok = (await fetch(`${base}/api/comprehension/ok`)).headers.get("server-timing");
  assert.equal(ok.split(", ")[0], "auth;dur=12.3");
  assert.ok(Number(ok.split("app;dur=")[1]) >= 5);
});

test("a route's own Server-Timing is kept, and untimed routes get none", async (t) => {
  const app = express();
  app.use("/api/oral-reading", requestTiming);
  app.post("/api/oral-reading/check", (req, res) => { res.set("Server-Timing", "checks;dur=1, assessment;dur=2"); res.json({}); });
  app.get("/api/other", (req, res) => res.json({}));
  const base = await serve(t, app);
  assert.equal((await fetch(`${base}/api/oral-reading/check`, { method: "POST" })).headers.get("server-timing"), "checks;dur=1, assessment;dur=2");
  assert.equal((await fetch(`${base}/api/other`)).headers.get("server-timing"), null);
});

test("recording auth time outside a timed request is a no-op", () => {
  assert.doesNotThrow(() => recordAuthMs(5));
});
