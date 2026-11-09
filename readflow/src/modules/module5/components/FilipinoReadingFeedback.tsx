import { Gauge, ListChecks, MessageCircle } from "lucide-react";
import { getActivityText, type ActivityLanguage } from "../../../pages/reading-activity/activityLanguage";
import {
  buildFilipinoFeedback,
  filipinoReadingStats,
  type FilipinoFeedbackAttempt,
  type ReadingDifference,
} from "../services/filipinoReadingFeedback";

/*
 * Filipino readings only (F2, F3, F4 and F7). Everything comes from one saved
 * attempt: no score is calculated, and no network or speech call is made. These
 * panels compare the story with what was heard, so they never show a
 * pronunciation score or call a word mispronounced. Labels follow `uiLanguage`
 * (Admin views stay in English); story words keep their own language.
 */
interface PanelProps {
  attempt: FilipinoFeedbackAttempt;
  uiLanguage?: ActivityLanguage;
}

/** F2: a short personal summary and a practice suggestion. Scores are in F3; the word list is in F4. */
export default function FilipinoReadingFeedback({ attempt, uiLanguage = "fil", title }: PanelProps & {
  /** Replaces the heading where the view needs its own wording. */
  title?: string;
}) {
  const { t } = getActivityText(uiLanguage);
  const feedback = buildFilipinoFeedback(attempt);
  const heading = (
    <h3 id="filipino-reading-feedback-title">
      <MessageCircle size={22} aria-hidden="true" />{title ?? t("Feedback from What We Heard")}
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
      {feedback.differences.length > 0 && (
        <p className="result-feedback-note">
          {t("Places to check in this reading: {count}. You can see them in Words to Review.", { count: feedback.differences.length })}
        </p>
      )}
      {feedback.startWords.length > 0 && (
        <p className="result-feedback-note"><strong>{t("Words to start with:")}</strong> {feedback.startWords.join(", ")}</p>
      )}
      <p className="result-feedback-note"><strong>{t("Practice tip:")}</strong> {t(feedback.tip)}</p>
      <p className="result-feedback-note" role="note">
        {t("This compares the story with the words the computer heard. It is not a pronunciation score, and a difference does not always mean a reading mistake.")}
        {" "}{t("Sometimes the computer can make mistakes when listening.")}
      </p>
    </section>
  );
}

/** F3: the saved Reading Accuracy and how it was reached. The same values as F6; never a pronunciation score. */
export function FilipinoReadingAccuracyPanel({ attempt, uiLanguage = "fil" }: PanelProps) {
  const { t } = getActivityText(uiLanguage);
  const stats = filipinoReadingStats(attempt);
  if (stats.status === "unavailable") {
    return (
      <section className="result-feedback-card" aria-labelledby="filipino-accuracy-title">
        <h3 id="filipino-accuracy-title"><Gauge size={22} aria-hidden="true" />{t("Reading Accuracy")}</h3>
        <p className="result-feedback-message">{t("Not assessed")}</p>
      </section>
    );
  }
  return (
    <section className="result-feedback-card result-feedback-score" aria-labelledby="filipino-accuracy-title">
      <h3 id="filipino-accuracy-title"><Gauge size={22} aria-hidden="true" />{t("Reading Accuracy")}</h3>
      <p className="result-feedback-note">{t("How closely the words we heard matched the story.")}</p>
      <p className="result-feedback-score-value">{stats.accuracy}%</p>
      <progress className="result-feedback-progress" value={stats.accuracy} max={100} aria-labelledby="filipino-accuracy-title">{stats.accuracy}%</progress>
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
      {stats.currentScoringRule && <p className="result-feedback-note">{t(READING_ACCURACY_EXPLANATION)}</p>}
      <p className="result-feedback-note" role="note">
        {t("This is not a pronunciation score. Filipino pronunciation is not scored in this app.")}
        {" "}{t("Sometimes the computer can make mistakes when listening.")}
      </p>
    </section>
  );
}

/** F3 and F7: how the saved result was reached. Only said of attempts saved under this rule. */
export const READING_ACCURACY_EXPLANATION = "Reading Accuracy starts from all the story words and takes away each difference the computer found: different words, words not heard and extra words. So it can be a little lower than the share of words matched." as const;

function DifferenceRow({ item, t }: { item: ReadingDifference; t: ReturnType<typeof getActivityText>["t"] }) {
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
          <span>
            {item.kind === "extra" && <>{t("Heard near:")} </>}
            {item.context.map((piece, index) => (piece.practice
              ? <mark key={index} className="result-practice-mark">{piece.text}</mark>
              : piece.text))}
          </span>
        </p>
      )}
    </li>
  );
}

/** F4 and F7: every saved difference, one row per occurrence, in reading order. These are not confirmed mispronunciations. */
export function FilipinoWordReviewPanel({ attempt, uiLanguage = "fil" }: PanelProps) {
  const { t } = getActivityText(uiLanguage);
  const feedback = buildFilipinoFeedback(attempt);
  const heading = <h3 id="filipino-words-title"><ListChecks size={22} aria-hidden="true" />{t("Words to Review")}</h3>;
  if (feedback.status === "unavailable") {
    return (
      <section className="result-feedback-card" aria-labelledby="filipino-words-title">
        {heading}
        <p className="result-feedback-note" role="note">{t("This reading has no saved words to compare with the story, so there is no word list to show.")}</p>
      </section>
    );
  }
  return (
    <section className="result-feedback-card" aria-labelledby="filipino-words-title">
      {heading}
      {feedback.differences.length === 0 ? (
        <p className="result-feedback-message">{t("No differences from the story were saved for this reading.")}</p>
      ) : (
        <>
          <p className="result-feedback-note">
            {t("Different words: {different}. Words not heard: {skipped}. Extra words: {extra}.", feedback.counts)}
          </p>
          <ul className="result-practice-list result-reading-words">
            {feedback.differences.map((item, index) => <DifferenceRow key={index} item={item} t={t} />)}
          </ul>
          {feedback.digitDifference && (
            <p className="result-feedback-note">{t("The computer can write a spoken number as a digit, so a digit here may not be a reading difference.")}</p>
          )}
        </>
      )}
      <p className="result-feedback-note" role="note">
        {t("These are differences between the story and what the computer heard. They are not confirmed pronunciation mistakes, and the computer can hear a word wrongly. Listen to the recording to check.")}
      </p>
    </section>
  );
}
