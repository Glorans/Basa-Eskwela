const assert = require("node:assert/strict");
const test = require("node:test");
const {
  getGoogleSpeechLanguageCode,
  UnsupportedDiagnosticLanguageError,
} = require("../services/diagnosticLanguage");
const {
  buildRecognitionRequest,
  getSpeechErrorResponse,
  mapGoogleSpeechError,
} = require("../services/googleSpeechService");
const {
  buildSynthesisRequest,
} = require("../services/googleTtsService");

test("maps application languages to supported Google language codes", () => {
  assert.equal(getGoogleSpeechLanguageCode("en"), "en-US");
  assert.equal(getGoogleSpeechLanguageCode("fil"), "fil-PH");
});

test("rejects missing, unknown, and direct Google language codes", () => {
  for (const language of [undefined, "", "tl", "en-US", "fil-PH"]) {
    assert.throws(
      () => getGoogleSpeechLanguageCode(language),
      UnsupportedDiagnosticLanguageError,
    );
  }
});

test("synchronous STT uses latest_long for English and preserves Filipino configuration", () => {
  const audioBuffer = Buffer.from("deterministic-test-audio");

  for (const language of ["en", "fil"]) {
    const languageCode = getGoogleSpeechLanguageCode(language);
    const request = buildRecognitionRequest(audioBuffer, languageCode);

    assert.deepEqual(request.config, {
      encoding: "WEBM_OPUS",
      sampleRateHertz: 48000,
      languageCode,
      enableAutomaticPunctuation: true,
      ...(language === "en" ? { model: "latest_long" } : {}),
    });
    assert.equal(request.audio.content, audioBuffer.toString("base64"));
  }
});

test("maps Google STT failures to stable safe codes", () => {
  const cases = [
    [{ code: 3, message: "bad encoding" }, "STT_INVALID_AUDIO"],
    [{ code: 4, message: "deadline" }, "STT_DEADLINE"],
    [{ code: 8, message: "quota" }, "STT_QUOTA"],
    [{ code: 7, message: "permission" }, "STT_PERMISSION"],
    [{ code: 16, message: "authentication" }, "STT_PERMISSION"],
    [{ code: 13, message: "provider detail" }, "STT_PROVIDER_ERROR"],
  ];

  for (const [providerError, expectedCode] of cases) {
    assert.equal(mapGoogleSpeechError(providerError).code, expectedCode);
  }
});

test("recognizes length failures before generic INVALID_ARGUMENT mapping", () => {
  const mapped = mapGoogleSpeechError({
    code: 3,
    message: "Sync input too long. For audio longer than 1 min use async recognition.",
  });

  assert.equal(mapped.code, "AUDIO_TOO_LONG");
});

test("returns only stable safe client error details", () => {
  const response = getSpeechErrorResponse({
    code: 13,
    message: "private provider implementation detail",
  });

  assert.deepEqual(response, {
    code: "STT_PROVIDER_ERROR",
    status: 502,
    message: "Unable to process the recording. Please try again.",
  });
  assert.equal(response.message.includes("private provider"), false);
});

test("puts the mapped language in Google TTS synthesis requests", () => {
  for (const language of ["en", "fil"]) {
    const languageCode = getGoogleSpeechLanguageCode(language);
    const request = buildSynthesisRequest("test phrase", languageCode);

    assert.equal(request.voice.languageCode, languageCode);
    assert.equal(request.voice.ssmlGender, "NEUTRAL");
    assert.equal(request.audioConfig.audioEncoding, "MP3");
  }
});
