const assert = require("node:assert/strict");
const test = require("node:test");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { getSpeechErrorResponse } = require("../services/googleSpeechService");
const { createDiagnosticAudioHandler } = require("../routes/diagnosticAudio");
test("missing Google credential path cannot crash service imports", () => {
  const result = spawnSync(process.execPath, ["-e", 'require("./services/googleSpeechService"); require("./services/googleTtsService");'], {
    cwd: path.join(__dirname, ".."), env: { ...process.env, GOOGLE_APPLICATION_CREDENTIALS: path.join(__dirname, "missing-m5-credentials.json") }, encoding: "utf8", timeout: 10000,
  });
  assert.equal(result.status, 0, result.stderr);
});
test("Google credential and provider failures give safe errors and remove temporary audio", async () => {
  for (const error of [new Error("Could not load default credentials"), Object.assign(new Error("provider"), { code: 16 }), new Error("provider failed")]) {
    let deleted = false;
    const res = { status(value) { this.statusCode = value; return this; }, json(body) { this.body = body; return this; } };
    const handler = createDiagnosticAudioHandler({ transcribe: async () => { throw error; }, remove: async () => { deleted = true; }, log: () => {} });
    await handler({ file: { path: "temporary.webm", mimetype: "audio/webm" }, body: { language: "en" } }, res);
    assert.equal(res.body.success, false);
    assert.equal(res.statusCode, getSpeechErrorResponse(error).status);
    assert.ok(deleted);
    assert.doesNotMatch(res.body.message, /default credentials|provider failed/);
  }
});
