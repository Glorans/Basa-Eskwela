import { BookOpen, LoaderCircle, Mic, Square, Volume2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useFeedbackSpeechState } from "../../../components/reading-feedback/FeedbackSpeechControls";
import { getActivityText, type ActivityLanguage } from "../../../pages/reading-activity/activityLanguage";
import { getFeedbackSpeech } from "../../../services/feedbackSpeech";
import {
  buildFilipinoFeedback,
  filipinoReadingStats,
  type FilipinoFeedbackAttempt,
  type ReadingDifference,
} from "../services/filipinoReadingFeedback";
import { readingAccuracyMessage, reviewExcerpt, type TextPiece } from "../services/resultWords";

/*
 * Filipino readings only (F2, F3, F4 and F7). They use the same cards, icons and
 * classes as the English panels in PronunciationFeedback.tsx, so both languages
 * look alike. Everything comes from one saved attempt: no score is calculated.
 * The only network call is the optional F4 "Pakinggan" button, which speaks a
 * story word in a fil-PH voice and never plays on its own. These panels compare
 * the story with what was heard, so they never show a pronunciation score or call
 * a word mispronounced. Labels follow `uiLanguage` (Admin views stay in English);
 * story words keep their own language.
 */
interface PanelProps {
  attempt: FilipinoFeedbackAttempt;
  uiLanguage?: ActivityLanguage;
}
type Translate = ReturnType<typeof getActivityText>["t"];

/** F2: a short personal summary and a practice suggestion. Scores are in F3; the word list is in F4. */
/** Result card number for a Filipino reading: the differences Words to Review lists (the same rule, nothing new). */
export function filipinoDifferenceCount(attempt: Parameters<typeof buildFilipinoFeedback>[0]) {
  const feedback = buildFilipinoFeedback(attempt);
  // No saved transcript to compare: no number (never a misleading 0).
  return feedback.status === "unavailable" ? null : feedback.differences.length;
}

export default function FilipinoReadingFeedback({ attempt, uiLanguage = "fil", title }: PanelProps & {
  /** Replaces the heading where the view needs its own wording. */
  title?: string;
}) {
  const { t } = getActivityText(uiLanguage);
  const feedback = buildFilipinoFeedback(attempt);
  const heading = (
    <h3 id="filipino-reading-feedback-title">
      <Mic size={22} aria-hidden="true" />{title ?? t("Feedback from What We Heard")}
    </h3>
  );
  if (feedback.status === "unavailable") {
    return (
      <section className="result-feedback-card" aria-labelledby="filipino-reading-feedback-title">
        {heading}
        <p className="result-feedback-note" role="note">{t("This reading has no saved words to compare with the story, so there is no feedback to show.")}</p>
      </section>
    );
  }
  return (
    <section className="result-feedback-card" aria-labelledby="filipino-reading-feedback-title">
      {heading}
      <p className="result-feedback-message">{t(feedback.summary)}</p>
      {/* Presentation only: the same text, grouped like the English cards (facts in one cream
          panel, the tip in the shared instruction box, the explanation as the closing note). */}
      {(feedback.differences.length > 0 || feedback.startWords.length > 0) && (
        <div className="result-feedback-facts">
          {feedback.differences.length > 0 && (
            <p className="result-feedback-note">
              {t("Places to check in this reading: {count}. You can see them in Words to Review.", { count: feedback.differences.length })}
            </p>
          )}
          {feedback.startWords.length > 0 && (
            <p className="result-feedback-note"><strong>{t("Words to start with:")}</strong> {feedback.startWords.join(", ")}</p>
          )}
        </div>
      )}
      <p className="result-info-box result-feedback-tip"><strong>{t("Practice tip:")}</strong> {t(feedback.tip)}</p>
      <p className="result-feedback-note" role="note">
        {t("This compares the story with the words the computer heard. It is not a pronunciation score, and a difference does not always mean a reading mistake.")}
        {" "}{t("Sometimes the computer can make mistakes when listening.")}
      </p>
    </section>
  );
}

/** Story text with the review words highlighted; the hidden text tells screen readers which words. */
function MarkedText({ pieces, t }: { pieces: TextPiece[]; t: Translate }) {
  return (
    <>
      {pieces.map((piece, index) => piece.practice
        ? <mark key={index} className="result-practice-mark">{piece.text}<span className="result-visually-hidden">{t(" (word to review)")}</span></mark>
        : piece.text)}
    </>
  );
}

/**
 * F3: laid out like the English "Clear Words" card (value, progress bar, short
 * message, a closed "how" section, a marked story excerpt, a pointer to F4), but
 * the value is the saved transcript-based Reading Accuracy, never a pronunciation
 * score. The same saved values as F6; nothing is recalculated.
 */
export function FilipinoReadingAccuracyPanel({ attempt, uiLanguage = "fil" }: PanelProps) {
  const { t } = getActivityText(uiLanguage);
  const stats = filipinoReadingStats(attempt);
  const heading = <h3 id="filipino-accuracy-title"><Mic size={22} aria-hidden="true" />{t("Reading Accuracy")}</h3>;
  if (stats.status === "unavailable") {
    return (
      <section className="result-feedback-card" aria-labelledby="filipino-accuracy-title">
        {heading}
        <p className="result-feedback-message">{t("Not assessed")}</p>
      </section>
    );
  }
  const metrics = Array.isArray(attempt.wordMetrics) ? attempt.wordMetrics : [];
  const excerpt = reviewExcerpt(attempt.passageSnapshot ?? "", attempt.passageTitle || attempt.moduleTitle, "fil", metrics) ?? [];
  const storyDifferences = metrics.some((metric) => metric.type === "substitution" || metric.type === "omission");
  return (
    <div className="result-pronunciation-cards">
      <section className="result-feedback-card result-pronunciation-card" aria-labelledby="filipino-accuracy-title">
        {heading}
        <p className="result-feedback-note">{t("How closely the words we heard matched the story.")}</p>
        {/* A real share of the story (unlike the English 0-100 pronunciation score), so it keeps "%". */}
        <p className="result-pronunciation-value"><strong>{stats.accuracy}</strong>%</p>
        <progress className="result-feedback-progress" value={stats.accuracy} max={100}
          aria-label={`${t("Reading Accuracy")}: ${stats.accuracy}%`}>{stats.accuracy}%</progress>
        <p className="result-feedback-message">{t(readingAccuracyMessage(stats.accuracy, stats.everyWordMatched))}</p>
        {stats.matched !== null && stats.differenceCount !== null ? (
          <dl className="result-feedback-summary result-feedback-summary--two">
            <div>
              <dt>{t("Words Matched")}</dt>
              <dd className="result-feedback-summary-value">{t("{matched} of {total}", { matched: stats.matched, total: stats.total })}</dd>
            </div>
            <div>
              <dt>{t("Differences Counted")}</dt>
              <dd className="result-feedback-summary-value">{stats.differenceCount}</dd>
            </div>
          </dl>
        ) : (
          <p className="result-feedback-note" role="note">{t("The word-by-word comparison was not saved for this reading.")}</p>
        )}
        <details className="result-score-help">
          <summary>{t("How was this result found?")}</summary>
          <p>{t("This result compares the story with the words the computer recognized. It does not directly measure pronunciation.")}</p>
          {stats.currentScoringRule && <p>{t(READING_ACCURACY_EXPLANATION)}</p>}
          <p>{t("Sometimes the computer can make mistakes when listening.")}</p>
        </details>
        {excerpt.length > 0 && (
          <figure className="result-story-excerpt">
            {excerpt.map((pieces, index) => <p key={index}><MarkedText pieces={pieces} t={t} /></p>)}
            <figcaption className="result-legend">
              <span className="result-legend-swatch result-legend-swatch--practice" aria-hidden="true" />
              {t("Orange story words were heard differently or not heard.")}
            </figcaption>
          </figure>
        )}
        <p className="result-feedback-note">
          {storyDifferences ? t("Open Words to Review to listen to these words.") : t("No differences from the story were saved for this reading.")}
        </p>
        <p className="result-feedback-note" role="note">
          {t("This is not a pronunciation score. Filipino pronunciation is not scored in this app.")}
        </p>
      </section>
    </div>
  );
}

/** F3 and F7: how the saved result was reached. Only said of attempts saved under this rule. */
export const READING_ACCURACY_EXPLANATION = "Reading Accuracy starts from all the story words and takes away each difference the computer found: different words, words not heard and extra words. So it can be a little lower than the share of words matched." as const;

/**
 * F4 "Pakinggan": the English "Hear" button's look, with Stop and replay. Speaks
 * the story's own word in a Philippine Filipino voice through the shared player
 * (one clip at a time, cached, existing /api/tts limits). It is an example of the
 * word, never a check of the learner's reading, and it saves nothing.
 */
export function WordListenButton({ word, row, t }: { word: string; row: number; t: Translate }) {
  const speech = getFeedbackSpeech();
  const state = useFeedbackSpeechState();
  const [played, setPlayed] = useState(false);
  // One key per row, so a repeated word shows Stop only on the row that was pressed.
  const key = `filipino-word:${row}:${word}`;
  const mine = state.key === key;
  const loading = mine && state.status === "loading";
  const playing = mine && state.status === "playing";
  useEffect(() => () => speech.stopIf(key), [speech, key]);
  const label = loading ? t("Loading audio...") : playing ? t("Stop") : played ? t("Hear again") : t("Hear");
  return (
    <>
      <button
        type="button"
        className="result-feedback-button result-practice-example"
        disabled={state.muted}
        // The accessible name starts with the visible label and names the word.
        aria-label={`${label}: ${word}`}
        onClick={() => {
          if (loading || playing) { speech.stop(); return; }
          setPlayed(true);
          void speech.play(word, "fil", key, "philippine");
        }}
      >
        {loading
          ? <LoaderCircle className="feedback-speech-spinner" size={20} aria-hidden="true" />
          : playing ? <Square size={18} fill="currentColor" aria-hidden="true" /> : <Volume2 size={20} aria-hidden="true" />}
        {label}
      </button>
      {mine && state.status === "error" && <small role="alert">{t("Audio is unavailable right now. Please try again.")}</small>}
    </>
  );
}

function DifferenceRow({ item, row, t }: { item: ReadingDifference; row: number; t: Translate }) {
  return (
    <li className="result-practice-item">
      <strong className="result-practice-word">{item.kind === "extra" ? item.heard : item.story}</strong>
      <p className="result-reading-heard">
        {item.kind === "different" && t("The computer heard: “{heard}”", { heard: item.heard ?? "" })}
        {item.kind === "skipped" && t("The computer did not hear this story word.")}
        {item.kind === "extra" && t("The computer heard this word, but it is not in the story.")}
      </p>
      {item.context && (
        <p className="result-practice-excerpt">
          <BookOpen size={16} aria-hidden="true" />
          <span>
            {item.kind === "extra" && <>{t("Heard near:")} </>}
            <MarkedText pieces={item.context} t={t} />
          </span>
        </p>
      )}
      {/* The story's own word only: never the heard word, and an extra word has no story word to play. */}
      {item.kind !== "extra" && item.story && <WordListenButton word={item.story} row={row} t={t} />}
    </li>
  );
}

/**
 * F4 and F7: laid out like the English "Words to Say Again" list (word cards with
 * an excerpt and a listen button), but listing every saved difference, one row per
 * occurrence, in reading order. These are not confirmed mispronunciations.
 */
export function FilipinoWordReviewPanel({ attempt, uiLanguage = "fil" }: PanelProps) {
  const { t } = getActivityText(uiLanguage);
  const feedback = buildFilipinoFeedback(attempt);
  const heading = <h3 id="filipino-words-title"><Mic size={22} aria-hidden="true" />{t("Words to Review")}</h3>;
  if (feedback.status === "unavailable") {
    return (
      <section className="result-feedback-card" aria-labelledby="filipino-words-title">
        {heading}
        <p className="result-feedback-note" role="note">{t("This reading has no saved words to compare with the story, so there is no word list to show.")}</p>
      </section>
    );
  }
  const listenable = feedback.differences.some((item) => item.kind !== "extra" && item.story);
  return (
    <section className="result-feedback-card" aria-labelledby="filipino-words-title">
      {heading}
      <div className="result-practice">
        {feedback.differences.length === 0 ? (
          <p className="result-feedback-message">{t("No differences from the story were saved for this reading.")}</p>
        ) : (
          <>
            <p className="result-feedback-message">
              {t("Different words: {different}. Words not heard: {skipped}. Extra words: {extra}.", feedback.counts)}
            </p>
            {listenable && (
              <p className="result-feedback-note">
                {t("Listen to each story word, then read its sentence again. The voice is a computer reading the story word. It is an example, not a check of how you read it.")}
              </p>
            )}
            <ul className="result-practice-list result-reading-words">
              {feedback.differences.map((item, index) => <DifferenceRow key={index} item={item} row={index} t={t} />)}
            </ul>
            {feedback.digitDifference && (
              <p className="result-feedback-note">{t("The computer can write a spoken number as a digit, so a digit here may not be a reading difference.")}</p>
            )}
            <p className="result-feedback-note">{t("Compare with the full recording below. It plays the whole reading, not one word.")}</p>
          </>
        )}
        <p className="result-feedback-note" role="note">
          {t("These are differences between the story and what the computer heard. They are not confirmed pronunciation mistakes, and the computer can hear a word wrongly. Listen to the recording to check.")}
        </p>
      </div>
    </section>
  );
}
