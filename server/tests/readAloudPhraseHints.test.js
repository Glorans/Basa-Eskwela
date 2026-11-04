// M5 phrase list of story names for speech-to-text. Fake SDK and fake provider only:
// no Azure resource or request is involved.
const assert = require("node:assert/strict");
const test = require("node:test");
const { mkdtemp, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const express = require("express");
const { createSpeechRouter } = require("../routes/speech");
const { parsePhraseHints, MAX_PHRASE_HINTS } = require("../routes/readAloudAudio");
const { transcribeWav, PHRASE_LIST_WEIGHT } = require("../services/azureSpeechService");

const ENV = Object.freeze({ AZURE_SPEECH_KEY: "a".repeat(84), AZURE_SPEECH_REGION: "southeastasia" });

function wav(seconds) {
  const dataBytes = Math.round(seconds * 16000) * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write("RIFF", 0, "ascii"); buffer.writeUInt32LE(36 + dataBytes, 4); buffer.write("WAVEfmt ", 8, "ascii");
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(16000, 24); buffer.writeUInt32LE(32000, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii"); buffer.writeUInt32LE(dataBytes, 40);
  return buffer;
}

/** Fake SDK 1.52 recognizer that records phrase-list calls and when recognition started. */
function fakeSdk() {
  const events = [];
  const sdk = {
    ResultReason: { RecognizedSpeech: 3 },
    CancellationReason: { Error: 0, EndOfStream: 1 },
    CancellationErrorCode: {},
    OutputFormat: { Detailed: 1 },
    PropertyId: { SpeechServiceResponse_JsonResult: "json" },
    SpeechConfig: { fromSubscription: () => ({ setProperty() {} }) },
    AudioStreamFormat: { getWaveFormatPCM: () => ({}) },
    AudioInputStream: { createPushStream: () => ({ write() {}, close() {} }) },
    AudioConfig: { fromStreamInput: () => ({ turnOff: async () => {} }) },
    PhraseListGrammar: {
      fromRecognizer(recognizer) {
        events.push(["fromRecognizer", recognizer.id]);
        return {
          addPhrases: (phrases) => events.push(["addPhrases", [...phrases]]),
          addPhrase: (phrase) => events.push(["addPhrase", phrase]),
          setWeight: (weight) => events.push(["setWeight", weight]),
        };
      },
    },
    SpeechRecognizer: class {
      static enableTelemetry() {}
      constructor() { this.id = "recognizer-1"; }
      startContinuousRecognitionAsync(ok) {
        events.push(["start"]);
        setImmediate(() => {
          ok();
          this.recognized?.(this, { result: { reason: 3, text: "Ben visited Mrs. Santos", properties: { getProperty: () => "{}" } } });
          this.sessionStopped?.(this, {});
        });
      }
      close(ok) { ok(); }
    },
  };
  return { events, sdkFactory: () => sdk };
}

test("only a few valid story names are accepted as phrase hints; anything else is dropped", () => {
  assert.deepEqual(parsePhraseHints("Santos"), ["Santos"]);
  assert.deepEqual(parsePhraseHints(["Santos", "Santos", "Lina", "O'Brien", "Jean-Luc", "Peña"]), ["Santos", "Lina", "O'Brien", "Jean-Luc", "Peña"]);
  // Not names: lowercase story words, numbers, sentences, markup, very long or one-letter values.
  assert.deepEqual(parsePhraseHints(["were", "the", "123", "Ben visited", "<b>", "A", "X".repeat(31), "", { a: 1 }, null]), []);
  assert.deepEqual(parsePhraseHints(undefined), []);
  const many = Array.from({ length: 25 }, (_, index) => `Name${String.fromCharCode(97 + index)}`);
  assert.equal(parsePhraseHints(many).length, MAX_PHRASE_HINTS);
});

test("English recognition adds the names as a phrase list at the default weight, before recognition starts", async () => {
  const { events, sdkFactory } = fakeSdk();
  const result = await transcribeWav("reading.wav", "en-US", {
    sdkFactory, env: ENV, readFile: async () => wav(5), log() {}, wholeRecording: true, phrases: ["Santos"],
  });
  assert.equal(result.text, "Ben visited Mrs. Santos");
  assert.deepEqual(events, [["fromRecognizer", "recognizer-1"], ["addPhrases", ["Santos"]], ["setWeight", 1], ["start"]]);
  assert.equal(PHRASE_LIST_WEIGHT, 1, "Microsoft's default weight: no extra boost");
});

test("no phrase list without names, for Filipino, or for Module 2 parts", async () => {
  for (const [locale, options] of [["en-US", {}], ["en-US", { phrases: [] }], ["fil-PH", { phrases: ["Santos"] }]]) {
    const { events, sdkFactory } = fakeSdk();
    await transcribeWav("reading.wav", locale, { sdkFactory, env: ENV, readFile: async () => wav(5), log() {}, wholeRecording: true, ...options });
    assert.deepEqual(events, [["start"]], `${locale} ${JSON.stringify(options)}`);
  }
});

test("the read-aloud endpoint passes English story names from the query, ignores bad ones, and never needs them", async () => {
  const uploadDirectory = await mkdtemp(path.join(tmpdir(), "readflow-phrases-"));
  const calls = [];
  const app = express();
  app.use(createSpeechRouter({
    uploadDirectory,
    authorize: async () => ({ user: { id: "student-1" }, profile: { role: "student" } }),
    rateLimits: { stt: { limit: 100, windowMs: 60000 }, tts: { limit: 100, windowMs: 60000 } },
    transcribe: async (file, languageCode, options) => { calls.push({ languageCode, options }); return { text: "Ben visited Mrs. Santos" }; },
    log() {},
  }));
  const server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const post = (query, language = "en", fields = {}) => {
    const form = new FormData();
    form.append("audio", new Blob([wav(1)], { type: "audio/wav" }), "reading.wav");
    form.append("language", language);
    for (const [name, value] of Object.entries(fields)) form.append(name, value);
    return fetch(`http://127.0.0.1:${server.address().port}/api/read-aloud/audio${query}`, {
      method: "POST", headers: { Authorization: "Bearer student" }, body: form,
    });
  };
  try {
    assert.equal((await post("?name=Santos&name=Lina&name=were&name=%3Cb%3E")).status, 200);
    assert.deepEqual(calls.at(-1).options.phrases, ["Santos", "Lina"]);
    assert.equal((await post("")).status, 200);
    assert.equal("phrases" in calls.at(-1).options, false, "without names nothing changes");
    assert.equal((await post("?name=Santos", "fil")).status, 200);
    assert.equal("phrases" in calls.at(-1).options, false, "Filipino is unchanged");
    // The form itself still accepts only the language field.
    assert.equal((await post("", "en", { name: "Santos" })).status, 400);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(uploadDirectory, { recursive: true, force: true });
  }
});
