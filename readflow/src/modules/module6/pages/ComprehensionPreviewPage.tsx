import { useEffect, useState } from "react";
import { ArrowLeft, LoaderCircle, Mic } from "lucide-react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import M3PageHeader from "../../module3/components/M3PageHeader";
import "../../module3/pages/PersonalQuestionPreviewPage.css";
import { activityLanguageState, getActivityText } from "../../../pages/reading-activity/activityLanguage";
import { PRACTICE_PATHS, isAdminPracticeRole, isPracticeRole, readAloudTarget } from "../../module5/services/oralReadingNavigation";
import type { LearnerM5Role } from "../../module5/types/oralReading";
import { getComprehensionPreview, type ComprehensionPreview } from "../services/comprehensionService";

const TYPE_LABEL = { literal: "Literal", inferential: "Inferential", critical: "Critical" } as const;
const LETTERS = ["A", "B", "C", "D"];

/**
 * Appendix N M6 F5 Preview comprehension assessment, for every role. Read-only: the questions and choices of one
 * published module passage, in the order the assessment presents them, with their category. The server applies the
 * same access rule as starting the assessment (a Student: an assigned or personal-practice module; staff: their
 * school's and platform modules) and never sends the correct answer, explanation, evidence or hint. Previewing
 * creates, resumes and uses nothing; the assessment itself still starts only after the read-aloud, from its result.
 */
export default function ComprehensionPreviewPage({ role }: { role: LearnerM5Role }) {
  const { moduleId = "" } = useParams<{ moduleId: string }>();
  const [search] = useSearchParams();
  const context = {
    passageId: search.get("passageId"),
    roomId: search.get("roomId"),
    assignmentId: search.get("assignmentId"),
  };
  const [preview, setPreview] = useState<ComprehensionPreview | null>(null);
  const [error, setError] = useState("");
  const { passageId, roomId, assignmentId } = context;

  useEffect(() => {
    let active = true;
    setPreview(null); setError("");
    getComprehensionPreview({ moduleId, passageId, roomId, assignmentId })
      .then((loaded) => { if (active) setPreview(loaded); })
      .catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "Unable to load the assessment preview.");
      });
    return () => { active = false; };
  }, [moduleId, passageId, roomId, assignmentId]);

  // Admin workspaces stay in English; learners and Teachers follow the module language, as in the activity screens.
  const { t } = getActivityText(isAdminPracticeRole(role) ? "en" : preview?.language ?? "en");
  const query = new URLSearchParams();
  if (passageId) query.set("passageId", passageId);
  if (roomId) query.set("roomId", roomId);
  if (assignmentId) query.set("assignmentId", assignmentId);
  const backTarget = isPracticeRole(role) ? PRACTICE_PATHS[role].list
    : `${role === "student" ? "/dashboard/materials" : "/m3/general/modules"}/${encodeURIComponent(moduleId)}${query.size ? `?${query}` : ""}`;
  const backLabel = role === "admin" ? t("Back to Oral Reading") : isPracticeRole(role) ? t("Back to Reading Practice") : t("Back to Reading Module");
  const back = <Link className="m3-back-link" to={backTarget}><ArrowLeft size={17} aria-hidden="true" /> {backLabel}</Link>;

  if (error) {
    return <div className="m3-page-stack m3-page-stack--narrow">{back}
      <div className="m3-empty-state" role="alert"><h2>{t("Questions unavailable")}</h2><p>{error}</p>
        <Link className="m3-button m3-button--secondary" to={backTarget}>{backLabel}</Link></div></div>;
  }
  if (!preview) {
    return <div className="m3-page-stack m3-page-stack--narrow">{back}
      <div className="m3-empty-state" role="status"><LoaderCircle className="m3-spinner" size={34} aria-hidden="true" />
        <h2>{t("Loading the questions...")}</h2></div></div>;
  }

  const readAloud = readAloudTarget(role, preview.moduleId, {
    passageId: preview.passageId,
    roomId: roomId ?? undefined,
    assignmentId: assignmentId ?? undefined,
  });
  return (
    <div className="m3-page-stack m3-page-stack--narrow m3-question-preview">
      {back}
      <M3PageHeader
        eyebrow={t("Preview Comprehension Assessment")}
        title={preview.moduleTitle}
        description={`${preview.passageTitle} · ${t("{count} questions", { count: preview.questions.length })}`}
      />
      <p className="m3-question-preview__note">
        {t("This is a preview. The answers are not shown, and previewing does not start or use your comprehension assessment.")}
      </p>
      <div className="m3-question-preview__list" aria-label={t("Preview Questions")}>
        {preview.questions.map((question, index) => (
          <article className="m3-question-preview__item" key={question.id}>
            <div className="m3-question-preview__meta">
              <p className="m3-question-preview__number">{t("Question ")}{index + 1}</p>
              <span className="m3-question-preview__type">{t(TYPE_LABEL[question.type])}</span>
            </div>
            <p className="m3-question-preview__text">{question.questionText}</p>
            <ol className="m3-question-preview__options" aria-label={t("Choices for question {number}", { number: index + 1 })}>
              {question.options.map((option, optionIndex) => (
                <li key={optionIndex}><span aria-hidden="true">{LETTERS[optionIndex]}</span>{option}</li>
              ))}
            </ol>
          </article>
        ))}
      </div>
      <section className="m3-panel m3-question-preview__actions" aria-label={t("Preview Comprehension Assessment")}>
        <p>{t("To answer these questions, read the passage aloud first. Then start comprehension from your reading result.")}</p>
        <Link className="m3-button m3-button--primary" to={readAloud} state={activityLanguageState(preview.language)}>
          <Mic size={16} aria-hidden="true" /> {t("Start Read-Aloud")}
        </Link>
        <Link className="m3-button m3-button--secondary" to={backTarget}>{backLabel}</Link>
      </section>
    </div>
  );
}
