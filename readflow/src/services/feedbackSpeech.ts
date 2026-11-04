import { synthesizeDiagnosticSpeech } from "../modules/module2/services/diagnosticTts";
import { createFeedbackSpeechPlayer, type FeedbackSpeechPlayer } from "./feedbackSpeechPlayer";

let shared: FeedbackSpeechPlayer | undefined;

function browserStorage() {
  try { return window.localStorage; } catch { return null; }
}

/** One player for the whole app, so only one feedback clip ever plays at a time. */
export function getFeedbackSpeech(): FeedbackSpeechPlayer {
  shared ??= createFeedbackSpeechPlayer({
    // Only callers that ask for the Philippine voice (M5 feedback) send a voice profile.
    synthesize: (text, language, voice) =>
      synthesizeDiagnosticSpeech(text, language, voice === "philippine" ? { voiceProfile: "philippine" } : {}),
    createAudio: (url) => new Audio(url),
    createObjectURL: (blob) => URL.createObjectURL(blob),
    revokeObjectURL: (url) => URL.revokeObjectURL(url),
    storage: browserStorage(),
  });
  return shared;
}
