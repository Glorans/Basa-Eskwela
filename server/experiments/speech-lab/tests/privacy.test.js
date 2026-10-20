"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
test("JSON export uses an allowlist and omits secrets and audio while retaining provenance", () => {
  const { exportPayload } = require("../../../../readflow/src/experiments/speech-lab/resultExport.ts");
  const sentinel = "PRIVATE_TEST_CREDENTIAL_SENTINEL";
  const rows = [true, false].map(simulated => ({ simulated, language: "en", label: simulated ? "SIMULATED" : "REAL AZURE", provider: simulated ? "mock-full" : "azure", key: sentinel, config: { key: sentinel }, audioBase64: sentinel, timings: { providerMs: 10 }, warnings: [] }));
  const payload = exportPayload(rows, "en");
  assert.equal(payload.results.length, 2); assert.deepEqual(payload.results.map(r => r.simulated), [true, false]);
  assert.ok(!JSON.stringify(payload).includes(sentinel)); assert.equal(exportPayload(rows, "fil").results.length, 0);
});
test("frontend source cannot load backend credentials or SDK; config file is ignored", () => {
  const root = path.resolve(__dirname, "../../../..");
  const front = path.join(root, "readflow/src/experiments/speech-lab");
  for (const file of fs.readdirSync(front).filter(name => /\.(ts|tsx)$/.test(name))) {
    const source = fs.readFileSync(path.join(front, file), "utf8");
    assert.doesNotMatch(source, /SPEECH_LAB_AZURE_KEY|fromSubscription|microsoft-cognitiveservices-speech-sdk|process\.env|import\.meta\.env/);
  }
  assert.match(fs.readFileSync(path.join(root, ".gitignore"), "utf8"), /^\.env\.\*$/m);
  const backend = path.join(root, "server/experiments/speech-lab");
  for (const file of ["azureConfig.js", "azureResults.js", "usageLimits.js", "adapters/azure.js"]) assert.doesNotMatch(fs.readFileSync(path.join(backend, file), "utf8"), /console\.|process\.env/);
});
