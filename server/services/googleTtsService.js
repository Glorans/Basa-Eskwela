const textToSpeech = require("@google-cloud/text-to-speech");

let textToSpeechClient;
function getTtsClient() { return textToSpeechClient ??= new textToSpeech.TextToSpeechClient(); }

function buildSynthesisRequest(text, languageCode) {
  return {
    input: { text },
    voice: {
      languageCode,
      ssmlGender: "NEUTRAL",
    },
    audioConfig: {
      audioEncoding: "MP3",
    },
  };
}

async function synthesizeSpeech(text, languageCode) {
  const [response] = await getTtsClient().synthesizeSpeech(
    buildSynthesisRequest(text, languageCode),
  );

  if (!response.audioContent) {
    throw new Error("Google Text-to-Speech returned no audio content.");
  }

  return Buffer.isBuffer(response.audioContent)
    ? response.audioContent
    : Buffer.from(response.audioContent);
}

module.exports = {
  buildSynthesisRequest,
  synthesizeSpeech,
};
