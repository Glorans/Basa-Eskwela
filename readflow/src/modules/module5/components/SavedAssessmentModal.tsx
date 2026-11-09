import { Gauge, MessageCircle, Mic } from "lucide-react";
import { useEffect, useState } from "react";
import { getActivityText } from "../../../pages/reading-activity/activityLanguage";
import "../../../pages/reading-activity/ReadingResultPage.css";
import { getOralReadingAttempt, type OwnOralReadingSummary } from "../services/oralReadingService";
import { pronunciationOverview } from "../services/pronunciationSummary";
import type { LearnerM5Role, OralReadingAttempt } from "../types/oralReading";
import FilipinoReadingFeedback, { FilipinoWordReviewPanel, READING_ACCURACY_EXPLANATION } from "./FilipinoReadingFeedback";
import M5Modal from "./M5Modal";
import { PronunciationAccuracyPanel, PronunciationWordsPanel, usePronunciationCheck } from "./PronunciationFeedback";
import RecordingPlayback from "./RecordingPlayback";
import SavedTranscript from "./SavedTranscript";

interface SavedAssessmentModalProps {
  role: LearnerM5Role;
  /** The Reading History card that was selected. */
  summary: OwnOralReadingSummary;
  readingNumber?: number;
  onClose: () => void;
}

/**
 * F7 Review Saved Oral Reading Assessment: one reading's complete saved
 * assessment in one scrollable modal over Reading History (the URL does not
 * change). Read-only: it loads the saved attempt, saved pronunciation check
 * and recording through the existing authorized endpoints and never starts a
 * pronunciation check (it has no F2 panel and never calls check/autoCheck).
 * Nothing here computes a new score; missing results say "Not assessed".
 * It is an assessment view only: M6 comprehension is reached through the reading
 * result ("Continue to Questions"), the Learning Room and Progress & Result.
 */
export default function SavedAssessmentModal({ role, summary, readingNumber, onClose }: SavedAssessmentModalProps) {
  const [attempt, setAttempt] = useState<OralReadingAttempt>();
  const [error, setError] = useState<string>();
  const [revision, setRevision] = useState(0);
  const { t, message, language } = getActivityText(role === "admin" ? "en" : summary.language);

  useEffect(() => {
    let active = true;
    setError(undefined);
    void getOralReadingAttempt(summary.id, revision > 0)
      .then((loaded) => { if (active) setAttempt(loaded); })
      .catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "Unable to load this saved assessment.");
      });
    return () => { active = false; };
  }, [summary.id, revision]);

  // Only this exact attempt's saved data is ever shown (several readings of one story share a title).
  const loaded = attempt?.id === summary.id ? attempt : undefined;
  // Reads the saved check only (free). F7 never calls check() or autoCheck().
  const pronunciation = usePronunciationCheck(loaded?.language === "en" ? loaded.id : undefined, loaded?.userId);

  const title = summary.passageTitle || summary.moduleTitle;
  const heading = readingNumber ? `${title} — ${t("Reading {number}", { number: readingNumber })}` : title;
  const story = loaded ? { passage: loaded.passageSnapshot ?? "", title: loaded.passageTitle || loaded.moduleTitle } : null;
  const matched = loaded ? loaded.wordMetrics.filter((word) => word.type === "match").length : 0;

  return (
    <M5Modal id="m5-saved-assessment" title={t("Saved Oral Reading Assessment")} closeLabel={t("Close")} open onClose={onClose}>
      <div lang={language} className="result-saved-assessment">
        <section className="result-feedback-card" aria-labelledby="saved-reading-title">
          <h3 id="saved-reading-title">{heading}</h3>
          <dl className="result-saved-details">
            <div><dt>{t("Language")}</dt><dd>{summary.language === "fil" ? "Filipino" : summary.language === "en" ? "English" : t("Not recorded")}</dd></div>
            <div><dt>{t("Completed")}</dt><dd><time dateTime={summary.completedAt}>{new Date(summary.completedAt).toLocaleString()}</time></dd></div>
          </dl>
        </section>

        {!loaded ? (
          error ? (
            <div role="alert" className="result-feedback-card">
              <p>{message(error, "Unable to load this saved assessment.")}</p>
              <button type="button" className="result-feedback-button" onClick={() => setRevision((value) => value + 1)}>{t("Retry")}</button>
            </div>
          ) : (
            <p className="result-feedback-note" role="status">{t("Loading saved assessment…")}</p>
          )
        ) : (
          <>
            {/* F6: transcript-based reading result, exactly as saved. */}
            <section className="result-feedback-card" aria-labelledby="saved-result-title">
              <h3 id="saved-result-title">{t("Your Reading Result")}</h3>
              <dl className="result-feedback-summary">
                <div>
                  <dt>{t("Reading Accuracy")}</dt>
                  <dd className="result-feedback-summary-value">{Math.round(loaded.pronunciationAccuracy)}%</dd>
                </div>
                <div>
                  <dt>{t("Words Matched")}</dt>
                  <dd className="result-feedback-summary-value">
                    {loaded.expectedWordCount > 0 ? t("{matched} of {total}", { matched, total: loaded.expectedWordCount }) : t("Not assessed")}
                  </dd>
                </div>
                <div>
                  <dt>{t("Reading Speed")}</dt>
                  <dd className="result-feedback-summary-value">{t("{wpm} words per minute", { wpm: Math.round(loaded.readingSpeedWpm) })}</dd>
                </div>
              </dl>
              {/* Filipino F3: the same saved values, so only its explanation is added here. */}
              {loaded.language === "fil" && loaded.scoringVersion === 2 && <p className="result-feedback-note">{t(READING_ACCURACY_EXPLANATION)}</p>}
            </section>

            {/* Filipino F2 feedback: the same saved attempt and the same text as the result page. */}
            {loaded.language === "fil" && <FilipinoReadingFeedback attempt={loaded} uiLanguage={language} />}

            {/* F2-F4: the saved English pronunciation check only. */}
            {loaded.language !== "en" ? (
              <section className="result-feedback-card" aria-labelledby="saved-pronunciation-title">
                <h3 id="saved-pronunciation-title"><Gauge size={22} aria-hidden="true" />{t("Pronunciation Accuracy")}</h3>
                <p className="result-feedback-message">{t("Not assessed")}</p>
                <p className="result-feedback-note">{t("Pronunciation checks are available for English readings only.")}</p>
              </section>
            ) : pronunciation.status === "done" && pronunciation.summary && story ? (
              <>
                <section className="result-feedback-card" aria-labelledby="saved-feedback-title">
                  <h3 id="saved-feedback-title"><MessageCircle size={22} aria-hidden="true" />{t("Pronunciation Feedback")}</h3>
                  <p className="result-feedback-message">{pronunciationOverview(pronunciation.summary, { wordsBelow: true })}</p>
                </section>
                {/* These two panels show the partial-coverage notice themselves when it applies. */}
                <PronunciationAccuracyPanel check={pronunciation} story={story} />
                <PronunciationWordsPanel check={pronunciation} story={story} />
              </>
            ) : (
              <section className="result-feedback-card" aria-labelledby="saved-pronunciation-title">
                <h3 id="saved-pronunciation-title"><Mic size={22} aria-hidden="true" />{t("Pronunciation Accuracy")}</h3>
                {pronunciation.status === "loading" ? (
                  <p className="result-feedback-note" role="status">Loading saved pronunciation check…</p>
                ) : pronunciation.status === "pending" || pronunciation.status === "checking" ? (
                  <p className="result-feedback-note" role="status">The pronunciation check for this reading is still running.</p>
                ) : (
                  <>
                    <p className="result-feedback-message">{t("Not assessed")}</p>
                    <p className="result-feedback-note">
                      {pronunciation.loadError ? pronunciation.loadError : "This reading has no saved pronunciation check."}
                    </p>
                  </>
                )}
              </section>
            )}

            {/* Filipino F4: the word list appears once in F7, in this section. */}
            {loaded.language === "fil" && <FilipinoWordReviewPanel attempt={loaded} uiLanguage={language} />}

            <RecordingPlayback key={loaded.id} attemptId={loaded.id} language={language} />
            <SavedTranscript attempt={loaded} />
          </>
        )}
      </div>
    </M5Modal>
  );
}
