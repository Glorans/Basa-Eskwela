const assert = require("node:assert/strict");
const test = require("node:test");
const { mkdtemp, writeFile, access, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { createDiagnosticAudioHandler } = require("../routes/diagnosticAudio");

for (const [language, languageCode] of [["en", "en-US"], ["fil", "fil-PH"]]) {
  test(`M2 synchronous fallback forwards ${language} as Azure locale ${languageCode}`, async () => {
    let called = false;
    let removed = false;
    const handler = createDiagnosticAudioHandler({
      transcribe: async (file, locale) => {
        called = true;
        assert.equal(file, "diagnostic.wav");
        assert.equal(locale, languageCode);
        return { text: "unaltered provider transcript" };
      },
      remove: async () => { removed = true; },
    });
    const res = { status() { return this; }, json(body) {
      assert.equal(body.success, true);
      assert.equal(body.transcription.text, "unaltered provider transcript");
    } };
    await handler({ file: { path: "diagnostic.wav", mimetype: "audio/wav" }, body: { language } }, res);
    assert.equal(called, true);
    assert.equal(removed, true);
  });
}

for (const scenario of ["success", "azure-failure", "no-speech", "invalid-language", "invalid-format", "upload-failure"]) {
  test(`M2 temporary upload is removed after ${scenario}, preserving other recordings`, async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "readflow-m2-cleanup-"));
    const temporary = path.join(directory, "diagnostic.wav");
    const retained = path.join(directory, "m4.webm");
    await writeFile(temporary, "test"); await writeFile(retained, "retained");
    const res = { code: 200, body: null, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    try {
      const handler = createDiagnosticAudioHandler({ log() {}, transcribe: async (_file, locale) => {
        assert.equal(locale, "en-US");
        if (scenario === "azure-failure") throw new Error("Provider unavailable");
        return { text: scenario === "no-speech" ? "" : "one day" };
      } });
      await handler({ file: { path: temporary, mimetype: scenario === "invalid-format" ? "audio/webm" : "audio/wav" }, body: { language: scenario === "invalid-language" ? "invalid" : "en" } }, res, scenario === "upload-failure" ? new Error("upload") : undefined);
      await assert.rejects(access(temporary));
      await access(retained);
      assert.equal(res.body.success, scenario === "success");
      assert.doesNotMatch(JSON.stringify(res.body), /diagnostic\.wav|filename|path/);
    } finally { await rm(directory, { recursive: true }); }
  });
}
