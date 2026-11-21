import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { BookOpen, Mic, Volume2 } from "lucide-react";
import { useFeedbackSpeechState } from "../../../components/reading-feedback/FeedbackSpeechControls";
import { getFeedbackSpeech } from "../../../services/feedbackSpeech";
import { convertToSpeechWavRecording } from "../../module2/services/speechWav";
import { getOralReadingRecording } from "../services/oralReadingService";
import { assessOralReadingPronunciation, getSavedPronunciationCheck } from "../services/oralReadingTranscription";
import {
  pronunciationCheckKey,
  pronunciationChecks,
  type AutoStartMarker,
  type PronunciationCheckRunner,
  type PronunciationCheckState,
  type SavedPronunciationLoader,
} from "../services/pronunciationCheckStore";
import {
  assessRecordingPronunciation,
  clarityMessage,
  isPartialCheck,
  noSpeechMessage,
  practiceWordsSummary,
  pronunciationOverview,
  type PronunciationCheckStep,
  type PronunciationSummary,
  practiceWordTotal,
} from "../services/pronunciationSummary";
import { placePracticeWords, practiceExcerpt, type TextPiece } from "../services/resultWords";

/*
 * English readings only. One pronunciation check of the saved recording feeds
 * three result panels: Pronunciation Feedback (F2), Pronunciation Accuracy (F3)
 * and Mispronounced Words (F4). Opening a reading reads its saved check (free);
 * a new check runs only when the learner presses the button, never when a
 * panel opens. The server saves the result once per reading, so refreshing,
 * returning later or signing in again shows it without another check. It is
 * shared through pronunciationChecks (keyed by account and attempt). Filipino
 * readings have no pronunciation check; the result page explains that instead
 * of showing a score.
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
// Display only: where the learner is in the check. The check itself (and Azure) is unchanged.
const STEP_ORDER: PronunciationCheckStep[] = ["loading", "preparing", "uploading", "assessing"];

/** The one paid request: the whole saved recording, assessed and saved once by the server. */
const runPronunciationCheck: PronunciationCheckRunner = (attemptId, { signal, onStep }) =>
  assessRecordingPronunciation(attemptId, {
    loadRecording: (id) => getOralReadingRecording(id),
    fetchAudio,
    convert: (audio) => convertToSpeechWavRecording(audio),
    assess: (id, wavs, options) => assessOralReadingPronunciation(id, wavs, options),
    signal,
    onStep,
  });

/** Free: reads the saved result only. */
const loadSavedCheck: SavedPronunciationLoader = (attemptId) => getSavedPronunciationCheck(attemptId);

// While a check runs elsewhere (another tab, or before a refresh), re-read the
// saved result now and then. These reads never start a check.
const PENDING_RELOAD_MS = 10_000;
const PENDING_MAX_RELOADS = 60;

/** Re-exported for the result cards: the full number of words flagged for practice. */
export { practiceWordTotal };

export interface PronunciationCheck extends PronunciationCheckState {
  /** Starts (or retries) the check: the F2 Try Again button. */
  check: () => void;
  /** F2 only: starts the check once, when Pronunciation Feedback is opened and nothing is saved. */
  autoCheck: () => void;
  /** True once this reading's check was started automatically (this tab or this browser session). */
  autoTried: boolean;
  /** Re-reads the saved result; never starts a check. */
  reload: () => void;
}

// Survives a refresh within this browser session, so a failed automatic check is
// not repeated on its own; the learner uses Try Again instead.
const AUTO_CHECK_PREFIX = "basa-m5-auto-check:";
const sessionMarker: AutoStartMarker = {
  has(key) { try { return window.sessionStorage.getItem(AUTO_CHECK_PREFIX + key) === "1"; } catch { return false; } },
  add(key) { try { window.sessionStorage.setItem(AUTO_CHECK_PREFIX + key, "1"); } catch { /* storage unavailable */ } },
};

/**
 * The shared check for one saved attempt of one account. Rendering only reads the
 * saved result. A paid check starts only from F2: automatically, once, when the
 * learner opens it and nothing is saved (autoCheck), or from Try Again (check).
 */
export function usePronunciationCheck(attemptId: string | undefined, userId: string | undefined): PronunciationCheck {
  const key = pronunciationCheckKey(userId, attemptId);
  const state = useSyncExternalStore(pronunciationChecks.subscribe, () => pronunciationChecks.get(key));
  useEffect(() => {
    if (attemptId) void pronunciationChecks.load(key, attemptId, loadSavedCheck);
  }, [key, attemptId]);
  const pending = state.status === "pending";
  useEffect(() => {
    if (!pending || !attemptId) return undefined;
    let reloads = 0;
    const timer = setInterval(() => {
      if (++reloads > PENDING_MAX_RELOADS) { clearInterval(timer); return; }
      void pronunciationChecks.load(key, attemptId, loadSavedCheck, { force: true });
    }, PENDING_RELOAD_MS);
    return () => clearInterval(timer);
  }, [pending, key, attemptId]);
  const check = useCallback(() => {
    if (attemptId) void pronunciationChecks.start(key, attemptId, runPronunciationCheck);
  }, [key, attemptId]);
  const autoCheck = useCallback(() => {
    if (attemptId) void pronunciationChecks.autoStart(key, attemptId, runPronunciationCheck, sessionMarker);
  }, [key, attemptId]);
  const reload = useCallback(() => {
    if (attemptId) void pronunciationChecks.load(key, attemptId, loadSavedCheck, { force: true });
  }, [key, attemptId]);
  return { ...state, check, autoCheck, autoTried: pronunciationChecks.wasAutoStarted(key, sessionMarker), reload };
}

/** Shown only when the server could not save a finished result; saved results show no date note. */
function UnsavedNote({ check }: { check: PronunciationCheck }) {
  if (check.status !== "done" || check.saved !== false) return null;
  return <p className="result-feedback-note" role="alert">{check.notice}</p>;
}

function PendingNote({ check }: { check: PronunciationCheck }) {
  return (
    <>
      <p className="result-feedback-note" role="status" aria-live="polite">
        Your pronunciation check is still running. Your result will appear here when it is ready.
      </p>
      <button type="button" className="result-feedback-button result-pronunciation-check" onClick={check.reload}>
        Show My Result
      </button>
    </>
  );
}

/**
 * F2 before a result: loading, checking (started automatically when F2 opened),
 * or an error with an explicit Try Again. Never says anything about words.
 */
function FeedbackStatus({ check, autoStart }: { check: PronunciationCheck; autoStart: boolean }) {
  if (check.status === "loading") {
    return (
      <p className="result-feedback-note" role="status" aria-live="polite" aria-busy="true">
        <span className="m5-loading-indicator" aria-hidden="true" /> Loading your pronunciation feedback…
      </p>
    );
  }
  if (check.status === "pending") return <PendingNote check={check} />;
  if (check.status === "checking" || (check.status === "idle" && autoStart && !check.loadError && !check.autoTried)) {
    const step = check.status === "checking" ? check.step : "loading";
    return (
      <p className="result-feedback-note" role="status" aria-live="polite" aria-busy="true">
        <span className="m5-loading-indicator" aria-hidden="true" /> {STEP_MESSAGES[step]} This can take about half as long as your reading.
        {" "}Step {STEP_ORDER.indexOf(step) + 1} of {STEP_ORDER.length}. You can listen to your recording below while you wait.
      </p>
    );
  }
  const message = check.status === "error" && check.error
    ? check.error
    : check.loadError
      ? `${check.loadError} Please try again.`
      : "Your pronunciation feedback is not ready yet.";
  return (
    <>
      <p className="result-feedback-note" role="alert">{message}</p>
      <button
        type="button"
        className="result-feedback-button result-feedback-button--primary result-pronunciation-check"
        onClick={check.check}
      >
        Try Again
      </button>
    </>
  );
}

/** F3 and F4 before a result: they never start a check; F2 does. */
function ResultWaiting({ check }: { check: PronunciationCheck }) {
  if (check.status === "loading") {
    return <p className="result-feedback-note" role="status" aria-live="polite">Loading your pronunciation check…</p>;
  }
  if (check.status === "pending") return <PendingNote check={check} />;
  if (check.status === "checking") {
    return (
      <p className="result-feedback-note" role="status" aria-live="polite">
        Your pronunciation is being checked. Your result will appear here when it is ready.
      </p>
    );
  }
  return (
    <p className="result-feedback-note" role="note">
      Open Pronunciation Feedback first to check your pronunciation. Your result will then appear here.
    </p>
  );
}

/** The story the learner read, for placing practice words (F3, F4). */
export interface PronunciationStory {
  passage: string;
  title: string;
}

/** Story text with practice words highlighted; the hidden text tells screen readers which words. */
function MarkedText({ pieces }: { pieces: TextPiece[] }) {
  return (
    <>
      {pieces.map((piece, index) => piece.practice
        ? <mark key={index} className="result-practice-mark">{piece.text}<span className="result-visually-hidden"> (practice word)</span></mark>
        : piece.text)}
    </>
  );
}

const PARTIAL_SCORE_NOTE = "Only part of your reading could be checked, so this score covers the part we could check.";

/**
 * F2 Receive Pronunciation Feedback: one or two sentences; scores and words stay
 * in F3 and F4. `autoStart` is true only while the learner has F2 open: then a
 * reading with no saved check is checked automatically, once.
 */
export function PronunciationFeedbackPanel({ check, autoStart = false }: { check: PronunciationCheck; autoStart?: boolean }) {
  const summary = check.status === "done" ? check.summary : undefined;
  const { autoCheck, status, loadError } = check;
  useEffect(() => {
    if (autoStart && status === "idle" && !loadError) autoCheck();
  }, [autoStart, status, loadError, autoCheck]);
  return (
    <section className="result-feedback-card" aria-labelledby="pronunciation-feedback-title">
      <h3 id="pronunciation-feedback-title"><Mic size={22} aria-hidden="true" />Your Pronunciation</h3>
      {summary ? (
        <div role="status">
          <p className="result-feedback-message">{pronunciationOverview(summary)}</p>
          <UnsavedNote check={check} />
        </div>
      ) : (
        <FeedbackStatus check={check} autoStart={autoStart} />
      )}
    </section>
  );
}

/**
 * The saved score is a 0-100 pronunciation score (Azure's AccuracyScore per
 * phrase, averaged by Basa-Eskwela weighted by the words in each phrase). It is
 * not a percentage of correct words, so it is shown "out of 100", never as "%".
 */
function ScoreValue({ value, label }: { value: number; label: string }) {
  return (
    <>
      <p className="result-pronunciation-value"><strong>{value}</strong> out of 100</p>
      <progress className="result-feedback-progress" value={value} max={100} aria-label={`${label}: ${value} out of 100`}>{value} out of 100</progress>
    </>
  );
}

/** F3: optional, closed by default, explains the score without inventing a breakdown. */
function ScoreHelp() {
  return (
    <details className="result-score-help">
      <summary>How was my pronunciation scored?</summary>
      <p>
        The computer listens to the sounds you make and compares them with the expected sounds of the words. Your score
        shows how closely they matched.
      </p>
      <p>
        Your score is out of 100. It is not the percent of words you said correctly. Each word gets its own score, and a
        word can score a little below 100 without being wrong. So your score can be a little below 100 even when no words
        were flagged for practice.
      </p>
      <p>
        The computer compares your speech with American English sounds, so a different accent can lower the score a
        little. A word is flagged for practice only when it sounds very different from what the computer expected.
        Like any computer check, it can make mistakes.
      </p>
    </details>
  );
}

/** F3 Card 1: the pronunciation accuracy score and where the practice words are in the story. */
function ClearWordsCard({ summary, story }: { summary: PronunciationSummary; story: PronunciationStory }) {
  const placed = placePracticeWords(summary.wordsToPractice, story.passage, story.title, summary.practiceOccurrences);
  const excerpt = practiceExcerpt(placed, story.passage, story.title);
  const partial = isPartialCheck(summary);
  return (
    <section className="result-feedback-card result-pronunciation-card" aria-labelledby="clear-words-title">
      <h3 id="clear-words-title"><Mic size={22} aria-hidden="true" />Clear Words — Pronunciation Accuracy</h3>
      <p className="result-feedback-note">How clearly you said the words.</p>
      {summary.accuracy !== null && <ScoreValue value={summary.accuracy} label="Pronunciation Accuracy" />}
      <p className="result-feedback-message">{clarityMessage(summary)}</p>
      {summary.accuracy !== null && <ScoreHelp />}
      {partial && <p className="result-feedback-note" role="note">{PARTIAL_SCORE_NOTE}</p>}
      {excerpt.length > 0 && (
        <figure className="result-story-excerpt">
          {excerpt.map((pieces, index) => <p key={index}><MarkedText pieces={pieces} /></p>)}
          <figcaption className="result-legend"><span className="result-legend-swatch result-legend-swatch--practice" aria-hidden="true" />Orange words were flagged for more pronunciation practice.</figcaption>
        </figure>
      )}
      <p className="result-feedback-note">
        {placed.length > 0
          ? "Open Mispronounced Words to hear and practice these words."
          : partial
            ? "No words were flagged for pronunciation practice in the part checked."
            : "No words were flagged for pronunciation practice."}
      </p>
    </section>
  );
}

/**
 * F3 View Pronunciation Accuracy: the saved pronunciation accuracy score only.
 * Fluency is not shown (agreed F3 scope); Reading Accuracy stays in F6.
 */
export function PronunciationAccuracyPanel({ check, story }: { check: PronunciationCheck; story: PronunciationStory }) {
  const summary = check.status === "done" ? check.summary : undefined;
  if (!summary || summary.utterances === 0) {
    return (
      <section className="result-feedback-card" aria-labelledby="pronunciation-accuracy-title">
        <h3 id="pronunciation-accuracy-title"><Mic size={22} aria-hidden="true" />Pronunciation Accuracy</h3>
        {summary ? (
          <div role="status">
            <p className="result-feedback-message">{noSpeechMessage(summary)}</p>
            <UnsavedNote check={check} />
          </div>
        ) : (
          <ResultWaiting check={check} />
        )}
      </section>
    );
  }
  return (
    <div className="result-pronunciation-cards" role="status">
      <ClearWordsCard summary={summary} story={story} />
      <UnsavedNote check={check} />
    </div>
  );
}

/**
 * "Hear" (American English): the word read by an en-US voice, because the
 * pronunciation check compares speech with American English. It is one accent
 * example, not the only correct pronunciation, and never a clip of the
 * learner's recording (saved recordings have no word timestamps).
 */
function ExampleButton({ word }: { word: string }) {
  const speech = getFeedbackSpeech();
  const state = useFeedbackSpeechState();
  const [failed, setFailed] = useState(false);
  const busy = state.status === "loading" || state.status === "playing";
  return (
    <>
      <button
        type="button"
        className="result-feedback-button result-practice-example"
        disabled={busy || state.muted}
        aria-label={`Hear American English: ${word}`}
        onClick={async () => {
          setFailed(false);
          const finished = await speech.play(word, "en", undefined, "american");
          if (!finished && speech.getState().status === "error") setFailed(true);
        }}
      >
        {/* Visible label "Hear"; the accessible name starts with it and also names the accent. */}
        <Volume2 size={20} aria-hidden="true" />Hear
      </button>
      {failed && <small role="alert">Audio is unavailable right now. Please try again.</small>}
    </>
  );
}

/**
 * F4 View Mispronounced Words: only words the saved pronunciation check
 * flagged, once each, in story order. Transcript differences are in F5.
 * Each word has an American English example; the learner's full recording is
 * shown below the list (ReadingResultPage) for comparison. "Hear Yourself" for
 * one word is not offered: saved recordings have no word timestamps.
 */
export function PronunciationWordsPanel({ check, story }: { check: PronunciationCheck; story: PronunciationStory }) {
  const summary = check.status === "done" ? check.summary : undefined;
  const placed = summary ? placePracticeWords(summary.wordsToPractice, story.passage, story.title, summary.practiceOccurrences) : [];
  return (
    <section className="result-feedback-card" aria-labelledby="pronunciation-words-title">
      <h3 id="pronunciation-words-title"><Mic size={22} aria-hidden="true" />Words to Say Again</h3>
      {!summary ? (
        <ResultWaiting check={check} />
      ) : summary.utterances === 0 ? (
        <div role="status">
          <p className="result-feedback-message">{noSpeechMessage(summary)}</p>
          <UnsavedNote check={check} />
        </div>
      ) : (
        <div role="status" className="result-practice">
          <p className="result-feedback-message">{practiceWordsSummary(summary)}</p>
          {placed.length > 0 && (
            <>
              <p className="result-feedback-note">
                The computer flagged these words for practice. Listen to the American English example and try saying each word again.
                Different English accents can sound different, and names can be said in more than one way.
              </p>
              <ul className="result-practice-list">
                {placed.map((item) => (
                  <li key={item.key} className="result-practice-item">
                    <strong className="result-practice-word">{item.word}</strong>
                    {item.excerpt && (
                      <p className="result-practice-excerpt">
                        <BookOpen size={16} aria-hidden="true" />
                        <span><MarkedText pieces={item.excerpt} /></span>
                      </p>
                    )}
                    <ExampleButton word={item.word} />
                  </li>
                ))}
              </ul>
            </>
          )}
          {isPartialCheck(summary) && placed.length > 0 && (
            <p className="result-feedback-note" role="note">Some of your reading could not be checked, so this list may not include every word.</p>
          )}
          {placed.length > 0 && (
            <p className="result-feedback-note">Compare with your full recording below. It plays your whole reading, not one word.</p>
          )}
          <p className="result-feedback-note">
            Sometimes the computer can make listening mistakes, especially with names. A different accent is not a mistake.
            If you are sure you said a word correctly, ask your teacher to listen to your recording.
          </p>
          <UnsavedNote check={check} />
        </div>
      )}
    </section>
  );
}
