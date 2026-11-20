import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { PackageContent } from "../services/assessmentPackages";
import type { DiagnosticLanguage } from "../types/diagnostic";
import { diagnosticCopy } from "../utils/diagnosticCopy";
import "@fontsource/fredoka/latin-600.css";
import "@fontsource/nunito/latin-600.css";
import "@fontsource/nunito/latin-700.css";
import "../components/DiagnosticLayout.css";
import "../pages/DiagnosticReadingPage.css";
import "../pages/DiagnosticQuestionsPage.css";
import "./AssessmentPreviewDialog.css";

/**
 * M2 F6 learner preview for staff. Shows the selected version's passage and its questions one at a time, using the
 * learner screens' own styles. Nothing is recorded or sent anywhere: selections live only in this dialog.
 */
export default function AssessmentPreviewDialog({ content, language, start, onClose }: {
  content: PackageContent; language: DiagnosticLanguage; start: "passage" | "questions"; onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const total = content.questions.length;
  // -1 = the story; 0..total-1 = one question each.
  const [step, setStep] = useState(start === "questions" && total > 0 ? 0 : -1);
  const [picked, setPicked] = useState<Record<number, string>>({});
  const t = (text: string) => diagnosticCopy(language, text);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && typeof dialog.showModal === "function" && !dialog.open) dialog.showModal();
  }, []);
  const question = step >= 0 ? content.questions[step] : null;
  const fil = language === "fil";
  return (
    <dialog ref={ref} className="m2-preview-dialog" aria-labelledby="m2-preview-title"
      onCancel={(event) => { event.preventDefault(); onClose(); }}>
      <header className="m2-preview-bar">
        <h2 id="m2-preview-title">Learner Preview{step >= 0 ? ` · Question ${step + 1} of ${total}` : " · Reading Passage"}</h2>
        <button type="button" className="m2-preview-close" onClick={onClose}><X size={18} aria-hidden="true" /> Close</button>
      </header>
      <div className="m2-preview-body">
        {question === null ? (
          <div key="passage" className="m2-preview-slide">
            <h3 className="m2-preview-heading">{t("Read the Story Aloud")}</h3>
            <article className="diagnostic-story-card m2-preview-story" aria-labelledby="m2-preview-story-title" tabIndex={0}>
              <h2 id="m2-preview-story-title">{content.passageTitle || "Untitled passage"}</h2>
              <div className="diagnostic-story-content">
                {content.paragraphs.filter((p) => p.trim()).map((p, i) => <p key={i}>{p}</p>)}
              </div>
            </article>
          </div>
        ) : (
          <div key={`q${step}`} className="m2-preview-slide">
            <h3 className="m2-preview-heading">{t("Answer the Questions")}</h3>
            <section className="diagnostic-question-card" aria-labelledby="m2-preview-prompt">
              <p className="diagnostic-question-counter">{fil ? "Tanong" : "Question"} {step + 1} {fil ? "sa" : "of"} {total}</p>
              <h2 id="m2-preview-prompt">{question.prompt || "No question text yet"}</h2>
              <fieldset className="diagnostic-answer-list">
                <legend className="diagnostic-visually-hidden">Select one answer</legend>
                {question.choices.map((choice) => (
                  <label key={choice.id} className={`diagnostic-answer${picked[step] === choice.id ? " diagnostic-answer--selected" : ""}`}>
                    <input type="radio" name={`m2-preview-${step}`} value={choice.id} checked={picked[step] === choice.id}
                      onChange={() => setPicked({ ...picked, [step]: choice.id })} />
                    <span className="diagnostic-answer-indicator" aria-hidden="true" />
                    <span>{choice.label || "(empty choice)"}</span>
                  </label>
                ))}
              </fieldset>
            </section>
            <p className="m2-preview-note">Preview only. Answers are not saved. Learners see the choices in a shuffled order.</p>
          </div>
        )}
      </div>
      <footer className="m2-preview-actions">
        {step >= 0 && <button type="button" className="diagnostic-recording-secondary-button"
          onClick={() => setStep(step - 1)}>{step === 0 ? "Back to Passage" : "Previous"}</button>}
        {step < total - 1
          ? <button type="button" className="diagnostic-primary-button" onClick={() => setStep(step + 1)}>{step === -1 ? "Preview Questions" : "Next"}</button>
          : <button type="button" className="diagnostic-primary-button" onClick={onClose}>Finish Preview</button>}
      </footer>
    </dialog>
  );
}
