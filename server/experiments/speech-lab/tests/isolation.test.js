"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "../../../..");
function sources(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(item => item.isDirectory() ? item.name === "tests" ? [] : sources(path.join(dir, item.name)) : /\.(js|ts|tsx)$/.test(item.name) ? [path.join(dir, item.name)] : []);
}
test("lab dependency boundary excludes production clients, startup and environment access", () => {
  const backend = path.join(root, "server/experiments/speech-lab");
  const frontend = path.join(root, "readflow/src/experiments/speech-lab");
  const allowedPackages = new Set(["express", "multer", "react"]);
  for (const file of [...sources(backend), ...sources(frontend)]) {
    const content = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(content, /process\.env|import\.meta\.env|localStorage|sessionStorage|https:\/\//, file);
    const imports = [...content.matchAll(/(?:require\(\s*|from\s+|import\s*)["']([^"']+)["']/g)].map(m => m[1]);
    for (const spec of imports) {
      if (spec.startsWith(".")) {
        const resolved = path.resolve(path.dirname(file), spec);
        assert.ok(resolved.startsWith(backend + path.sep) || resolved.startsWith(frontend + path.sep), `${file}: ${spec}`);
      } else assert.ok(spec.startsWith("node:") || allowedPackages.has(spec) || spec === "react-dom/client", `${file}: ${spec}`);
    }
  }
});
test("mock execution works with outbound network disabled", async () => {
  const http = require("node:http"), https = require("node:https"), net = require("node:net");
  const originals = [http.request, https.request, net.connect, global.fetch];
  const blocked = () => { throw new Error("Outbound networking forbidden"); };
  http.request = https.request = net.connect = global.fetch = blocked;
  try {
    const { runExperiment } = require("../routes");
    const { tone } = require("../adapters/mock");
    for (const operation of ["transcribe", "synthesize", "assess"]) {
      const r = await runExperiment(operation, { provider: "mock-full", language: "en", text: "A bird rests.", scenario: "complete" }, tone());
      assert.equal(r.simulated, true);
    }
  } finally { [http.request, https.request, net.connect, global.fetch] = originals; }
});
