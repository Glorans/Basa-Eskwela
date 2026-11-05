import { BookOpen, Headphones } from "lucide-react";
import { getActivityText, type ActivityLanguage } from "../../../pages/reading-activity/activityLanguage";
import { markStory, markTranscript } from "../services/resultWords";
import type { OralReadingAttempt } from "../types/oralReading";

/**
 * F7: the saved story and what was heard, read-only. Uses the same marking as
 * F5: words that are different from the story are orange, and story words are
 * dashed only when the saved alignment lines up word for word (never guessed).
 * Differences are transcript findings, not pronunciation mistakes.
 */
export default function SavedTranscript({ attempt, uiLanguage }: { attempt: OralReadingAttempt; uiLanguage?: ActivityLanguage }) {
  // Labels follow the reading unless the view fixes them (Admin review is in English).
  const { t } = getActivityText(uiLanguage ?? attempt.language);
  const title = attempt.passageTitle || attempt.moduleTitle;
  const story = markStory(attempt.passageSnapshot ?? "", title, attempt.language, attempt.wordMetrics);
  const heard = markTranscript(attempt.transcript ?? "", attempt.wordMetrics, attempt.language);
  const anyDifferent = heard.pieces.some((piece) => piece.differs);
  const anySkipped = Boolean(story?.some((paragraph) => paragraph.some((piece) => piece.skipped)));
  return (
    <>
      {attempt.passageSnapshot?.trim() && (
        <section className="result-feedback-card" aria-labelledby="saved-story-title">
          <h3 id="saved-story-title"><BookOpen size={22} aria-hidden="true" />{t("The Story")}</h3>
          {story ? (
            <div className="result-feedback-transcript result-story-text">
              {story.map((paragraph, index) => (
                <p key={index}>
                  {paragraph.map((piece, pieceIndex) => piece.skipped
                    ? <span key={pieceIndex} className="result-skipped-word">{piece.text}<span className="result-visually-hidden">{t(" (not heard)")}</span></span>
                    : piece.text)}
                </p>
              ))}
            </div>
          ) : (
            <p className="result-feedback-transcript">{attempt.passageSnapshot}</p>
          )}
          {anySkipped && (
            <p className="result-legend">
              <span className="result-legend-swatch result-legend-swatch--skipped" aria-hidden="true" />
              {t("Words with a dashed line were not heard.")}
            </p>
          )}
        </section>
      )}
      <section className="result-feedback-card result-feedback-card--cream" aria-labelledby="saved-heard-title">
        <h3 id="saved-heard-title"><Headphones size={22} aria-hidden="true" />{t("What We Heard")}</h3>
        {attempt.transcript?.trim() ? (
          <p className="result-feedback-transcript">
            {heard.pieces.map((piece, index) => piece.differs
              ? <mark key={index} className="result-feedback-different">{piece.text}<span className="result-visually-hidden">{t(" (different from the story)")}</span></mark>
              : piece.text)}
          </p>
        ) : (
          <p className="result-feedback-note">{t("No transcript was saved for this reading.")}</p>
        )}
        {anyDifferent && (
          <p className="result-legend">
            <span className="result-legend-swatch result-legend-swatch--different" aria-hidden="true" />
            {t("Orange words are different from the story.")}
          </p>
        )}
        <p className="result-feedback-note">{t("Sometimes the computer can make mistakes when listening.")}</p>
      </section>
    </>
  );
}
