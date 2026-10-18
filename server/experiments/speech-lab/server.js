"use strict";
// Deliberately no dotenv, cloud clients, authentication, or application startup imports.
const express = require("express");
const multer = require("multer");
const { LIMITS } = require("./contracts");
const { listProviders } = require("./providerRegistry");
const { runExperiment } = require("./routes");

function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    const hosts = ["127.0.0.1:5002", "localhost:5002"];
    const origins = ["http://127.0.0.1:5174", "http://localhost:5174"];
    if (!hosts.includes(req.headers.host) || (req.headers.origin && !origins.includes(req.headers.origin))) return res.status(403).json({ error: { code: "LOCAL_ONLY", message: "Speech Lab accepts local requests only." } });
    if (req.method !== "GET" && req.get("X-Speech-Lab") !== "1") return res.status(403).json({ error: { code: "LAB_HEADER_REQUIRED", message: "Use the Speech Lab interface." } });
    next();
  });
  app.use(express.json({ limit: "32kb" }));
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: LIMITS.maxAudioBytes, files: 1, fields: 4, fieldSize: 20000, parts: 5 } });
  app.get("/api/speech-lab/providers", (_req, res) => res.json({ providers: listProviders(), limits: LIMITS }));
  let busy = false;
  app.post("/api/speech-lab/:operation", (req, res, next) => {
    if (busy) return res.status(429).json({ error: { code: "LAB_BUSY", message: "One experiment at a time; retry after it finishes." } });
    busy = true;
    res.once("close", () => { busy = false; });
    next();
  }, upload.single("audio"), async (req, res, next) => {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    req.once("aborted", cancel);
    res.once("close", cancel);
    const timer = setTimeout(cancel, 15000);
    try { const result = await runExperiment(req.params.operation, req.body, req.file?.buffer, controller.signal); if (!res.destroyed) res.json(result); }
    catch (error) { if (!res.destroyed) next(error); }
    finally { clearTimeout(timer); req.removeListener("aborted", cancel); res.removeListener("close", cancel); if (req.file) req.file.buffer = undefined; }
  });
  app.use((_req, res) => res.status(404).json({ error: { code: "NOT_FOUND", message: "Speech Lab endpoint not found." } }));
  app.use((error, _req, res, _next) => {
    const tooLarge = error.code === "LIMIT_FILE_SIZE" || error.type === "entity.too.large";
    const known = error.status && error.code;
    res.status(tooLarge ? 413 : known ? error.status : error.name === "AbortError" ? 408 : 400).json({ simulated: true, error: { code: tooLarge ? "AUDIO_TOO_LARGE" : known ? error.code : "REQUEST_FAILED", message: tooLarge ? "Upload exceeds the allowed size." : known ? error.message : "Request failed or was cancelled. Check the input and try again." } });
  });
  return app;
}
if (require.main === module) createApp().listen(5002, "127.0.0.1", () => console.log("SIMULATED Speech Lab API: http://127.0.0.1:5002 (no cloud services)"));
module.exports = { createApp };
