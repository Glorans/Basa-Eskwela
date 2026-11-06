import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { after, test } from "node:test";

// The real M5 transcription client; only the axios instance and session reader are replaced.
const globals = globalThis as typeof globalThis & { __contextApi?: unknown };
globals.__contextApi = {};
const serviceUrl = new URL("../src/modules/module5/services/oralReadingTranscription.ts", import.meta.url).href;
const errorUrl = new URL("../src/modules/module2/services/diagnosticAudioError.ts", import.meta.url).href;
const speechWavUrl = new URL("../src/modules/module2/services/speechWav.ts", import.meta.url).href;
const fake = (source: string) => `data:text/javascript,${encodeURIComponent(source)}`;
const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  if (context.parentURL === serviceUrl) {
    if (specifier.endsWith("/services/api")) return { url: fake("export default globalThis.__contextApi;"), shortCircuit: true };
    if (specifier.endsWith("/services/authHeaders")) return { url: fake("export const getSessionAuthHeaders = async () => ({});"), shortCircuit: true };
    if (specifier.endsWith("/diagnosticAudioError")) return { url: errorUrl, shortCircuit: true };
    if (specifier.endsWith("/speechWav")) return { url: speechWavUrl, shortCircuit: true };
  }
  return nextResolve(specifier, context);
} });
const { readAloudAudioUrl, transcribeOralReadingRecording } = await import(serviceUrl) as typeof import("../src/modules/module5/services/oralReadingTranscription.ts");
after(() => { hooks.deregister(); delete globals.__contextApi; });

const MODULE = "11111111-1111-4111-8111-111111111111";
const SUBMISSION = "44444444-4444-4444-8444-444444444444";

test("the upload names its reading in the query string, next to story names", () => {
  const url = new URL(readAloudAudioUrl(["Santos"], { moduleId: MODULE, passageId: null, submissionId: SUBMISSION }), "http://x");
  assert.equal(url.pathname, "/api/read-aloud/audio");
  assert.equal(url.searchParams.get("name"), "Santos");
  assert.equal(url.searchParams.get("moduleId"), MODULE);
  assert.equal(url.searchParams.get("submissionId"), SUBMISSION);
  assert.equal(url.searchParams.has("passageId"), false, "empty IDs are left out");
});

test("without a context the URL is exactly what it was", () => {
  assert.equal(readAloudAudioUrl(), "/api/read-aloud/audio");
  assert.equal(readAloudAudioUrl(["Santos"]), "/api/read-aloud/audio?name=Santos");
});

test("the transcription call passes the reading context, in both languages, and no form field is added", async () => {
  for (const language of ["en", "fil"] as const) {
    const calls: { form: FormData; names?: readonly string[]; context?: unknown }[] = [];
    const result = await transcribeOralReadingRecording(new Blob(["x"]), language, {
      recordingDurationSeconds: 1,
      storyNames: ["Santos"],
      readingContext: { moduleId: MODULE, submissionId: SUBMISSION },
      convert: async (audio) => audio,
      post: async (form, _config, names, context) => {
        calls.push({ form, names, context });
        return { data: { success: true, transcription: { text: "Words", confidence: 0.9 } } } as never;
      },
    });
    assert.equal(result.text, "Words");
    assert.deepEqual(calls[0].context, { moduleId: MODULE, submissionId: SUBMISSION });
    assert.deepEqual([...calls[0].form.keys()].sort(), ["audio", "language"], "the server refuses unknown form fields");
  }
});

test("the page sends the same submission ID with the upload and the save", () => {
  const page = readFileSync(new URL("../src/pages/reading-activity/ReadAloudPage.tsx", import.meta.url), "utf8");
  assert.match(page, /const submissionId = crypto\.randomUUID\(\);/);
  assert.equal(page.match(/crypto\.randomUUID\(\)/g)?.length, 1, "one ID per reading");
  assert.match(page, /submissionId,\s+expectedText: module\.passage/);
  assert.match(page, /readingContext: \{[\s\S]*?submissionId,\s+\}/);
});
