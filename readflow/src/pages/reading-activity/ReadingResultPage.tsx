import { activityLanguageFromState, activityLanguageState, getActivityText } from "./activityLanguage";
import { PRACTICE_PATHS, comprehensionActivityTarget, comprehensionResultTarget, comprehensionTargetForReading, isPracticeRole, learningAreaTarget } from "../../modules/module5/services/comprehensionNavigation";
import { getComprehensionForReading, type LinkedComprehension } from "../../modules/module6/services/comprehensionService";
import { BookOpen, Gauge, Headphones, ListChecks, MessageCircle, Mic, Sparkles, Star } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import "@fontsource/fredoka/latin-600.css";
import "@fontsource/nunito/latin-600.css";
import "@fontsource/nunito/latin-700.css";
import useAuthenticatedProfile from "../../hooks/useAuthenticatedProfile";
import { getFeedbackSpeech } from "../../services/feedbackSpeech";
import { markStory, markTranscript, readingAccuracyMessage } from "../../modules/module5/services/resultWords";
import { getOralReadingAttempt, peekOralReadingAttempt, getOralReadingAttemptNumber, peekOralReadingAttemptNumber } from "../../modules/module5/services/oralReadingService";
import FilipinoReadingFeedback, { FilipinoReadingAccuracyPanel, FilipinoWordReviewPanel, filipinoDifferenceCount } from "../../modules/module5/components/FilipinoReadingFeedback";
import RecordingPlayback from "../../modules/module5/components/RecordingPlayback";
import {
  PronunciationAccuracyPanel,
  PronunciationFeedbackPanel,
  PronunciationWordsPanel,
  practiceWordTotal,
  usePronunciationCheck,
} from "../../modules/module5/components/PronunciationFeedback";
import M5Modal from "../../modules/module5/components/M5Modal";
import type {
  LearnerM5Role,
  OralReadingAttempt,
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

export default function ReadingResultPage({ role }: ReadingResultPageProps) {
  const { attemptId } = useParams<{ attemptId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { profile } = useAuthenticatedProfile();
  const [searchParams, setSearchParams] = useSearchParams();
  const [panel, setPanel] = useState<ResultPanel | null>(() => panelFromParams(searchParams));
  const [feedbackOpened, setFeedbackOpened] = useState(panelFromParams(searchParams) === "feedback");
  // F4 loads the learner's recording only once it has been opened.
  const [wordsOpened, setWordsOpened] = useState(panelFromParams(searchParams) === "words");
  // The open panel is kept in the address, so a refresh or a Reading History link reopens it.
  const openPanel = (next: ResultPanel) => {
    if (next === "feedback") setFeedbackOpened(true);
    if (next === "words") setWordsOpened(true);
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
  // F5: the orange heard word the learner selected, to show the story word in its place.
  const [selectedWord, setSelectedWord] = useState<number>();
  const speech = getFeedbackSpeech();
  // English only; one shared check per account and attempt feeds the F2, F3 and F4 panels and the result cards, and
  // survives closing, switching or remounting them.
  const pronunciation = usePronunciationCheck(attempt?.language === "en" ? attempt.id : undefined, attempt?.userId);
  // The English pronunciation check starts as soon as the result opens (the recording was saved before this page),
  // not when Pronunciation Feedback is opened. Once per reading: a saved result is reused and never re-checked, a
  // check already running (another tab, a refresh) is joined by the server, and a failed automatic check is not
  // repeated on its own in this browser session (Try Again stays in the Feedback panel). Opening a card only shows it.
  const { autoCheck: startPronunciationCheck, status: pronunciationStatus, loadError: pronunciationLoadError } = pronunciation;
  useEffect(() => {
    if (attempt?.language === "en" && pronunciationStatus === "idle" && !pronunciationLoadError) startPronunciationCheck();
  }, [attempt?.language, pronunciationStatus, pronunciationLoadError, startPronunciationCheck]);

  const moduleRoot =
    isPracticeRole(role)
      ? PRACTICE_PATHS[role].modules
      : role === "student"
      ? "/dashboard/materials"
      : "/m3/general/modules";

  // The reading's Learning Room, or its Reading Module (shared with the M6 results page).
  const backTarget = learningAreaTarget(role, attempt).to;

  const backLabel = role === "admin" ? "Back to Oral Reading" : role === "teacher" || role === "system_admin" ? "Back to Reading Practice" : attempt?.materialId ? (role === "general_user" ? "Back to Material" : "Back to Learning Room") :
    role === "student" && attempt?.roomId
      ? "Back to Classroom"
      : "Back to Reading Module";

  useEffect(() => {
    let active = true;

    setError(undefined);
    setPanel(panelFromParams(searchParams));
    if (panelFromParams(searchParams) === "feedback") setFeedbackOpened(true);
    if (panelFromParams(searchParams) === "words") setWordsOpened(true);

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

  // The M6 activity already linked to this saved reading, read from the server (free; it never starts one).
  // undefined while checking; null when there is none or the check failed.
  const comprehensionEligible = Boolean(attempt && comprehensionTargetForReading(role, attempt));
  const [linkedComprehension, setLinkedComprehension] = useState<{ readingId: string; attempt: LinkedComprehension | null }>();
  useEffect(() => {
    if (!attempt || !comprehensionEligible) return undefined;
    let active = true;
    const readingId = attempt.id;
    void getComprehensionForReading(readingId)
      .then((found) => { if (active) setLinkedComprehension({ readingId, attempt: found }); })
      // Without the saved status, keep the existing Continue to Questions path: it reopens a saved activity and never duplicates it.
      .catch(() => { if (active) setLinkedComprehension({ readingId, attempt: null }); });
    return () => { active = false; };
  }, [attempt?.id, comprehensionEligible]);

  // Leaving the result stops any example-word audio (F4).
  useEffect(() => () => speech.stop(), [speech]);

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

  const comprehensionTarget = comprehensionTargetForReading(role, attempt);
  const linked = linkedComprehension?.readingId === attempt.id ? linkedComprehension : undefined;
  // Every role with an M6 path (Admin practice included) reopens its own completed activity.
  const completedComprehension = linked?.attempt?.status === "completed" ? linked.attempt : null;
  // An unfinished assessment already found for this reading opens directly instead of through the M6 introduction's
  // "Continue Comprehension" (one click, not two): module readings and an Independent Learner's own material, exactly
  // where that introduction is shown. Classroom material activities keep their existing path (the server reopens them).
  // A new assessment keeps the introduction and its Start Comprehension.
  const introductionResume = !attempt?.materialId || (role === "general_user" && !attempt.roomId && !attempt.activityAssignmentId);
  const unfinishedComprehension = introductionResume && linked?.attempt && linked.attempt.status !== "completed" ? linked.attempt : null;
  // Learners are told when a reading has no comprehension activity, rather than
  // the button silently disappearing. Read-aloud-only activities and admin
  // self-practice never have questions, so they show nothing extra.
  // A Student's personal practice (a published module outside any classroom): same results and comprehension,
  // labelled as personal.
  const studentPersonalPractice = role === "student" && !attempt.materialId && !attempt.roomId;
  const comprehensionUnavailable = !comprehensionTarget && !isPracticeRole(role) && attempt.readAloudOnly !== true;
  // F2, F3 and F4 labels: a Filipino reading gets transcript-based results, not a pronunciation check.
  const filipino = language === "fil";
  const feedbackTitle = t(filipino ? "Reading Feedback" : "Pronunciation Feedback");
  const feedbackCardText = t(filipino ? "Compare the story with the words the computer heard." : "Get tips about how clearly you said the words.");
  const accuracyTitle = t(filipino ? "Reading Accuracy" : "Pronunciation Accuracy");
  const accuracyCardText = t(filipino ? "How closely the words we heard matched the story." : "See your pronunciation accuracy score.");
  const wordsTitle = t(filipino ? "Words to Review" : "Mispronounced Words");
  const wordsCardText = t(filipino ? "Listen to the story words and compare them with what the computer heard." : "Listen to words and practice saying them.");
  const accuracy = Math.round(attempt.pronunciationAccuracy);
  const correctWordCount = attempt.wordMetrics.filter((word) => word.type === "match").length;
  // Every scored story word matched and nothing was different or extra (F6 wording only).
  const everyWordMatched = attempt.wordMetrics.length > 0 && attempt.wordMetrics.every((word) => word.type === "match")
    && correctWordCount === attempt.expectedWordCount;
  const flaggedWords = pronunciation.status === "done" ? pronunciation.summary?.wordsToPractice.length ?? 0 : 0;
  // Filipino F4 shows the full recording below its word list, as English does below flagged words.
  const reviewedWords = filipino && attempt.transcript?.trim() ? attempt.wordMetrics.filter((word) => word.type !== "match").length : 0;
  const storyTitle = attempt.passageTitle || attempt.moduleTitle;
  // F5: marks appear only where the saved word metrics line up exactly with the text.
  const heard = markTranscript(attempt.transcript ?? "", attempt.wordMetrics, attempt.language);
  const markedStory = markStory(attempt.passageSnapshot ?? "", storyTitle, attempt.language, attempt.wordMetrics);
  const anyDifferent = heard.pieces.some((piece) => piece.differs);
  const anySkipped = Boolean(markedStory?.some((paragraph) => paragraph.some((piece) => piece.skipped)));
  const selectedPiece = selectedWord === undefined ? undefined : heard.pieces[selectedWord];
  const pronunciationStory = { passage: attempt.passageSnapshot ?? "", title: storyTitle };
  const pronunciationScore = pronunciation.status === "done" ? pronunciation.summary?.accuracy ?? null : null;
  // Result cards: real numbers only, or a status while the English check is still running (never a fake 0).
  const pronunciationSummary = pronunciation.status === "done" ? pronunciation.summary : undefined;
  const pronunciationWorking = !filipino && !pronunciationSummary && (pronunciation.status === "loading" || pronunciation.status === "checking"
    || pronunciation.status === "pending" || (pronunciation.status === "idle" && !pronunciation.loadError && !pronunciation.autoTried));
  const englishCardStatus = !pronunciationSummary
    ? (pronunciationWorking ? t("Processing…") : t("Not available yet. Open to try again."))
    : pronunciationSummary.utterances === 0 ? t("No speech was detected.") : null;
  const practiceTotal = pronunciationSummary && pronunciationSummary.utterances > 0 ? practiceWordTotal(pronunciationSummary) : null;
  const differenceCount = filipino ? filipinoDifferenceCount(attempt) : null;
  const transcribedWords = (attempt.transcript ?? "").trim() ? (attempt.transcript ?? "").trim().split(/\s+/u).length : 0;
  // Every card ends with the same block at its bottom: the caption (what the value is), then the value (a score, a
  // percentage or a count) as the card's last line, so the values line up across a row even when a caption wraps.
  // While the English check runs, or when there is no value, a clear status takes the value's place (never a fake 0).
  const cardMetric = (value: string | number | null, caption: string, status?: string | null) => (
    <span className="result-panel-card-metric">
      <span className="result-panel-card-caption">{caption}</span>
      {value !== null
        ? <strong className="result-panel-card-value">{value}</strong>
        : <span className="result-panel-card-status" role="status" aria-live="polite">{status}</span>}
    </span>
  );
  const noSpeech = t("No speech was detected.");
  const readAgainTarget = role === "general_user" && attempt.materialId && !attempt.roomId
    ? `/m3/general/materials/${encodeURIComponent(attempt.materialId)}/read-aloud?recordAgain=1`
    : attempt.materialId && attempt.roomId && attempt.activityAssignmentId
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
            {/* A neutral completion message: the panels below hold the results, so the summary never contradicts them. */}
            <h2 id="reading-feedback-title">{t("Reading Complete!")}</h2>
            <p className="result-feedback-story">{attempt.passageTitle || attempt.moduleTitle}{resultNumber !== undefined && <> — {t("Result")} {resultNumber}</>}</p>
            {numberError && <p role="status">{t("Unable to load the result number.")} <button type="button" onClick={() => setNumberRevision(value => value + 1)}>{t("Retry")}</button></p>}
            <p className="result-feedback-message">{t("You finished your reading activity! Explore your results below to see how you did.")}</p>
          </header>

          {attempt.readAloudOnly === true && <p className="result-feedback-message result-feedback-status" role="status">{attempt.readAloudCompleted
            ? t("Read-aloud activity completed. Your oral-reading result has been saved.")
            : t("Your oral-reading result has been saved. Reopen the activity from your Learning Room to finish updating its status.")}</p>}

          <nav className="result-panel-cards" aria-label={t("Reading result sections")}>
            <button type="button" className="result-panel-card result-panel-card--feedback" aria-haspopup="dialog" onClick={() => openPanel("feedback")}>
              <MessageCircle size={28} aria-hidden="true" />
              <span className="result-panel-card-title">{feedbackTitle}</span>
              <span className="result-panel-card-text">{feedbackCardText}</span>
              {filipino
                ? cardMetric(differenceCount, t("Places to check"), noSpeech)
                : cardMetric(practiceTotal, t("Practice tips"), englishCardStatus)}
            </button>
            <button type="button" className="result-panel-card result-panel-card--accuracy" aria-haspopup="dialog" onClick={() => openPanel("accuracy")}>
              <Gauge size={28} aria-hidden="true" />
              <span className="result-panel-card-title">{accuracyTitle}</span>
              <span className="result-panel-card-text">{accuracyCardText}</span>
              {filipino
                ? cardMetric(`${accuracy}%`, t("Reading accuracy"))
                : cardMetric(pronunciationScore !== null ? `${pronunciationScore}/100` : null, t("Pronunciation score"),
                  englishCardStatus ?? t("Score not measured."))}
            </button>
            <button type="button" className="result-panel-card result-panel-card--words" aria-haspopup="dialog" onClick={() => openPanel("words")}>
              <ListChecks size={28} aria-hidden="true" />
              <span className="result-panel-card-title">{wordsTitle}</span>
              <span className="result-panel-card-text">{wordsCardText}</span>
              {filipino
                ? cardMetric(differenceCount, t("Words to review"), noSpeech)
                : cardMetric(practiceTotal, t("Words to practice"), englishCardStatus)}
            </button>
            <button type="button" className="result-panel-card result-panel-card--transcript" aria-haspopup="dialog" onClick={() => openPanel("transcript")}>
              <Headphones size={28} aria-hidden="true" />
              <span className="result-panel-card-title">{t("Read-Aloud Transcript")}</span>
              <span className="result-panel-card-text">{t("Compare the story with what we heard.")}</span>
              {cardMetric(transcribedWords, t("Words transcribed"))}
            </button>
            <button type="button" className="result-panel-card result-panel-card--result" aria-haspopup="dialog" onClick={() => openPanel("result")}>
              <Star size={28} aria-hidden="true" />
              <span className="result-panel-card-title">{t("Oral Reading Result")}</span>
              <span className="result-panel-card-text">{t("See your reading accuracy, reading speed, and words matched.")}</span>
              {cardMetric(`${accuracy}%`, t("Reading accuracy"))}
            </button>
          </nav>

          {/* F2: a short overall message and the recording, with no scores or word list. Filipino builds it from the saved attempt. */}
          <M5Modal
            id="m5-panel-feedback"
            title={feedbackTitle}
            closeLabel={t("Close")}
            open={panel === "feedback"}
            onClose={closePanel}
          >
            {language === "en" ? (
              <PronunciationFeedbackPanel check={pronunciation} autoStart={panel === "feedback"} />
            ) : (
              <FilipinoReadingFeedback attempt={attempt} />
            )}
            {feedbackOpened && <RecordingPlayback key={attempt.id} attemptId={attempt.id} language={language} />}
          </M5Modal>

          {/* F3. English: Clear Words and Smooth Reading from the saved check, never Reading Accuracy. Filipino: the saved F6 Reading Accuracy, never a pronunciation score. */}
          <M5Modal
            id="m5-panel-accuracy"
            title={accuracyTitle}
            closeLabel={t("Close")}
            open={panel === "accuracy"}
            onClose={closePanel}
          >
            {language === "en" ? (
              <PronunciationAccuracyPanel check={pronunciation} story={pronunciationStory} />
            ) : (
              <FilipinoReadingAccuracyPanel attempt={attempt} />
            )}
          </M5Modal>

          {/* F4. English: only words the saved pronunciation check flagged. Filipino: every saved difference, never called a mispronunciation. */}
          <M5Modal
            id="m5-panel-words"
            title={wordsTitle}
            closeLabel={t("Close")}
            open={panel === "words"}
            onClose={closePanel}
          >
            {language === "en" ? (
              <>
                <PronunciationWordsPanel check={pronunciation} story={pronunciationStory} />
                {/* The full saved recording, to compare with the American English examples. */}
                {wordsOpened && flaggedWords > 0 && <RecordingPlayback key={`words-${attempt.id}`} attemptId={attempt.id} language={language} />}
              </>
            ) : (
              <>
                <FilipinoWordReviewPanel attempt={attempt} />
                {/* The learner's own recording, as in F2 and in English F4: the same component and access. */}
                {wordsOpened && reviewedWords > 0 && <RecordingPlayback key={`words-${attempt.id}`} attemptId={attempt.id} language={language} />}
              </>
            )}
          </M5Modal>

          {/* F5 View Read-Aloud Transcript: the story and what we heard. Differences are not called pronunciation errors. */}
          <M5Modal
            id="m5-panel-transcript"
            title={t("Read-Aloud Transcript")}
            closeLabel={t("Close")}
            open={panel === "transcript"}
            onClose={closePanel}
          >
            {attempt.passageSnapshot?.trim() && (
              <section className="result-feedback-card" aria-labelledby="passage-title">
                <h3 id="passage-title"><BookOpen size={22} aria-hidden="true" />{t("The Story")}</h3>
                {markedStory ? (
                  <div className="result-feedback-transcript result-story-text">
                    {markedStory.map((paragraph, index) => (
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

            <section className="result-feedback-card result-feedback-card--cream" aria-labelledby="transcript-title">
              <h3 id="transcript-title">
                <Headphones size={22} aria-hidden="true" />{t("What We Heard")}</h3>
              {heard.reliable && anyDifferent && (
                <p className="result-info-box">{t("Tap an orange word to compare it with the story.")}</p>
              )}
              {attempt.transcript?.trim() ? (
                <p className="result-feedback-transcript">
                  {heard.pieces.map((piece, index) => !piece.differs
                    ? piece.text
                    : heard.reliable
                      ? (
                        <button
                          key={index}
                          type="button"
                          className="result-feedback-different result-heard-word"
                          aria-pressed={selectedWord === index}
                          aria-controls="heard-word-explanation"
                          onClick={() => setSelectedWord(selectedWord === index ? undefined : index)}
                        >
                          {piece.text}<span className="result-visually-hidden">{t(" (different from the story)")}</span>
                        </button>
                      )
                      : <mark key={index} className="result-feedback-different">{piece.text}<span className="result-visually-hidden">{t(" (different from the story)")}</span></mark>)}
                </p>
              ) : (
                <p className="result-feedback-note">{t("No transcript was saved for this reading.")}</p>
              )}
              {heard.reliable && anyDifferent && (
                <p id="heard-word-explanation" className="result-heard-explanation" role="status" aria-live="polite">
                  {selectedPiece?.differs
                    ? selectedPiece.expected?.length
                      ? t("The story says: “{word}”.", { word: selectedPiece.expected.join(" ") })
                      : t("This word is not in the story.")
                    : null}
                </p>
              )}
              {anyDifferent && (
                <p className="result-legend">
                  <span className="result-legend-swatch result-legend-swatch--different" aria-hidden="true" />
                  {t("Orange words are different from the story.")}
                </p>
              )}
              <p className="result-feedback-note">{t("Sometimes the computer can make mistakes when listening.")}</p>
            </section>
          </M5Modal>

          {/* F6 View Oral Reading Result: transcript-based reading accuracy, words matched and reading speed. */}
          <M5Modal
            id="m5-panel-result"
            title={t("Oral Reading Result")}
            closeLabel={t("Close")}
            open={panel === "result"}
            onClose={closePanel}
          >
            <section className="result-feedback-card result-feedback-score" aria-labelledby="accuracy-title">
              <h3 id="accuracy-title">{t("Reading Accuracy")}</h3>
              <p className="result-feedback-note">{t("How closely the words we heard matched the story.")}</p>
              <p className="result-feedback-score-value">{accuracy}%</p>
              <progress
                className="result-feedback-progress"
                value={accuracy}
                max={100}
                aria-labelledby="accuracy-title"
              >
                {accuracy}%
              </progress>
              <p className="result-feedback-message">{t(readingAccuracyMessage(accuracy, everyWordMatched))}</p>
            </section>

            <section className="result-feedback-card" aria-labelledby="oral-result-title">
              <h3 id="oral-result-title">{t("Your Reading Result")}</h3>
              <dl className="result-feedback-summary result-feedback-summary--two">
                <div>
                  <dt>{t("Words Matched")}</dt>
                  <dd className="result-feedback-summary-value">{t("{matched} of {total}", { matched: correctWordCount, total: attempt.expectedWordCount })}</dd>
                  <dd>{t("Story words that matched the words we heard.")}</dd>
                </div>
                <div>
                  <dt>{t("Reading Speed")}</dt>
                  <dd className="result-feedback-summary-value">{t("{wpm} words per minute", { wpm: Math.round(attempt.readingSpeedWpm) })}</dd>
                  <dd>{t("How many words we heard in each minute of your recording.")}</dd>
                </div>
              </dl>
              {!everyWordMatched && <p className="result-feedback-note">{t("Open Read-Aloud Transcript to see which words were different.")}</p>}
              <p className="result-feedback-note">{everyWordMatched
                ? t("Sometimes the computer can make mistakes when listening.")
                : t("Sometimes the computer can make mistakes when listening, especially with names. If it heard a word wrongly, your real result may be a little higher.")}</p>
            </section>
          </M5Modal>

          {studentPersonalPractice && (
            <p className="result-feedback-note result-feedback-status" role="note">
              {t("Personal practice: this reading and its comprehension are saved to your history. They are not part of any classroom.")}
            </p>
          )}
          {comprehensionUnavailable && (
            <p className="result-feedback-note result-feedback-status" role="note">
              {t("Comprehension questions are not available for this story yet. Your reading result is saved.")}
            </p>
          )}
          <div className="result-feedback-actions">
            {comprehensionTarget && (!linked ? (
              <span className="result-feedback-button result-feedback-button--primary" role="status" aria-disabled="true">
                {t("Checking your questions…")}
              </span>
            ) : completedComprehension ? (
              // A completed activity opens its saved result; nothing is started again.
              <Link
                className="result-feedback-button result-feedback-button--primary"
                to={comprehensionResultTarget(role, completedComprehension.id)}
                state={activityState}
              >{t("View Comprehension Result")}</Link>
            ) : (
              // No activity yet: the introduction and its Start Comprehension. One in progress: that same saved
              // assessment directly (the route the introduction's Continue Comprehension opens).
              <Link
                className="result-feedback-button result-feedback-button--primary"
                to={unfinishedComprehension ? comprehensionActivityTarget(role, unfinishedComprehension.id) : comprehensionTarget}
                state={activityState}
              >{t("Continue to Questions")}</Link>
            ))}
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
