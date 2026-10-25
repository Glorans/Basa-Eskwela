import { useEffect, useRef, useState } from "react";
import { Mic } from "lucide-react";
import { convertToSpeechWavRecording } from "../../module2/services/speechWav";
import { getOralReadingRecording } from "../services/oralReadingService";
import { assessOralReadingPronunciation } from "../services/oralReadingTranscription";
import {
  assessRecordingPronunciation,
  type PronunciationCheckStep,
  type PronunciationSummary,
} from "../services/pronunciationSummary";

interface PronunciationFeedbackProps {
  attemptId: string;
  language: "en" | "fil";
}

async function fetchAudio(url: string, signal?: AbortSignal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error("Recording could not be loaded.");
  return response.blob();
}

const STEP_MESSAGES: Record<PronunciationCheckStep, string> = {
  loading: "Loading your recording…",
  preparing: "Preparing your recording…",
  uploading: "Sending your recording…",
  assessing: "Checking your pronunciation…",
};

/** Plain-language meaning of a 0-100 pronunciation score for young readers. */
export function pronunciationMessage(accuracy: number) {
  if (accuracy >= 85) return "Your words sounded very clear!";
  if (accuracy >= 70) return "Most of your words sounded clear. Practice the words below.";
  return "Some words need more practice. Listen to them and say them slowly.";
}

/**
 * English only: on request, sends the whole saved recording to Azure
 * Pronunciation Assessment in one session. Filipino readings keep
 * transcript-based reading accuracy only; no Azure pronunciation score exists
 * for them. Only one check runs at a time, and leaving cancels it.
 */
export default function PronunciationFeedback({ attemptId, language }: PronunciationFeedbackProps) {
  const [status, setStatus] = useState<"idle" | "checking" | "done" | "error">("idle");
  const [summary, setSummary] = useState<PronunciationSummary>();
  const [error, setError] = useState<string>();
  const [step, setStep] = useState<PronunciationCheckStep>("loading");
  // The running check; a second press while it runs does nothing.
  const running = useRef<AbortController | null>(null);
  useEffect(() => () => running.current?.abort(), []);

  if (language !== "en") return null;

  const check = async () => {
    if (running.current) return;
    const controller = new AbortController();
    running.current = controller;
    setStatus("checking");
    setStep("loading");
    setError(undefined);
    try {
      const result = await assessRecordingPronunciation(attemptId, {
        loadRecording: (id) => getOralReadingRecording(id),
        fetchAudio,
        convert: async (audio) => [await convertToSpeechWavRecording(audio)],
        assessPart: (id, wav, options) => assessOralReadingPronunciation(id, wav, options),
        signal: controller.signal,
        onStep: (next) => { if (!controller.signal.aborted) setStep(next); },
      });
      if (controller.signal.aborted) return;
      setSummary(result);
      setStatus("done");
    } catch (failure) {
      if (controller.signal.aborted) return;
      setError(failure instanceof Error && failure.message.length <= 300
        ? failure.message
        : "Pronunciation feedback is unavailable right now. Please try again.");
      setStatus("error");
    } finally {
      if (running.current === controller) running.current = null;
    }
  };

  return (
    <section className="result-feedback-card" aria-labelledby="azure-pronunciation-title">
      <h3 id="azure-pronunciation-title"><Mic size={22} aria-hidden="true" />Pronunciation Check</h3>
      <p className="result-feedback-note">
        Basa-Eskwela listens to your saved recording and checks how clearly you said the words it could hear.
        This is separate from your reading accuracy, which compares the words we heard with the story.
        Like any computer check, it can make mistakes.
      </p>
      {status !== "done" && (
        <button
          type="button"
          className="result-feedback-button result-feedback-button--primary result-pronunciation-check"
          onClick={() => void check()}
          disabled={status === "checking"}
          aria-busy={status === "checking"}
        >
          {status === "checking" ? STEP_MESSAGES[step] : status === "error" ? "Try again" : "Check My Pronunciation"}
        </button>
      )}
      {status === "checking" && (
        <p className="result-feedback-note" role="status" aria-live="polite">
          {STEP_MESSAGES[step]} This can take about half as long as your reading.
        </p>
      )}
      {status === "error" && error && <p className="result-feedback-note" role="alert">{error}</p>}
      {status === "done" && summary && (summary.utterances === 0 ? (
        <p className="result-feedback-message">
          {summary.complete === false
            ? "We heard speech but couldn't check its pronunciation. Try reading again clearly, in a quiet place."
            : "We couldn't hear enough speech to check pronunciation. Try reading again a little louder."}
        </p>
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
          {summary.complete === false ? (
            <p className="result-feedback-note" role="note">
              Some of your speech{summary.unassessedSeconds ? ` (about ${summary.unassessedSeconds} ${summary.unassessedSeconds === 1 ? "second" : "seconds"})` : ""} could
              not be checked, perhaps because it was unclear or noisy. These results cover
              only the {summary.utterances} spoken {summary.utterances === 1 ? "phrase" : "phrases"} that were checked.
            </p>
          ) : (
            <p className="result-feedback-note">
              Checked your whole recording{summary.assessedSeconds ? ` (${summary.assessedSeconds} seconds)` : ""}, across {summary.utterances} spoken {summary.utterances === 1 ? "phrase" : "phrases"}.
            </p>
          )}
          {summary.wordsToPractice.length > 0 ? (
            <>
              <p>Words that need clearer pronunciation:</p>
              <ul className="result-feedback-words">
                {summary.wordsToPractice.map((word) => <li key={word} className="result-feedback-word"><span>{word}</span></li>)}
              </ul>
              <p className="result-feedback-note">Listen to the word, say it slowly, and try reading it again.</p>
            </>
          ) : (
            // Azure scores only the words it recognized, so this never claims every word of the story.
            <p className="result-feedback-message">The words we checked sounded clear. Great job!</p>
          )}
        </div>
      ))}
    </section>
  );
}
