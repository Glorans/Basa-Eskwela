"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
// Node fetch normalizes Host; use HTTP directly to test the fixed-port Host policy
// while binding the test server to an ephemeral port.
async function localFetch(url, options = {}) {
  const request = new Request(url, options);
  const body = options.body ? Buffer.from(await request.arrayBuffer()) : undefined;
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: request.method, headers: Object.fromEntries(request.headers) }, res => {
      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, json: async () => JSON.parse(Buffer.concat(chunks).toString()) }));
    });
    req.on("error", reject); req.end(body);
  });
}
let available = true;
try { require.resolve("express"); require.resolve("multer"); } catch { available = false; }
test("HTTP boundary, uploads, errors, and all mock operations", { skip: !available && "Express/Multer are not installed" }, async () => {
  const { createApp } = require("../server");
  const { tone } = require("../adapters/mock");
  const server = createApp().listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/speech-lab`;
  const headers = { Host: "127.0.0.1:5002", "X-Speech-Lab": "1", Origin: "http://127.0.0.1:5174" };
  const fetch = localFetch;
  try {
    assert.equal((await fetch(`${base}/providers`, { headers })).status, 200);
    assert.equal((await fetch(`${base}/providers`, { headers: { ...headers, Origin: "https://example.com" } })).status, 403);
    assert.equal((await fetch(`${base}/providers`, { headers: { ...headers, Host: "example.com" } })).status, 403);
    assert.equal((await fetch(`${base}/transcribe`, { method: "POST", headers: { Host: headers.Host } })).status, 403);
    for (const operation of ["transcribe", "synthesize", "assess"]) {
      const form = new FormData();
      for (const [k,v] of Object.entries({ provider: "mock-full", language: "en", text: "A bird rests.", scenario: "complete" })) form.set(k,v);
      if (operation !== "synthesize") form.set("audio", new Blob([tone()], { type: "audio/wav" }), "test.wav");
      const response = await fetch(`${base}/${operation}`, { method: "POST", headers, body: form });
      assert.equal(response.status, 200); assert.equal((await response.json()).simulated, true);
    }
    const invalid = await fetch(`${base}/transcribe`, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ provider: "mock-full", language: "en", text: "test", scenario: "complete" }) });
    assert.equal(invalid.status, 400);
    const form = new FormData();
    for (const [k,v] of Object.entries({ provider: "mock-full", language: "en", text: "A bird rests.", scenario: "complete" })) form.set(k,v);
    form.set("audio", new Blob([Buffer.alloc(10 * 1024 * 1024 + 1)]), "oversized.wav");
    assert.equal((await fetch(`${base}/transcribe`, { method: "POST", headers, body: form })).status, 413);
    form.set("audio", new Blob([tone()]), "test.wav");
    form.set("provider", "google");
    assert.equal((await fetch(`${base}/transcribe`, { method: "POST", headers, body: form })).status, 422);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
