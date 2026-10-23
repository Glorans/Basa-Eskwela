const assert = require("node:assert/strict");
const test = require("node:test");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { getSpeechErrorResponse, SpeechConfigurationError, SpeechTranscriptionError } = require("../services/speechErrors");
const { createDiagnosticAudioHandler } = require("../routes/diagnosticAudio");

const serverDirectory = path.join(__dirname, "..");
// Child processes start from the backend without any speech or database credentials.
function cleanEnv() {
  const env = { ...process.env };
  for (const name of Object.keys(env)) {
    if (/^(AZURE_|GOOGLE_|SUPABASE_|DOTENV_|DIAGNOSTIC_RECEIPT_SECRET|GEMINI_)/.test(name)) delete env[name];
  }
  return { ...env, M7_RISK_WORKER_ENABLED: "false", DOTENV_PATH: path.join(__dirname, "missing-test.env") };
}

test("missing Azure credentials cannot crash service imports", () => {
  const result = spawnSync(process.execPath, ["-e",
    'require("./services/azureSpeechService"); require("./services/azureSpeechConfig"); require("./routes/speech"); require("./routes/diagnosticAudio");'], {
    cwd: serverDirectory, env: cleanEnv(), encoding: "utf8", timeout: 20000,
  });
  assert.equal(result.status, 0, result.stderr);
});

test("the backend starts and serves health without Google or Azure credentials", () => {
  const script = 'const { startServer } = require("./server"); const server = startServer(0);'
    + ' server.on("listening", async () => { const res = await fetch(`http://127.0.0.1:${server.address().port}/api/health`);'
    + ' console.log(res.status); server.closeDiagnosticSpeech(); server.close(() => process.exit(0)); });';
  const result = spawnSync(process.execPath, ["-e", script], { cwd: serverDirectory, env: cleanEnv(), encoding: "utf8", timeout: 30000 });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^200$/m);
});

test("no backend source depends on Google speech packages or credentials", () => {
  const result = spawnSync("git", ["grep", "-n", "-E", "@google-cloud/(speech|text-to-speech)|GOOGLE_APPLICATION_CREDENTIALS|GOOGLE_STT", "--",
    "server.js", "routes", "services"], { cwd: serverDirectory, encoding: "utf8" });
  assert.equal(result.stdout, "", result.stdout);
});

test("configuration, credential and provider failures give safe errors and remove temporary audio", async () => {
  const failures = [
    [new SpeechConfigurationError(), 503, "SPEECH_NOT_CONFIGURED"],
    [new SpeechTranscriptionError("STT_PERMISSION"), 503, "STT_PERMISSION"],
    [new Error("Could not load key 1234 for region"), 502, "STT_PROVIDER_ERROR"],
  ];
  for (const [error, status, code] of failures) {
    let deleted = false;
    const res = { status(value) { this.statusCode = value; return this; }, json(body) { this.body = body; return this; } };
    const handler = createDiagnosticAudioHandler({ transcribe: async () => { throw error; }, remove: async () => { deleted = true; }, log: () => {} });
    await handler({ file: { path: "temporary.wav", mimetype: "audio/wav" }, body: { language: "en" } }, res);
    assert.equal(res.body.success, false);
    assert.equal(res.statusCode, status);
    assert.equal(res.statusCode, getSpeechErrorResponse(error).status);
    assert.equal(res.body.code, code);
    assert.ok(deleted);
    assert.doesNotMatch(res.body.message, /1234|region|key/);
  }
});
