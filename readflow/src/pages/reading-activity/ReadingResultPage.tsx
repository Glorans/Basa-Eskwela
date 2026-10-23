import { activityLanguageFromState, activityLanguageState, getActivityText } from "./activityLanguage";
import { comprehensionTargetForReading } from "../../modules/module5/services/comprehensionNavigation";
import { Headphones, Mic, Sparkles, Star, Volume2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import "@fontsource/fredoka/latin-600.css";
import "@fontsource/nunito/latin-600.css";
import "@fontsource/nunito/latin-700.css";
import useAuthenticatedProfile from "../../hooks/useAuthenticatedProfile";
import { synthesizeDiagnosticSpeech } from "../../modules/module2/services/diagnosticTts";
import { getWordsToPractice } from "../../modules/module5/services/oralReadingProcessing";
import { getOralReadingAttempt } from "../../modules/module5/services/oralReadingService";
import RecordingPlayback from "../../modules/module5/components/RecordingPlayback";
import PronunciationFeedback from "../../modules/module5/components/PronunciationFeedback";
import type {
  LearnerM5Role,
  OralReadingAttempt,
  OralReadingWordMetric,
} from "../../modules/module5/types/oralReading";
import ActivityHeader from "./ActivityHeader";
import "./ActivityPage.css";
import "./ReadingResultPage.css";

interface ReadingResultPageProps {
  role: LearnerM5Role;
}

// Student-facing wording only: always encouraging, never a level or a grade.
function encouragement(accuracy: number) {
  if (accuracy >= 90) return "Wow, you read it very clearly!";
  if (accuracy >= 75) return "Nice job! A few words need practice.";
  return "Good try! Let's practice some words.";
}

function starCount(accuracy: number) {
  return accuracy >= 90 ? 3 : accuracy >= 75 ? 2 : 1;
}

const cleanWord = (word: string) =>
  word.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}'-]/gu, "");

/**
 * Marks transcript words that differ from the story. Word metrics list heard
 * words in order, so they line up with the transcript when the counts agree;
 * otherwise fall back to words that were only ever heard differently.
 */
function markTranscript(transcript: string, metrics: readonly OralReadingWordMetric[]) {
  const parts = transcript.split(/(\s+)/);
  const heard = metrics.filter((metric) => metric.actual !== null);
  const positional = heard.length === parts.filter((part) => part.trim()).length;
  const matched = new Set(heard.filter((metric) => metric.type === "match").map((metric) => cleanWord(metric.actual ?? "")));
  const different = new Set(heard.filter((metric) => metric.type !== "match").map((metric) => cleanWord(metric.actual ?? "")));
  let index = 0;
  return parts.map((text) => {
    if (!text.trim()) return { text, differs: false };
    const metric = heard[index++];
    const word = cleanWord(text);
    const differs = positional
      ? metric.type !== "match"
      : different.has(word) && !matched.has(word);
    return { text, differs };
  });
}

export default function ReadingResultPage({ role }: ReadingResultPageProps) {
  const { attemptId } = useParams<{ attemptId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { profile } = useAuthenticatedProfile();

  const [loadedAttempt, setAttempt] = useState<OralReadingAttempt>();
  const attempt = loadedAttempt?.id === attemptId ? loadedAttempt : undefined;
  const ui = getActivityText(attempt ? attempt.language : activityLanguageFromState(location.state));
  const { language, t } = ui;
  const activityState = activityLanguageState(language);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [speakingWord, setSpeakingWord] = useState<string>();
  const [speechError, setSpeechError] = useState<string>();

  const audioRef = useRef<HTMLAudioElement>();
  const audioUrlRef = useRef<string>();

  const moduleRoot =
    role === "admin"
      ? "/admin/oral-reading/modules"
      : role === "student"
      ? "/dashboard/materials"
      : "/m3/general/modules";

  const historyTarget =
    role === "admin"
      ? "/admin/reading-history"
      : role === "student"
      ? "/dashboard/reading-history"
      : "/m3/general/reading-history";

  // Admin practice has no module-detail page; return to the passage list.
  const backTarget = role === "admin"
    ? "/admin/oral-reading"
    : attempt?.materialId && attempt.roomId
    ? `/dashboard/learning-rooms/${attempt.roomId}`
    : role === "student" && attempt?.roomId
      ? `/dashboard/learning-rooms/${attempt.roomId}`
      : attempt
        ? `${moduleRoot}/${attempt.moduleId}?${new URLSearchParams(
            attempt.passageId
              ? { passageId: attempt.passageId }
              : {},
          ).toString()}`
        : moduleRoot;

  const backLabel = role === "admin" ? "Back to Oral Reading" : attempt?.materialId ? "Back to Learning Room" :
    role === "student" && attempt?.roomId
      ? "Back to Classroom"
      : "Back to Reading Module";

  useEffect(() => {
    let active = true;

    setLoading(true);
    setError(undefined);
    setAttempt(undefined);

    if (!attemptId) {
      setLoading(false);
      setError("Oral-reading result not found.");

      return () => {
        active = false;
      };
    }

    void getOralReadingAttempt(attemptId)
      .then((loadedAttempt) => {
        if (active) setAttempt(loadedAttempt);
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Unable to load the result.",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [attemptId]);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();

      if (audioUrlRef.current) {
        URL.revokeObjectURL(audioUrlRef.current);
      }
    };
  }, []);

  const playWord = async (word: string) => {
    if (!attempt || speakingWord) return;

    setSpeakingWord(word);
    setSpeechError(undefined);

    try {
      const audioBlob = await synthesizeDiagnosticSpeech(
        word,
        attempt.language,
      );

      audioRef.current?.pause();

      if (audioUrlRef.current) {
        URL.revokeObjectURL(audioUrlRef.current);
      }

      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);

      audioRef.current = audio;
      audioUrlRef.current = audioUrl;

      await new Promise<void>((resolve, reject) => {
        audio.addEventListener("ended", () => resolve(), {
          once: true,
        });

        audio.addEventListener(
          "error",
          () => reject(new Error("Audio playback failed.")),
          { once: true },
        );

        void audio.play().catch(reject);
      });
    } catch {
      setSpeechError(
        "Pronunciation audio is unavailable right now. Please try again.",
      );
    } finally {
      setSpeakingWord(undefined);
    }
  };

  if (loading || !attempt) {
    return (
      <div className="activity-page-shell" lang={language}>
        <ActivityHeader uiLanguage={language}
          title={t("Oral Reading Result")}
          language=""
          onBack={() => navigate(backTarget)}
        />

        <div className="activity-page">
          <div
            className="activity-missing"
            role={error ? "alert" : "status"}
          >
            <Mic size={36} />

            <p>{error ? ui.message(error, "Unable to load the result.") : t("Loading your oral-reading result...")}</p>

            {error && (
              <button
                type="button"
                onClick={() => navigate(backTarget)}
              >
                {t(backLabel)}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const wordsToPractice = getWordsToPractice(attempt.wordMetrics);
  const notHeardWords = new Set(
    attempt.wordMetrics
      .filter((word) => word.type === "omission")
      .map((word) => word.expected),
  );

  const comprehensionTarget = comprehensionTargetForReading(role, attempt);
  const accuracy = Math.round(attempt.pronunciationAccuracy);
  const stars = starCount(accuracy);
  const correctWordCount = attempt.wordMetrics.filter((word) => word.type === "match").length;
  const transcriptParts = markTranscript(attempt.transcript ?? "", attempt.wordMetrics);
  const readerName = profile?.nickname?.trim() || profile?.full_name?.trim().split(/\s+/)[0] || t("reader");
  const readAgainTarget = attempt.materialId && attempt.roomId && attempt.activityAssignmentId
    ? `/dashboard/reading-materials/${encodeURIComponent(attempt.materialId)}/read-aloud?${new URLSearchParams({
      roomId: attempt.roomId, activityAssignmentId: attempt.activityAssignmentId, recordAgain: "1",
    })}`
    : attempt.moduleId
      ? `${moduleRoot}/${encodeURIComponent(attempt.moduleId)}/read-aloud?${new URLSearchParams({
        ...(attempt.passageId ? { passageId: attempt.passageId } : {}),
        ...(attempt.roomId ? { roomId: attempt.roomId } : {}),
        ...(attempt.assignmentId ? { assignmentId: attempt.assignmentId } : {}),
      })}`
      : null;

  return (
    <div className="activity-page-shell" lang={language}>
      <ActivityHeader uiLanguage={language}
        title={attempt.moduleTitle}
        language={language === "fil" ? "Filipino" : "English"}
        onBack={() => navigate(backTarget)}
      />

      <div className="activity-page">
        <div className="result-feedback">
          <Link
            className="result-history-link"
            to={historyTarget}
          >{t("Reading History")}</Link>

          <header className="result-feedback-hero" aria-labelledby="reading-feedback-title">
            <Sparkles className="result-feedback-hero-icon" size={40} aria-hidden="true" />
            <h2 id="reading-feedback-title">{t("Great reading, ")}{readerName}!</h2>
            <p className="result-feedback-story">{attempt.moduleTitle}</p>
            <p className="result-feedback-stars" aria-label={t("{stars} out of 3 stars", { stars })}>
              {[1, 2, 3].map((value) => (
                <Star
                  key={value}
                  size={34}
                  aria-hidden="true"
                  className={value <= stars ? "result-feedback-star result-feedback-star--on" : "result-feedback-star"}
                />
              ))}
            </p>
            <p className="result-feedback-message">{t(encouragement(accuracy))}</p>
          </header>

          <section className="result-feedback-card result-feedback-score" aria-labelledby="accuracy-title">
            <h3 id="accuracy-title">{t("Reading Accuracy")}</h3>
            <p className="result-feedback-score-value">{accuracy}%</p>
            <progress
              className="result-feedback-progress"
              value={accuracy}
              max={100}
              aria-labelledby="accuracy-title"
            >
              {accuracy}%
            </progress>
            <p className="result-feedback-note">{t("This score is transcript-based: it compares the words we heard with the story. Speech recognition can make mistakes.")}</p>
          </section>

          <section className="result-feedback-card result-feedback-card--cream" aria-labelledby="words-to-practice-title">
            <h3 id="words-to-practice-title">{t("Words to Practice")}</h3>
            {wordsToPractice.length > 0 ? (
              <ul className="result-feedback-words">
                {wordsToPractice.map((word) => (
                  <li key={word} className="result-feedback-word">
                    <span>{word}</span>
                    {notHeardWords.has(word) && <small>{t("not heard")}</small>}
                    <button
                      type="button"
                      className="result-feedback-listen"
                      disabled={Boolean(speakingWord)}
                      aria-label={speakingWord === word ? t("Playing {word}", { word }) : t("Listen to {word}", { word })}
                      onClick={() => void playWord(word)}
                    >
                      <Volume2 size={20} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="result-feedback-message">{t("No words to practice. Amazing!")}</p>
            )}
            {notHeardWords.size > 0 && (
              <p className="result-feedback-note">
                {t('A word marked "not heard" may have been skipped, or speech recognition may have missed it.')}
              </p>
            )}
            {speechError && (
              <p className="result-feedback-note" role="alert">
                {ui.message(speechError, "Pronunciation audio is unavailable right now. Please try again.")}
              </p>
            )}
          </section>

          <RecordingPlayback attemptId={attempt.id} language={language} />

          <PronunciationFeedback attemptId={attempt.id} language={language} />

          <section className="result-feedback-card result-feedback-card--cream" aria-labelledby="transcript-title">
            <h3 id="transcript-title">
              <Headphones size={22} aria-hidden="true" />{t("What we heard")}</h3>
            <p className="result-feedback-transcript">
              {transcriptParts.map((part, index) => part.differs
                ? <mark key={index} className="result-feedback-different">{part.text}</mark>
                : part.text)}
            </p>
            {transcriptParts.some((part) => part.differs) && (
              <p className="result-feedback-note">{t("Highlighted words sounded different from the story.")}</p>
            )}
          </section>

          <section className="result-feedback-card" aria-labelledby="oral-result-title">
            <h3 id="oral-result-title">{t("Your Reading Result")}</h3>
            <dl className="result-feedback-summary">
              <div>
                <dt>{t("Accuracy")}</dt>
                <dd>{accuracy}%</dd>
              </div>
              <div>
                <dt>{t("Reading speed")}</dt>
                <dd>{Math.round(attempt.readingSpeedWpm)} {t("words per minute")}</dd>
              </div>
              <div>
                <dt>{t("Words read correctly")}</dt>
                <dd>{correctWordCount}{t(" of ")}{attempt.expectedWordCount}</dd>
              </div>
            </dl>
            {attempt.readAloudOnly === true && <p className="result-feedback-message" role="status">{attempt.readAloudCompleted
              ? t("Read-aloud activity completed. Your oral-reading result has been saved.")
              : t("Your oral-reading result has been saved. Reopen the activity from your Learning Room to finish updating its status.")}</p>}
          </section>

          <div className="result-feedback-actions">
            {comprehensionTarget && (
              <Link
                className="result-feedback-button result-feedback-button--primary"
                to={comprehensionTarget}
                state={activityState}
              >{t("Continue to Questions")}</Link>
            )}
            {readAgainTarget && (
              <Link className="result-feedback-button" to={readAgainTarget} state={activityState}>
                <Mic size={20} aria-hidden="true" />{t("Read again")}</Link>
            )}
            <button
              className="result-feedback-button"
              type="button"
              onClick={() => navigate(backTarget)}
            >{t("Back to my activities")}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
