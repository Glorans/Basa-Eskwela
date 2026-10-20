"use strict";
// Isolated launcher: no production startup, machine env or application credentials.
const express = require("express");
const multer = require("multer");
const { LIMITS, LabError } = require("./contracts");
const { createRegistry } = require("./providerRegistry");
const { loadAzureConfig } = require("./azureConfig");
const { runExperiment } = require("./routes");

function createApp({ registry = createRegistry(loadAzureConfig()) } = {}) {
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
  app.get("/api/speech-lab/providers", (_req, res) => res.json({ providers: registry.listProviders(), limits: LIMITS }));
  let busy = false;
  app.post("/api/speech-lab/:operation", (req, res, next) => {
    if (busy) return res.status(429).json({ error: { code: "LAB_BUSY", message: "One experiment at a time; retry after it finishes." } });
    busy = true;
    // Release after the adapter has actually disposed its resources, not on disconnect.
    let released = false;
    const uploadDeadline = setTimeout(() => { if (!req.labProcessing) { res.status(408).json({ error: { code: "UPLOAD_TIMEOUT", message: "Audio upload timed out." } }); req.destroy(); } }, 15000);
    const disconnectUpload = () => { if (!req.labProcessing) req.labRelease(); };
    res.once("close", disconnectUpload);
    req.labRelease = () => { if (released) return; released = true; clearTimeout(uploadDeadline); res.removeListener("close", disconnectUpload); busy = false; };
    req.labUploaded = () => { req.labProcessing = true; clearTimeout(uploadDeadline); };
    next();
  }, upload.single("audio"), async (req, res, next) => {
    req.labUploaded();
    const controller = new AbortController();
    const cancel = () => controller.abort();
    req.once("aborted", cancel);
    res.once("close", cancel);
    const timer = setTimeout(cancel, req.body?.provider === "azure" ? 65000 : 15000);
    if (req.aborted || res.destroyed) cancel();
    try { const result = await runExperiment(req.params.operation, req.body, req.file?.buffer, controller.signal, registry); if (!res.destroyed) res.json(result); }
    catch (error) { if (!res.destroyed) next(error); }
    finally { clearTimeout(timer); req.removeListener("aborted", cancel); res.removeListener("close", cancel); if (req.file) req.file.buffer = undefined; req.labRelease?.(); }
  });
  app.use((_req, res) => res.status(404).json({ error: { code: "NOT_FOUND", message: "Speech Lab endpoint not found." } }));
  app.use((error, _req, res, _next) => {
    const tooLarge = error.code === "LIMIT_FILE_SIZE" || error.type === "entity.too.large";
    _req.labRelease?.();
    const known = error instanceof LabError;
    res.status(tooLarge ? 413 : known ? error.status : error.name === "AbortError" ? 408 : 400).json({ error: { code: tooLarge ? "AUDIO_TOO_LARGE" : known ? error.code : "REQUEST_FAILED", message: tooLarge ? "Upload exceeds the allowed size." : known ? error.message : "Request failed or was cancelled. Check the input and try again." } });
  });
  return app;
}
if (require.main === module) createApp().listen(5002, "127.0.0.1", () => console.log("Speech Lab API: http://127.0.0.1:5002 (Azure disabled unless explicitly configured)"));
module.exports = { createApp };
