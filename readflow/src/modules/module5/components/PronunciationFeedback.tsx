import { useCallback, useState, useSyncExternalStore } from "react";
import { Mic, Volume2 } from "lucide-react";
import FeedbackSpeechControls, { useFeedbackSpeechState } from "../../../components/reading-feedback/FeedbackSpeechControls";
import { getFeedbackSpeech } from "../../../services/feedbackSpeech";
import { convertToSpeechWavRecording } from "../../module2/services/speechWav";
import { getOralReadingRecording } from "../services/oralReadingService";
import { assessOralReadingPronunciation } from "../services/oralReadingTranscription";
import {
  pronunciationCheckKey,
  pronunciationChecks,
  type PronunciationCheckRunner,
  type PronunciationCheckState,
} from "../services/pronunciationCheckStore";
import {
  assessRecordingPronunciation,
  noSpeechMessage,
  pronunciationFeedbackText,
  type PronunciationCheckStep,
} from "../services/pronunciationSummary";

/*
 * English readings only. One pronunciation check of the saved recording feeds
 * three result panels: Pronunciation Feedback (F2), Pronunciation Accuracy (F3)
 * and Words to Practice (F4). The check runs only when the learner presses the
 * button, never when a panel opens, and its result is shared through
 * pronunciationChecks (keyed by account and attempt), so closing, switching or
 * remounting a panel keeps it. It is not saved: a page refresh needs a new
 * check. Filipino readings have no pronunciation check; the result page
 * explains that instead of showing a score.
 */

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

/** The one paid request: the whole saved recording, assessed once. */
const runPronunciationCheck: PronunciationCheckRunner = (attemptId, { signal, onStep }) =>
  assessRecordingPronunciation(attemptId, {
    loadRecording: (id) => getOralReadingRecording(id),
    fetchAudio,
    convert: async (audio) => [await convertToSpeechWavRecording(audio)],
    assessPart: (id, wav, options) => assessOralReadingPronunciation(id, wav, options),
    signal,
    onStep,
  });

export interface PronunciationCheck extends PronunciationCheckState {
  check: () => void;
}

/** The shared check for one saved attempt of one account; never started by rendering. */
export function usePronunciationCheck(attemptId: string | undefined, userId: string | undefined): PronunciationCheck {
  const key = pronunciationCheckKey(userId, attemptId);
  const state = useSyncExternalStore(pronunciationChecks.subscribe, () => pronunciationChecks.get(key));
  const check = useCallback(() => {
    if (attemptId) void pronunciationChecks.start(key, attemptId, runPronunciationCheck);
  }, [key, attemptId]);
  return { ...state, check };
}

/** Shown in each panel until the learner has checked: the button never runs on its own. */
function CheckPrompt({ check, intro }: { check: PronunciationCheck; intro: string }) {
  return (
    <>
      <p className="result-feedback-note">
        {intro} Basa-Eskwela listens to your saved recording and checks how clearly you said the words it could hear.
        Like any computer check, it can make mistakes.
      </p>
      <button
        type="button"
        className="result-feedback-button result-feedback-button--primary result-pronunciation-check"
        onClick={check.check}
        disabled={check.status === "checking"}
        aria-busy={check.status === "checking"}
      >
        {check.status === "checking" ? STEP_MESSAGES[check.step] : check.status === "error" ? "Try again" : "Check My Pronunciation"}
      </button>
      {check.status === "checking" && (
        <p className="result-feedback-note" role="status" aria-live="polite">
          {STEP_MESSAGES[check.step]} This can take about half as long as your reading.
        </p>
      )}
      {check.status === "error" && check.error && <p className="result-feedback-note" role="alert">{check.error}</p>}
    </>
  );
}

/** F2 Receive Pronunciation Feedback. */
export function PronunciationFeedbackPanel({ check }: { check: PronunciationCheck }) {
  const summary = check.status === "done" ? check.summary : undefined;
  const text = summary ? pronunciationFeedbackText(summary) : "";
  return (
    <section className="result-feedback-card" aria-labelledby="pronunciation-feedback-title">
      <h3 id="pronunciation-feedback-title"><Mic size={22} aria-hidden="true" />Your Pronunciation</h3>
      {summary ? (
        <div role="status">
          <p className="result-feedback-message">
            {text}
            <FeedbackSpeechControls text={text} language="en" voice="philippine" listenLabel="Listen to feedback" />
          </p>
        </div>
      ) : (
        <CheckPrompt check={check} intro="Get tips about how clearly you said the words." />
      )}
    </section>
  );
}

/** F3 View Pronunciation Accuracy: scores and how much of the reading they cover. */
export function PronunciationAccuracyPanel({ check }: { check: PronunciationCheck }) {
  const summary = check.status === "done" ? check.summary : undefined;
  return (
    <section className="result-feedback-card" aria-labelledby="pronunciation-accuracy-title">
      <h3 id="pronunciation-accuracy-title"><Mic size={22} aria-hidden="true" />Pronunciation Check Scores</h3>
      {!summary ? (
        <CheckPrompt check={check} intro="Your pronunciation and fluency scores appear here after a pronunciation check." />
      ) : summary.utterances === 0 ? (
        <p className="result-feedback-message">{noSpeechMessage(summary)}</p>
      ) : (
        <div role="status">
          {summary.accuracy !== null ? (
            <p className="result-pronunciation-score">Pronunciation Accuracy: <strong>{summary.accuracy}/100</strong></p>
          ) : (
            <p className="result-feedback-note">A pronunciation score is not available for this reading.</p>
          )}
          {summary.fluency !== null && (
            <p className="result-pronunciation-score">Fluency: <strong>{summary.fluency}/100</strong></p>
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
          <p className="result-feedback-note">
            Pronunciation Accuracy shows how clearly you said the words. It is different from Reading Accuracy,
            which compares the words we heard with the story.
          </p>
        </div>
      )}
    </section>
  );
}

function WordListenButton({ word }: { word: string }) {
  const speech = getFeedbackSpeech();
  const state = useFeedbackSpeechState();
  const [failed, setFailed] = useState(false);
  const busy = state.status === "loading" || state.status === "playing";
  return (
    <>
      <button
        type="button"
        className="result-feedback-listen"
        disabled={busy || state.muted}
        aria-label={`Listen to ${word}`}
        onClick={async () => {
          setFailed(false);
          const finished = await speech.play(word, "en", undefined, "philippine");
          if (!finished && speech.getState().status === "error") setFailed(true);
        }}
      >
        <Volume2 size={20} aria-hidden="true" />
      </button>
      {failed && <small role="alert">Audio is unavailable right now. Please try again.</small>}
    </>
  );
}

/** F4 View Mispronounced Words: only words the pronunciation check flagged. */
export function PronunciationWordsPanel({ check }: { check: PronunciationCheck }) {
  const summary = check.status === "done" ? check.summary : undefined;
  return (
    <section className="result-feedback-card" aria-labelledby="pronunciation-words-title">
      <h3 id="pronunciation-words-title"><Mic size={22} aria-hidden="true" />Words Needing Pronunciation Practice</h3>
      {!summary ? (
        <CheckPrompt check={check} intro="Words that need clearer pronunciation appear here after a pronunciation check." />
      ) : summary.utterances === 0 ? (
        <p className="result-feedback-message">{noSpeechMessage(summary)}</p>
      ) : summary.wordsToPractice.length > 0 ? (
        <div role="status">
          <p className="result-feedback-message">Listen to the word, say it slowly, and try reading it again.</p>
          <ul className="result-feedback-words">
            {summary.wordsToPractice.map((word) => (
              <li key={word} className="result-feedback-word">
                <span>{word}</span>
                <small>needs clearer pronunciation</small>
                <WordListenButton word={word} />
              </li>
            ))}
          </ul>
          {summary.complete === false && (
            <p className="result-feedback-note" role="note">Some of your speech could not be checked, so this list may not include every word.</p>
          )}
        </div>
      ) : (
        // The check scores only the words it recognized, so this never claims every word of the story.
        <div role="status">
          <p className="result-feedback-message">The words we checked sounded clear. Great job!</p>
        </div>
      )}
    </section>
  );
}
