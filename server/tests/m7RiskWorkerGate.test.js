const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");
const { isRiskWorkerEnabled, startRiskWorker } = require("../services/m7RiskWorker");

test("the M7 risk worker is off unless explicitly enabled", () => {
  assert.equal(isRiskWorkerEnabled({}), false);
  for (const value of ["false", "1", "TRUE", "yes", " true"]) assert.equal(isRiskWorkerEnabled({ M7_RISK_WORKER_ENABLED: value }), false);
  assert.equal(isRiskWorkerEnabled({ M7_RISK_WORKER_ENABLED: "true" }), true);
});

test("a disabled worker starts no polling and touches no database", () => {
  const originalSetInterval = global.setInterval;
  let intervals = 0;
  global.setInterval = (...args) => { intervals++; return originalSetInterval(...args); };
  try {
    const stop = startRiskWorker({});
    assert.equal(typeof stop, "function");
    stop();
  } finally {
    global.setInterval = originalSetInterval;
  }
  assert.equal(intervals, 0);
});

test("server start-up and M6 quiz completion both respect the gate", async () => {
  const root = path.join(__dirname, "..");
  const [server, action] = await Promise.all([
    readFile(path.join(root, "server.js"), "utf8"),
    readFile(path.join(root, "services", "comprehensionActionService.js"), "utf8"),
  ]);
  assert.match(server, /require\("\.\/services\/m7RiskWorker"\)\.startRiskWorker\(\)/);
  assert.match(action, /if \(riskWorker\.isRiskWorkerEnabled\(\)\) void riskWorker\.drainRiskQueue\(\);/);
});
