import { useState, type ReactNode } from "react";
import { Eye, Pencil } from "lucide-react";
import type { AdminPassage, BankQuestion } from "../services/adminCollectionService";
import QuestionBankEditorModal, { type EditableQuestion } from "./QuestionBankEditorModal";
import ComprehensionStudentPreview from "./ComprehensionStudentPreview";
import { countByCategory } from "../utils/questionCount";

export function toEditableQuestions(questions: readonly BankQuestion[]): EditableQuestion[] {
  return questions.map((question) => {
    const options = [0, 1, 2, 3].map((index) => question.options[index] ?? "") as EditableQuestion["options"];
    return {
      id: question.id, type: question.type, questionText: question.questionText, options,
      correctIndex: Math.max(0, options.indexOf(question.correctAnswer)),
      scaffoldingHint: question.scaffoldingHint ?? "", answerExplanation: question.answerExplanation ?? "",
      supportingEvidence: question.supportingEvidence ?? "",
    };
  });
}

export function fromEditableQuestions(questions: readonly EditableQuestion[], original: readonly BankQuestion[]): BankQuestion[] {
  return questions.map((question) => ({
    ...(original.find((item) => item.id === question.id) ?? { reviewStatus: "generated" }),
    id: question.id, type: question.type, questionText: question.questionText, options: [...question.options],
    correctAnswer: question.options[question.correctIndex], scaffoldingHint: question.scaffoldingHint,
    answerExplanation: question.answerExplanation, supportingEvidence: question.supportingEvidence,
  }));
}

/**
 * Compact passage question-bank summary for the module editor (Teacher, School Admin, System Admin): saved or not,
 * the total and each category, the review state, and View/Edit Questions (the shared centered editor) and Preview as
 * Student. Replaces the long inline question forms. Editing never regenerates; Save calls the existing reviewed-bank
 * save. Read-only in the detail view and for published modules.
 */
export default function PassageBankSummary({ moduleTitle, passage, readOnly, disabled, editLink, onOpenChange, onSave }: {
  moduleTitle: string;
  passage: AdminPassage;
  readOnly: boolean;
  disabled: boolean;
  /** Read-only view of a draft: where to edit it. */
  editLink?: ReactNode;
  onOpenChange: (open: boolean) => void;
  onSave: (questions: BankQuestion[]) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<EditableQuestion[] | null>(null);
  const questions = passage.questions;
  const counts = countByCategory(questions);
  const reviewed = questions.length > 0 && questions.every((question) => question.reviewStatus === "reviewed");
  const title = passage.title || "Untitled passage";
  function setDialog(value: boolean) { setOpen(value); onOpenChange(value); }

  return (
    <div className="m3-bank-summary" aria-label={`Question bank for ${title}`}>
      <div className="m3-bank-summary__facts">
        <strong>{questions.length ? (reviewed ? "Question bank saved and reviewed" : "Question bank saved · needs review") : "No question bank yet"}</strong>
        {questions.length > 0 && <ul className="m3-qb-summary" aria-label="Question counts">
          <li>{questions.length} questions</li>
          <li>{counts.literal} Literal</li>
          <li>{counts.inferential} Inferential</li>
          <li>{counts.critical} Critical</li>
        </ul>}
        {readOnly && editLink}
      </div>
      {questions.length > 0 && <div className="m3-bank-summary__actions">
        <button type="button" className="m3-button m3-button--secondary" disabled={disabled && !readOnly} onClick={() => setDialog(true)}>
          {readOnly ? <Eye size={17} aria-hidden="true" /> : <Pencil size={17} aria-hidden="true" />}
          {readOnly ? "View Questions" : "View/Edit Questions"}
        </button>
        <button type="button" className="m3-button m3-button--secondary" onClick={() => setPreview(toEditableQuestions(questions))}>
          <Eye size={17} aria-hidden="true" /> Preview as Student
        </button>
      </div>}
      {open && (
        <QuestionBankEditorModal
          title={`${readOnly ? "Questions" : "Edit Questions"} · ${title}`}
          subtitle={moduleTitle}
          questions={toEditableQuestions(questions)}
          rules={{ requireExplanation: true, requireEvidence: true, evidenceSource: passage.passageText }}
          readOnly={readOnly}
          saveLabel="Save Reviewed Questions"
          notice={readOnly ? undefined : "Review every answer, explanation and evidence. Saving marks this bank as reviewed; nothing is regenerated."}
          onPreview={(edited) => setPreview(edited)}
          onClose={() => setDialog(false)}
          onSave={readOnly ? undefined : async (edited) => {
            await onSave(fromEditableQuestions(edited, questions));
            setDialog(false);
          }}
        />
      )}
      {preview && <ComprehensionStudentPreview title={moduleTitle} passageTitle={title} questions={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}
