import { activityLanguageFromState, activityLanguageState, getActivityText } from "./activityLanguage";
import { comprehensionTargetForReading } from "../../modules/module5/services/comprehensionNavigation";
import { BookOpen, Gauge, Headphones, ListChecks, MessageCircle, Mic, Sparkles, Star, Volume2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import "@fontsource/fredoka/latin-600.css";
import "@fontsource/nunito/latin-600.css";
import "@fontsource/nunito/latin-700.css";
import useAuthenticatedProfile from "../../hooks/useAuthenticatedProfile";
import { getFeedbackSpeech } from "../../services/feedbackSpeech";
import FeedbackSpeechControls, { useFeedbackSpeechState } from "../../components/reading-feedback/FeedbackSpeechControls";
import { getWordsToPractice } from "../../modules/module5/services/oralReadingProcessing";
import { getOralReadingAttempt, peekOralReadingAttempt, getOralReadingAttemptNumber, peekOralReadingAttemptNumber } from "../../modules/module5/services/oralReadingService";
import RecordingPlayback from "../../modules/module5/components/RecordingPlayback";
import {
  PronunciationAccuracyPanel,
  PronunciationFeedbackPanel,
  PronunciationWordsPanel,
  usePronunciationCheck,
} from "../../modules/module5/components/PronunciationFeedback";
import M5Modal from "../../modules/module5/components/M5Modal";
import type {
  LearnerM5Role,
  OralReadingAttempt,
  OralReadingWordMetric,
} from "../../modules/module5/types/oralReading";
import ActivityHeader from "./ActivityHeader";
import "./ActivityPage.css";
import "./ReadingResultPage.css";
import "../../modules/module5/components/M5Loading.css";

interface ReadingResultPageProps {
  role: LearnerM5Role;
}

/**
 * One panel per Appendix N function: F2 pronunciation feedback, F3 pronunciation
 * accuracy, F4 words to practice, F5 transcript, F6 oral reading result. F1 is
 * the read-aloud page and F7 is the Reading History page.
 */
type ResultPanel = "feedback" | "accuracy" | "words" | "transcript" | "result";
const RESULT_PANELS: readonly ResultPanel[] = ["feedback", "accuracy", "words", "transcript", "result"];

function panelFromParams(params: URLSearchParams): ResultPanel | null {
  const view = params.get("view");
  return RESULT_PANELS.find((panel) => panel === view) ?? null;
}

// Student-facing wording only: always encouraging, never a level or a grade.
function encouragement(accuracy: number) {
  if (accuracy >= 90) return "Wow, we heard almost every word of the story!";
  if (accuracy >= 75) return "Nice job! A few words need practice.";
  return "Good try! Let's practice some words.";
}

function starCount(accuracy: number) {
  return accuracy >= 90 ? 3 : accuracy >= 75 ? 2 : 1;
}

// Filipino readings have no pronunciation check; this is their F2 feedback.
const FILIPINO_FEEDBACK = "Pronunciation feedback is available for English readings only. Listen to your recording, then read the story again slowly and clearly.";

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
  const [searchParams, setSearchParams] = useSearchParams();
  const [panel, setPanel] = useState<ResultPanel | null>(() => panelFromParams(searchParams));
  const [feedbackOpened, setFeedbackOpened] = useState(panelFromParams(searchParams) === "feedback");
  // The open panel is kept in the address, so a refresh or a Reading History link reopens it.
  const openPanel = (next: ResultPanel) => {
    if (next === "feedback") setFeedbackOpened(true);
    setPanel(next);
    setSearchParams({ view: next }, { replace: true });
  };
  const closePanel = () => {
    setPanel(null);
    setSearchParams({}, { replace: true });
  };

  const cachedAttempt = peekOralReadingAttempt(attemptId, profile?.id);
  const [loadedAttempt, setAttempt] = useState<OralReadingAttempt | undefined>(cachedAttempt);
  const attempt = loadedAttempt?.id === attemptId && loadedAttempt?.userId === profile?.id ? loadedAttempt : cachedAttempt;
  const [revision, setRevision] = useState(0);
  const [numberedAttempt, setNumberedAttempt] = useState<{ id: string; userId: string; number: number }>();
  const [numberError, setNumberError] = useState(false);
  const [numberRevision, setNumberRevision] = useState(0);
  const numberRequest = useRef<{ key: string; promise: Promise<number | undefined> }>();
  const cachedNumber = peekOralReadingAttemptNumber(attemptId, profile?.id);
  const resultNumber = numberedAttempt && numberedAttempt.id === attemptId && numberedAttempt.userId === profile?.id
    ? numberedAttempt.number : cachedNumber;
  useEffect(() => {
    let active = true;
    setNumberError(false);
    if (!attempt || cachedNumber !== undefined) return;
    const key = `${attempt.userId}:${attempt.id}:${numberRevision}`;
    if (numberRequest.current?.key !== key) {
      numberRequest.current = { key, promise: getOralReadingAttemptNumber(attempt) };
    }
    void numberRequest.current.promise.then(number => {
      if (active && number !== undefined) setNumberedAttempt({ id: attempt.id, userId: attempt.userId, number });
    }).catch(() => { if (active) setNumberError(true); });
    return () => { active = false; };
  }, [attempt, cachedNumber, numberRevision]);
  const ui = getActivityText(attempt ? attempt.language : activityLanguageFromState(location.state));
  const { language, t } = ui;
  const activityState = activityLanguageState(language);
  const [error, setError] = useState<string>();
  const [speakingWord, setSpeakingWord] = useState<string>();
  const [speechError, setSpeechError] = useState<string>();
  const speech = getFeedbackSpeech();
  const speechState = useFeedbackSpeechState();
  // English only, started by the learner; one shared check per account and attempt feeds the
  // F2, F3 and F4 panels and survives closing, switching or remounting them.
  const pronunciation = usePronunciationCheck(attempt?.language === "en" ? attempt.id : undefined, attempt?.userId);

  const moduleRoot =
    role === "admin"
      ? "/admin/oral-reading/modules"
      : role === "student"
      ? "/dashboard/materials"
      : "/m3/general/modules";

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

    setError(undefined);
    setPanel(panelFromParams(searchParams));
    if (panelFromParams(searchParams) === "feedback") setFeedbackOpened(true);

    if (!attemptId) {
      setError("Oral-reading result not found.");

      return () => {
        active = false;
      };
    }

    const cached = peekOralReadingAttempt(attemptId, profile?.id);
    if (cached && revision === 0) {
      setAttempt(cached);
      return () => { active = false; };
    }
    void getOralReadingAttempt(attemptId, revision > 0)
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
      });

    return () => {
      active = false;
    };
  }, [attemptId, profile?.id, revision]);

  // Leaving the result stops any word or feedback audio.
  useEffect(() => () => speech.stop(), [speech]);

  // The shared player plays one clip at a time and reuses audio it already fetched.
  const playWord = async (word: string) => {
    if (!attempt || speakingWord) return;

    setSpeakingWord(word);
    setSpeechError(undefined);

    const finished = await speech.play(word, attempt.language, undefined, "philippine");
    if (!finished && speech.getState().status === "error") {
      setSpeechError(
        "Pronunciation audio is unavailable right now. Please try again.",
      );
    }
    setSpeakingWord(undefined);
  };

  if (!attempt) {
    return (
      <div className="activity-page-shell reading-result-page" lang={language}>
        <ActivityHeader uiLanguage={language}
          title={t("Oral Reading Result")}
          language=""
          onBack={() => navigate(backTarget)}
          showAccount={false}
        />

        <div className="activity-page">
          <div
            className="result-feedback"
            role={error ? "alert" : "status"}
          >
            <header className="result-feedback-hero m5-pending-content" aria-busy={!error}>
              <h2>{t("Oral Reading Result")}</h2>
              {!error && <span className="m5-loading-indicator" aria-hidden="true" />}

            <p>{error ? ui.message(error, "Unable to load the result.") : t("Loading your oral-reading result...")}</p>

            </header>
            {!error && <div className="result-panel-cards" aria-hidden="true">
              {[1, 2, 3].map(index => <div className="m5-loading-placeholder" key={index} />)}
            </div>}
            {error && <button className="result-feedback-button" type="button" onClick={() => setRevision(value => value + 1)}>{t("Retry")}</button>}
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
  const notDetectedWords = new Set(
    attempt.wordMetrics
      .filter((word) => word.type === "omission")
      .map((word) => word.expected),
  );

  const comprehensionTarget = comprehensionTargetForReading(role, attempt);
  // Learners are told when a reading has no comprehension activity, rather than
  // the button silently disappearing. Read-aloud-only activities and admin
  // self-practice never have questions, so they show nothing extra.
  const comprehensionUnavailable = !comprehensionTarget && role !== "admin" && attempt.readAloudOnly !== true;
  const accuracy = Math.round(attempt.pronunciationAccuracy);
  const stars = starCount(accuracy);
  const correctWordCount = attempt.wordMetrics.filter((word) => word.type === "match").length;
  const transcriptParts = markTranscript(attempt.transcript ?? "", attempt.wordMetrics);
  const pronunciationScore = pronunciation.status === "done" ? pronunciation.summary?.accuracy ?? null : null;
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
    <div className="activity-page-shell reading-result-page" lang={language}>
      <ActivityHeader uiLanguage={language}
        title={attempt.moduleTitle}
        language={language === "fil" ? "Filipino" : "English"}
        onBack={() => navigate(backTarget)}
        showAccount={false}
      />

      <div className="activity-page">
        <div className="result-feedback">
          {/* The reading summary stays on the page; each function opens in its own floating panel. */}
          <header className="result-feedback-hero" aria-labelledby="reading-feedback-title">
            <Sparkles className="result-feedback-hero-icon" size={40} aria-hidden="true" />
            <h2 id="reading-feedback-title">{t("Great reading, ")}{readerName}!</h2>
            <p className="result-feedback-story">{attempt.passageTitle || attempt.moduleTitle}{resultNumber !== undefined && <> — {t("Result")} {resultNumber}</>}</p>
            {numberError && <p role="status">{t("Unable to load the result number.")} <button type="button" onClick={() => setNumberRevision(value => value + 1)}>{t("Retry")}</button></p>}
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

          {attempt.readAloudOnly === true && <p className="result-feedback-message result-feedback-status" role="status">{attempt.readAloudCompleted
            ? t("Read-aloud activity completed. Your oral-reading result has been saved.")
            : t("Your oral-reading result has been saved. Reopen the activity from your Learning Room to finish updating its status.")}</p>}

          <nav className="result-panel-cards" aria-label={t("Reading result sections")}>
            <button type="button" className="result-panel-card result-panel-card--feedback" aria-haspopup="dialog" onClick={() => openPanel("feedback")}>
              <MessageCircle size={28} aria-hidden="true" />
              <span className="result-panel-card-title">{t("Pronunciation Feedback")}</span>
              <span className="result-panel-card-text">{t("Get tips about how clearly you said the words.")}</span>
            </button>
            <button type="button" className="result-panel-card result-panel-card--accuracy" aria-haspopup="dialog" onClick={() => openPanel("accuracy")}>
              <Gauge size={28} aria-hidden="true" />
              <span className="result-panel-card-title">{t("Pronunciation Accuracy")}</span>
              <span className="result-panel-card-text">{t("See your pronunciation and fluency scores.")}</span>
              {pronunciationScore !== null && <strong className="result-panel-card-value">{pronunciationScore}/100</strong>}
            </button>
            <button type="button" className="result-panel-card result-panel-card--words" aria-haspopup="dialog" onClick={() => openPanel("words")}>
              <ListChecks size={28} aria-hidden="true" />
              <span className="result-panel-card-title">{t("Words to Practice")}</span>
              <span className="result-panel-card-text">{t("Listen to words and practice saying them.")}</span>
            </button>
            <button type="button" className="result-panel-card result-panel-card--transcript" aria-haspopup="dialog" onClick={() => openPanel("transcript")}>
              <Headphones size={28} aria-hidden="true" />
              <span className="result-panel-card-title">{t("Read-Aloud Transcript")}</span>
              <span className="result-panel-card-text">{t("Compare the story with what we heard.")}</span>
            </button>
            <button type="button" className="result-panel-card result-panel-card--result" aria-haspopup="dialog" onClick={() => openPanel("result")}>
              <Star size={28} aria-hidden="true" />
              <span className="result-panel-card-title">{t("Oral Reading Result")}</span>
              <span className="result-panel-card-text">{t("See your reading accuracy, speed, and words read correctly.")}</span>
              <strong className="result-panel-card-value">{accuracy}%</strong>
            </button>
          </nav>

          {/* F2 Receive Pronunciation Feedback: words only, no scores, word list or transcript. */}
          <M5Modal
            id="m5-panel-feedback"
            title={t("Pronunciation Feedback")}
            closeLabel={t("Close")}
            open={panel === "feedback"}
            onClose={closePanel}
          >
            {language === "en" ? (
              <PronunciationFeedbackPanel check={pronunciation} />
            ) : (
              <section className="result-feedback-card" aria-labelledby="pronunciation-unsupported-title">
                <h3 id="pronunciation-unsupported-title"><Mic size={22} aria-hidden="true" />{t("Pronunciation Check")}</h3>
                <p className="result-feedback-message">
                  {t(FILIPINO_FEEDBACK)}
                  <FeedbackSpeechControls text={t(FILIPINO_FEEDBACK)} language={language} voice="philippine" listenLabel="Listen to feedback" />
                </p>
              </section>
            )}
            {feedbackOpened && <RecordingPlayback key={attempt.id} attemptId={attempt.id} language={language} />}
          </M5Modal>

          {/* F3 View Pronunciation Accuracy: pronunciation-check scores only, never Reading Accuracy. */}
          <M5Modal
            id="m5-panel-accuracy"
            title={t("Pronunciation Accuracy")}
            closeLabel={t("Close")}
            open={panel === "accuracy"}
            onClose={closePanel}
          >
            {language === "en" ? (
              <PronunciationAccuracyPanel check={pronunciation} />
            ) : (
              <section className="result-feedback-card" aria-labelledby="pronunciation-accuracy-unsupported-title">
                <h3 id="pronunciation-accuracy-unsupported-title"><Gauge size={22} aria-hidden="true" />{t("Pronunciation Check")}</h3>
                <p className="result-feedback-note">{t("Pronunciation Accuracy is available for English readings only, so this reading has no pronunciation score. Your Reading Accuracy is in Oral Reading Result.")}</p>
              </section>
            )}
          </M5Modal>

          {/* F4 View Mispronounced Words: the check's words; transcript differences are labelled apart. */}
          <M5Modal
            id="m5-panel-words"
            title={t("Words to Practice")}
            closeLabel={t("Close")}
            open={panel === "words"}
            onClose={closePanel}
          >
            {language === "en" ? (
              <PronunciationWordsPanel check={pronunciation} />
            ) : (
              <section className="result-feedback-card" aria-labelledby="pronunciation-words-unsupported-title">
                <h3 id="pronunciation-words-unsupported-title"><Mic size={22} aria-hidden="true" />{t("Pronunciation Check")}</h3>
                <p className="result-feedback-note">{t("The pronunciation check is available for English readings only, so it has not marked any words in this reading.")}</p>
              </section>
            )}

            <section className="result-feedback-card result-feedback-card--cream" aria-labelledby="words-heard-differently-title">
              <h3 id="words-heard-differently-title"><Headphones size={22} aria-hidden="true" />{t("Words We Heard Differently")}</h3>
              <p className="result-feedback-note">{t("These words come from comparing what we heard with the story. They are not a pronunciation check.")}</p>
              {wordsToPractice.length > 0 ? (
                <>
                  <p className="result-feedback-message">{t("Listen to the word, say it slowly, and try reading it again.")}</p>
                  <ul className="result-feedback-words">
                    {wordsToPractice.map((word) => (
                      <li key={word} className="result-feedback-word">
                        <span>{word}</span>
                        <small>{notDetectedWords.has(word) ? t("not detected") : t("read differently")}</small>
                        <button
                          type="button"
                          className="result-feedback-listen"
                          disabled={Boolean(speakingWord) || speechState.muted}
                          aria-label={speakingWord === word ? t("Playing {word}", { word }) : t("Listen to {word}", { word })}
                          onClick={() => void playWord(word)}
                        >
                          <Volume2 size={20} aria-hidden="true" />
                        </button>
                      </li>
                    ))}
                  </ul>
                  <p className="result-feedback-note">
                    {t("\"Not detected\" means we did not hear the word in your reading. You may have skipped it, or the recording may have missed it. \"Read differently\" means we heard another word. Speech recognition can make mistakes, so this is not always a reading or pronunciation mistake.")}
                  </p>
                </>
              ) : (
                <p className="result-feedback-message">{t("No words to practice. Amazing!")}</p>
              )}
              {speechError && (
                <p className="result-feedback-note" role="alert">
                  {ui.message(speechError, "Pronunciation audio is unavailable right now. Please try again.")}
                </p>
              )}
            </section>
          </M5Modal>

          {/* F5 View Read-Aloud Transcript: the story, what we heard and its differences; no scores. */}
          <M5Modal
            id="m5-panel-transcript"
            title={t("Read-Aloud Transcript")}
            closeLabel={t("Close")}
            open={panel === "transcript"}
            onClose={closePanel}
          >
            {attempt.passageSnapshot?.trim() && (
              <section className="result-feedback-card" aria-labelledby="passage-title">
                <h3 id="passage-title"><BookOpen size={22} aria-hidden="true" />{t("The story")}</h3>
                <p className="result-feedback-transcript">{attempt.passageSnapshot}</p>
              </section>
            )}

            <section className="result-feedback-card result-feedback-card--cream" aria-labelledby="transcript-title">
              <h3 id="transcript-title">
                <Headphones size={22} aria-hidden="true" />{t("What we heard")}</h3>
              {attempt.transcript?.trim() ? (
                <p className="result-feedback-transcript">
                  {transcriptParts.map((part, index) => part.differs
                    ? <mark key={index} className="result-feedback-different">{part.text}</mark>
                    : part.text)}
                </p>
              ) : (
                <p className="result-feedback-note">{t("No transcript was saved for this reading.")}</p>
              )}
              <p className="result-feedback-note">{transcriptParts.some((part) => part.differs)
                ? t("Highlighted words did not match the story. Speech recognition can make mistakes.")
                : t("Speech recognition can make mistakes.")}</p>
            </section>
          </M5Modal>

          {/* F6 View Oral Reading Result: transcript-based reading accuracy, speed and words read correctly. */}
          <M5Modal
            id="m5-panel-result"
            title={t("Oral Reading Result")}
            closeLabel={t("Close")}
            open={panel === "result"}
            onClose={closePanel}
          >
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

            <section className="result-feedback-card" aria-labelledby="oral-result-title">
              <h3 id="oral-result-title">{t("Your Reading Result")}</h3>
              <dl className="result-feedback-summary">
                <div>
                  <dt>{t("Reading speed")}</dt>
                  <dd>{Math.round(attempt.readingSpeedWpm)} {t("words per minute")}</dd>
                </div>
                <div>
                  <dt>{t("Words read correctly")}</dt>
                  <dd>{correctWordCount}{t(" of ")}{attempt.expectedWordCount}</dd>
                </div>
              </dl>
            </section>
          </M5Modal>

          {comprehensionUnavailable && (
            <p className="result-feedback-note result-feedback-status" role="note">
              {t("Comprehension questions are not available for this story yet. Your reading result is saved.")}
            </p>
          )}
          <div className="result-feedback-actions">
            {comprehensionTarget && (
              <Link
                className="result-feedback-button result-feedback-button--primary"
                to={comprehensionTarget}
                state={activityState}
              >{t("Continue to Questions")}</Link>
            )}
            {readAgainTarget && (
              <Link className="result-feedback-button result-feedback-button--primary" to={readAgainTarget} state={activityState}>
                <Mic size={20} aria-hidden="true" />{t("Read again")}</Link>
            )}
            <button
              className="result-feedback-button result-feedback-button--primary"
              type="button"
              onClick={() => navigate(backTarget)}
            >{t("Back to my activities")}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
