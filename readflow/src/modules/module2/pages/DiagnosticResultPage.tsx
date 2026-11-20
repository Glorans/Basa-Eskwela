import { diagnosticCopy } from "../utils/diagnosticCopy";
import "../components/DiagnosticProgress.css";
import { diagnosticAssessmentRegistry, diagnosticLanguageLabels, getNextDiagnosticLanguage } from "../data/diagnosticData";
import {
  BookOpen,
  CheckCircle2,
  Gauge,
  Heart,
  Mic,
  Timer,
  Users,
  Volume2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import mascot from "../../../assets/mascot.png";
import useAuthenticatedProfile from "../../../hooks/useAuthenticatedProfile";
import { getRoleHomePath, isAppRole } from "../../module1/utils/authOnboarding";
import DiagnosticLayout from "../components/DiagnosticLayout";
import { getCompletedDiagnosticLanguages, getInitialDiagnosticResult } from "../services/diagnosticDatabase";
import { classifyDiagnosticPlacement, hasValidDiagnosticPlacement } from "../services/diagnosticScoring";
import { synthesizeDiagnosticSpeech } from "../services/diagnosticTts";
import { getDiagnosticPracticeWords } from "../utils/diagnosticDisplay";
import type {
  DiagnosticResult,
  DiagnosticLanguage,
} from "../types/diagnostic";
import "./DiagnosticResultPage.css";

type ResultLoadStatus = "loading" | "ready" | "empty" | "error";

// Presentation copy only: placement continues to come from the saved result.
const READING_LEVEL_DETAILS = {
  Independent: {
    title: "Independent Reader",
    description:
      "You can read and understand this kind of story mostly on your own. Great work! You are ready to keep practicing with stories at this level and gradually try something more challenging.",
    summary: "You can read and understand the story mostly by yourself.",
    tone: "green",
    icon: BookOpen,
  },
  Instructional: {
    title: "Instructional Reader",
    description:
      "You can understand this kind of story with a little guidance and practice. Reading with a teacher, parent, or reading buddy can help you become even more confident.",
    summary: "You can read the story with a little help and practice.",
    tone: "yellow",
    icon: Users,
  },
  Frustration: {
    title: "Let's Practice Together",
    description:
      "This story was challenging for you today. You may do better with an easier story first and some extra reading practice. With support and practice, you can work your way up.",
    summary:
      "The story is difficult right now, so an easier story and extra support may help.",
    tone: "coral",
    icon: Heart,
  },
} satisfies Record<
  NonNullable<DiagnosticResult["readingLevel"]>,
  {
    title: string;
    description: string;
    summary: string;
    tone: string;
    icon: typeof BookOpen;
  }
>;

function displayNumber(value: number | undefined, suffix = "") {
  return typeof value === "number" && Number.isFinite(value)
    ? `${Math.round(value)}${suffix}`
    : "—";
}

/** Keeps decimals so 96.67% is never shown as a misleading 97%. */
function displayPercent(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? `${Number(value.toFixed(2))}%`
    : "—";
}

export default function DiagnosticResultPage({ language = "en" }: { language?: DiagnosticLanguage }) {
  const navigate = useNavigate();
  const { profile } = useAuthenticatedProfile();
  const [result, setResult] = useState<DiagnosticResult>();
  const t = (text: string) => diagnosticCopy(result?.language ?? language, text);
  const [resultLoadStatus, setResultLoadStatus] = useState<ResultLoadStatus>("loading");
  const [nextLanguage, setNextLanguage] = useState<DiagnosticLanguage>();
  const [reloadRequest, setReloadRequest] = useState(0);
  const placementIsValid = hasValidDiagnosticPlacement(result);
  const homePath = profile && isAppRole(profile.role)
    ? getRoleHomePath(profile.role)
    : "/dashboard";
  const practiceWords = useMemo(
    () => getDiagnosticPracticeWords(result?.oralReadingMetrics),
    [result?.oralReadingMetrics],
  );
  const audioUrlCacheRef = useRef(new Map<string, string>());
  const pendingWordsRef = useRef(new Set<string>());
  const activeAudioRef = useRef<HTMLAudioElement | null>(null);
  const mountedRef = useRef(false);
  const [loadingWord, setLoadingWord] = useState<string | null>(null);
  const [ttsError, setTtsError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setResultLoadStatus("loading");

    void Promise.all([getInitialDiagnosticResult(language), getCompletedDiagnosticLanguages()])
      .then(([savedResult, completed]) => {
        if (cancelled) return;

        setNextLanguage(getNextDiagnosticLanguage(completed));
        if (savedResult) {
          setResult(savedResult.result);
          setResultLoadStatus("ready");
        } else {
          setResult(undefined);
          setResultLoadStatus("empty");
        }
      })
      .catch(() => {
        if (!cancelled) setResultLoadStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [reloadRequest, language]);

  useEffect(() => {
    mountedRef.current = true;
    const audioUrlCache = audioUrlCacheRef.current;

    return () => {
      mountedRef.current = false;
      activeAudioRef.current?.pause();
      audioUrlCache.forEach((audioUrl) => URL.revokeObjectURL(audioUrl));
      audioUrlCache.clear();
      pendingWordsRef.current.clear();
    };
  }, []);

  async function listenToPracticeWord(word: string) {
    const language = result?.language;

    if (!language) {
      setTtsError(
        t("The diagnostic language is unavailable. Please reload your result."),
      );
      return;
    }

    const cacheKey = `${language}:${word}`;

    if (pendingWordsRef.current.has(cacheKey)) return;

    setTtsError(null);
    let audioUrl = audioUrlCacheRef.current.get(cacheKey);

    if (!audioUrl) {
      pendingWordsRef.current.add(cacheKey);
      setLoadingWord(word);

      try {
        const audioBlob = await synthesizeDiagnosticSpeech(
          word,
          language,
        );

        if (!mountedRef.current) return;

        audioUrl = URL.createObjectURL(audioBlob);
        audioUrlCacheRef.current.set(cacheKey, audioUrl);
      } catch {
        if (mountedRef.current) {
          setTtsError(t("Pronunciation audio is unavailable. Please try again."));
        }
        return;
      } finally {
        pendingWordsRef.current.delete(cacheKey);
        if (mountedRef.current) setLoadingWord(null);
      }
    }

    try {
      activeAudioRef.current?.pause();
      const audio = new Audio(audioUrl);
      activeAudioRef.current = audio;
      await audio.play();
    } catch {
      if (mountedRef.current) {
        setTtsError(t("Your browser could not play the pronunciation audio."));
      }
    }
  }

  if (resultLoadStatus !== "ready" || !result) {
    const isLoading = resultLoadStatus === "loading";
    const isError = resultLoadStatus === "error";
    return (
      <DiagnosticLayout
        className="diagnostic-result-panel"
        labelledBy="diagnostic-result-title"
      >
        <div className="diagnostic-result-message" role={isLoading ? "status" : undefined}>
          <h1 id="diagnostic-result-title">
            {isLoading ? t("Loading Your Reading Result")
              : isError ? t("We Couldn’t Load Your Result") : t("No Saved Result Yet")}
          </h1>
          <p>
            {isLoading ? t("Please wait while we retrieve your saved diagnostic.")
              : isError ? t("Please check your connection and try again.")
                : t("Complete the diagnostic to see your reading placement.")}
          </p>
          {!isLoading && (
            <button
              className="diagnostic-primary-button"
              type="button"
              onClick={() => isError
                ? setReloadRequest((request) => request + 1)
                : navigate("/diagnostic")}
            >
              {isError ? t("Try Again") : t("Return to Diagnostic")}
            </button>
          )}
        </div>
      </DiagnosticLayout>
    );
  }

  const domainLevels = placementIsValid
    ? classifyDiagnosticPlacement(result.orvScore!, result.comprehensionScore!)
    : undefined;
  const miscues = result.oralReadingMetrics?.detectableMiscues;
  // Saved answers belong to the historical attempt, unlike today's registry.
  const savedQuestionCount = Object.keys(result.comprehensionAnswers ?? {}).length;
  const builtIn = diagnosticAssessmentRegistry[result.language];
  const questionCount = savedQuestionCount || (builtIn && result.assessmentId === builtIn.id && result.assessmentVersion === builtIn.version ? builtIn.questions.length : 0);
  const correctAnswers = questionCount > 0 && typeof result.comprehensionScore === "number" && Number.isFinite(result.comprehensionScore)
    ? Math.round((result.comprehensionScore / 100) * questionCount)
    : undefined;
  const cards = [
    {
      label: t("Reading Level"),
      value: result.readingLevel ?? "—",
      detail: undefined,
      icon: BookOpen,
      tone: "green",
    },
    {
      label: t("Difficulty Level"),
      value: t(result.difficultyTier ?? "—"),
      detail: undefined,
      icon: Gauge,
      tone: "yellow",
    },
    {
      label: t("Oral Reading Score"),
      value: displayPercent(result.orvScore),
      detail: [
        typeof miscues === "number" ? `${miscues} ${result.language === "fil" ? "pagkakamali sa pagbasa" : miscues === 1 ? "miscue" : "miscues"}` : undefined,
        domainLevels ? `${result.language === "fil" ? "Pagbasa ng salita" : "Word reading"}: ${domainLevels.wordRecognitionLevel}` : undefined,
      ].filter(Boolean).join(" · ") || undefined,
      icon: Mic,
      tone: "coral",
    },
    {
      label: t("Comprehension Score"),
      value: correctAnswers === undefined ? "—" : `${correctAnswers} ${result.language === "fil" ? "sa" : "of"} ${questionCount}`,
      detail: [
        displayPercent(result.comprehensionScore),
        domainLevels ? `${result.language === "fil" ? "Pag-unawa" : "Comprehension"}: ${domainLevels.comprehensionLevel}` : undefined,
      ].filter(Boolean).join(" · "),
      icon: CheckCircle2,
      tone: "blue",
    },
    {
      label: t("Reading Speed"),
      value: displayNumber(result.readingSpeedWpm, " WPM"),
      detail: undefined,
      icon: Timer,
      tone: "cream",
    },
  ] as const;
  const assignedLevel =
    placementIsValid && result.readingLevel
      ? READING_LEVEL_DETAILS[result.readingLevel]
      : undefined;

  return (
    <DiagnosticLayout
      className="diagnostic-result-panel"
      labelledBy="diagnostic-result-title"
    >
      <div className="diagnostic-result-content">
        <h1 id="diagnostic-result-title">{(result.language ?? language) === "fil" ? "Resulta ng Pagbasa sa Filipino" : `${diagnosticLanguageLabels[language]} Reading Result`}</h1>
        <div className="diagnostic-result-layout">
          <div className="diagnostic-result-mascot-wrap">
            <img src={mascot} alt="" />
          </div>

          <div className="diagnostic-result-grid">
            {cards.map(({ label, value, detail, icon: Icon, tone }) => (
              <article
                className={`diagnostic-result-card diagnostic-result-card--${tone}`}
                key={label}
              >
                <Icon size={28} strokeWidth={2.25} aria-hidden="true" />
                <p>{label}</p>
                <strong>{value}</strong>
                {detail && <small>{detail}</small>}
              </article>
            ))}
          </div>
        </div>

        {!placementIsValid && (
          <p className="diagnostic-result-pending" role="status">{t("This saved result is incomplete, so reading-level placement is unavailable.")}</p>
        )}

        {assignedLevel && (
          <section
            className={`diagnostic-level-explanation diagnostic-level-tone--${assignedLevel.tone}`}
            aria-labelledby="diagnostic-level-explanation-title"
          >
            <h2 id="diagnostic-level-explanation-title">{t("What does my reading level mean?")}</h2>
            <h3>{result.language === "fil" ? result.readingLevel : assignedLevel.title}</h3>
            <p>{t(assignedLevel.description)}</p>
          </section>
        )}

        <section
          className="diagnostic-reading-levels"
          aria-labelledby="diagnostic-reading-levels-title"
        >
          <h2 id="diagnostic-reading-levels-title">{t("Reading Levels")}</h2>
          <div className="diagnostic-reading-levels-grid">
            {Object.entries(READING_LEVEL_DETAILS).map(([level, details]) => {
              const isCurrent =
                Boolean(assignedLevel) && result.readingLevel === level;
              const Icon = details.icon;

              return (
                <article
                  className={`diagnostic-level-card diagnostic-level-tone--${details.tone}${
                    isCurrent ? " diagnostic-level-card--current" : ""
                  }`}
                  key={level}
                >
                  <Icon size={24} aria-hidden="true" />
                  <h3>{level}</h3>
                  <p>{t(details.summary)}</p>
                  {isCurrent && (
                    <span className="diagnostic-level-current-label">
                      <CheckCircle2 size={17} aria-hidden="true" />
                      {t("Your current level")}
                    </span>
                  )}
                </article>
              );
            })}
          </div>
        </section>

        {practiceWords.length > 0 && (
          <section
            className="diagnostic-practice"
            aria-labelledby="diagnostic-practice-title"
          >
            <h2 id="diagnostic-practice-title">{t("Words to Practice")}</h2>
            <p>{t("These words may have been skipped or recognized differently. Select Listen to hear an example pronunciation.")}</p>

            <ul className="diagnostic-practice-list">
              {practiceWords.map((word) => (
                <li key={word}>
                  <span>{word}</span>
                  <button
                    type="button"
                    disabled={loadingWord !== null}
                    aria-label={`${result.language === "fil" ? "Pakinggan ang" : "Listen to"} ${word}`}
                    onClick={() => void listenToPracticeWord(word)}
                  >
                    <Volume2 size={17} aria-hidden="true" />
                    {loadingWord === word ? t("Loading...") : t("Listen")}
                  </button>
                </li>
              ))}
            </ul>

            {ttsError && (
              <p className="diagnostic-practice-error" role="alert">
                {ttsError}
              </p>
            )}
          </section>
        )}

        <div className="diagnostic-actions">
          <button
            className="diagnostic-primary-button"
            type="button"
            onClick={() => navigate(nextLanguage ? `/diagnostic/${nextLanguage}/reading` : homePath)}
          >
            {nextLanguage ? (result.language === "fil" ? `Magpatuloy sa Pagtataya sa ${diagnosticLanguageLabels[nextLanguage]}` : `Continue to ${diagnosticLanguageLabels[nextLanguage]} Assessment`) : t("Go to homepage")}
          </button>
        </div>
      </div>
    </DiagnosticLayout>
  );
}
