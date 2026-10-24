import { useState } from "react";
import { Mic } from "lucide-react";
import { convertToSpeechWavParts } from "../../module2/services/speechWav";
import {
  assessOralReadingPronunciationPart,
  getOralReadingRecording,
} from "../services/oralReadingService";
import {
  assessRecordingPronunciation,
  type PronunciationSummary,
} from "../services/pronunciationSummary";

interface PronunciationFeedbackProps {
  attemptId: string;
  language: "en" | "fil";
}

async function fetchAudio(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Recording could not be loaded.");
  return response.blob();
}

/** Plain-language meaning of a 0-100 pronunciation score for young readers. */
export function pronunciationMessage(accuracy: number) {
  if (accuracy >= 85) return "Your words sounded very clear!";
  if (accuracy >= 70) return "Most of your words sounded clear. Practice the words below.";
  return "Some words need more practice. Listen to them and say them slowly.";
}

/**
 * English only: on request, sends the saved recording, in parts, to Azure
 * Pronunciation Assessment. Filipino readings keep transcript-based reading
 * accuracy only; no Azure pronunciation score exists for them.
 */
export default function PronunciationFeedback({ attemptId, language }: PronunciationFeedbackProps) {
  const [status, setStatus] = useState<"idle" | "checking" | "done" | "error">("idle");
  const [summary, setSummary] = useState<PronunciationSummary>();
  const [error, setError] = useState<string>();

  if (language !== "en") return null;

  const check = async () => {
    setStatus("checking");
    setError(undefined);
    try {
      setSummary(await assessRecordingPronunciation(attemptId, {
        loadRecording: (id) => getOralReadingRecording(id),
        fetchAudio,
        convert: convertToSpeechWavParts,
        assessPart: assessOralReadingPronunciationPart,
      }));
      setStatus("done");
    } catch (failure) {
      setError(failure instanceof Error && failure.message.length <= 300
        ? failure.message
        : "Pronunciation feedback is unavailable right now. Please try again.");
      setStatus("error");
    }
  };

  return (
    <section className="result-feedback-card" aria-labelledby="azure-pronunciation-title">
      <h3 id="azure-pronunciation-title"><Mic size={22} aria-hidden="true" />Pronunciation Check</h3>
      <p className="result-feedback-note">
        Basa-Eskwela listens to your saved recording and checks how clearly you said each word.
        This is separate from your reading accuracy, which compares the words we heard with the story.
      </p>
      {status !== "done" && (
        <button
          type="button"
          className="result-feedback-listen"
          onClick={() => void check()}
          disabled={status === "checking"}
          aria-busy={status === "checking"}
        >
          {status === "checking" ? "Checking your pronunciation…" : status === "error" ? "Try again" : "Check my pronunciation"}
        </button>
      )}
      {status === "error" && error && <p className="result-feedback-note" role="alert">{error}</p>}
      {status === "done" && summary && (summary.utterances === 0 ? (
        <p className="result-feedback-message">We couldn't hear enough speech to check pronunciation. Try reading again a little louder.</p>
      ) : (
        <div role="status">
          {summary.accuracy !== null ? (
            <>
              <p>Pronunciation accuracy: <strong>{summary.accuracy}/100</strong></p>
              <p className="result-feedback-message">{pronunciationMessage(summary.accuracy)}</p>
            </>
          ) : (
            <p className="result-feedback-note">A pronunciation score is not available for this reading.</p>
          )}
          {summary.fluency !== null && (
            <p>Fluency: <strong>{summary.fluency}/100</strong></p>
          )}
          <p className="result-feedback-note">
            Checked across {summary.utterances} spoken {summary.utterances === 1 ? "phrase" : "phrases"}.
          </p>
          {summary.wordsToPractice.length > 0 ? (
            <>
              <p>Words that need clearer pronunciation:</p>
              <ul className="result-feedback-words">
                {summary.wordsToPractice.map((word) => <li key={word} className="result-feedback-word"><span>{word}</span></li>)}
              </ul>
              <p className="result-feedback-note">Listen to the word, say it slowly, and try reading it again.</p>
            </>
          ) : (
            <p className="result-feedback-message">Every word sounded clear. Amazing!</p>
          )}
        </div>
      ))}
    </section>
  );
}
