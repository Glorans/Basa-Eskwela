import { useMemo, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Eye } from "lucide-react";
import { confirmReadFlow } from "../../../components/ReadFlowDialog";
import M3Dialog from "./M3Dialog";
import { countByCategory } from "../utils/questionCount";
import type { QuestionType } from "../types/content";

/** The one shape every M3 question source is edited in (module passage banks, material sets, private sets). */
export interface EditableQuestion {
  id: string;
  type: QuestionType;
  questionText: string;
  options: [string, string, string, string];
  correctIndex: number;
  scaffoldingHint: string;
  answerExplanation: string;
  supportingEvidence: string;
}

const TYPES: readonly QuestionType[] = ["literal", "inferential", "critical"];
const TYPE_LABEL: Record<QuestionType, string> = { literal: "Literal", inferential: "Inferential", critical: "Critical" };
const LETTERS = ["A", "B", "C", "D"];
const squash = (value: string) => value.replace(/\s+/g, " ").trim();

export interface BankRules {
  /** Explanation must be filled in (module banks and private sets require it; material sets keep it optional). */
  requireExplanation: boolean;
  requireEvidence: boolean;
  /** When given, evidence must be copied from this text (the server checks the same rule). */
  evidenceSource?: string;
}

/** Problems per question (keyed by question index) and for the whole bank. Empty when the bank can be saved. */
export function validateEditableBank(questions: readonly EditableQuestion[], rules: BankRules) {
  const perQuestion = new Map<number, string[]>();
  questions.forEach((question, index) => {
    const messages: string[] = [];
    if (!question.questionText.trim()) messages.push("Write the question.");
    if (question.options.some((option) => !option.trim())) messages.push("Fill in all four answer choices.");
    else if (new Set(question.options.map((option) => option.trim().toLowerCase())).size !== 4) messages.push("The four answer choices must be different.");
    if (!Number.isInteger(question.correctIndex) || question.correctIndex < 0 || question.correctIndex > 3) messages.push("Choose the correct answer.");
    if (!question.scaffoldingHint.trim()) messages.push("Write a hint.");
    if (rules.requireExplanation && !question.answerExplanation.trim()) messages.push("Write the answer explanation.");
    if (rules.requireEvidence && !question.supportingEvidence.trim()) messages.push("Add supporting evidence from the passage.");
    else if (rules.evidenceSource && question.supportingEvidence.trim()
      && !squash(rules.evidenceSource).includes(squash(question.supportingEvidence))) {
      messages.push("The evidence must be copied exactly from the passage (no added quotation marks or ellipses).");
    }
    if (messages.length) perQuestion.set(index, messages);
  });
  const total = questions.length;
  const counts = countByCategory(questions);
  const bank: string[] = [];
  if (total % 3 !== 0 || TYPES.some((type) => counts[type] !== total / 3)) {
    bank.push(`Keep the categories equal: ${total / 3 === Math.floor(total / 3) ? total / 3 : "the same number of"} Literal, Inferential and Critical questions each (now ${counts.literal} / ${counts.inferential} / ${counts.critical}).`);
  }
  return { perQuestion, bank, ok: perQuestion.size === 0 && bank.length === 0 };
}

/**
 * Shared centered Question Bank editor (Teacher, School Admin, System Admin, Independent Learner). One question at a
 * time with a question list for navigation; nothing is saved until Save Changes, and closing with unsaved edits asks
 * first. Editing never regenerates anything. The role's theme comes from the surrounding shell.
 */
export default function QuestionBankEditorModal({ title, subtitle, questions: initial, rules, readOnly = false, notice, saveLabel = "Save Changes", onSave, onClose, onPreview }: {
  title: string;
  subtitle?: ReactNode;
  questions: EditableQuestion[];
  rules: BankRules;
  readOnly?: boolean;
  notice?: ReactNode;
  saveLabel?: string;
  /** Resolves when saved; rejects (Error) with a message to show. */
  onSave?: (questions: EditableQuestion[]) => Promise<void>;
  onClose: () => void;
  onPreview?: (questions: EditableQuestion[]) => void;
}) {
  const [questions, setQuestions] = useState<EditableQuestion[]>(() => initial.map((question) => ({ ...question, options: [...question.options] as EditableQuestion["options"] })));
  const [index, setIndex] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [showProblems, setShowProblems] = useState(false);
  const check = useMemo(() => validateEditableBank(questions, rules), [questions, rules]);
  const counts = countByCategory(questions);
  const question = questions[index];
  const each = questions.length / 3;

  function change(patch: Partial<EditableQuestion>) {
    setQuestions((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)));
    setDirty(true);
    setError("");
  }

  async function requestClose() {
    if (saving) return;
    if (dirty && !readOnly && !(await confirmReadFlow("Discard your unsaved question edits?", { confirm: "Discard Edits", cancel: "Keep Editing" }))) return;
    onClose();
  }

  async function save() {
    if (!onSave || saving) return;
    setShowProblems(true);
    if (!check.ok) {
      const firstBad = [...check.perQuestion.keys()][0];
      if (firstBad !== undefined) setIndex(firstBad);
      setError("Fix the highlighted questions before saving.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onSave(questions.map((item) => ({
        ...item,
        questionText: item.questionText.trim(),
        options: item.options.map((option) => option.trim()) as EditableQuestion["options"],
        scaffoldingHint: item.scaffoldingHint.trim(),
        answerExplanation: item.answerExplanation.trim(),
        supportingEvidence: item.supportingEvidence.trim(),
      })));
      setDirty(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "The questions could not be saved. Your edits are still here; try again.");
    } finally {
      setSaving(false);
    }
  }

  const problems = showProblems ? check.perQuestion.get(index) ?? [] : [];
  return (
    <M3Dialog title={title} subtitle={subtitle} onRequestClose={() => void requestClose()}
      footer={<>
        {onPreview && <button type="button" className="m3-button m3-button--secondary" disabled={saving} onClick={() => onPreview(questions)}>
          <Eye size={17} aria-hidden="true" /> Preview as Student</button>}
        <button type="button" className="m3-button m3-button--secondary" disabled={saving} onClick={() => void requestClose()}>
          {readOnly || !dirty ? "Close" : "Cancel"}</button>
        {!readOnly && onSave && <button type="button" className="m3-button m3-button--primary" disabled={saving || !dirty} aria-busy={saving}
          onClick={() => void save()}>{saving ? "Saving..." : saveLabel}</button>}
      </>}>
      {notice && <div className="m3-qb-notice" role="note">{notice}</div>}
      <ul className="m3-qb-summary" aria-label="Question bank summary">
        <li>{questions.length} questions</li>
        {TYPES.map((type) => <li key={type} data-ok={String(Number.isInteger(each) && counts[type] === each)}>
          {counts[type]} {TYPE_LABEL[type]}</li>)}
      </ul>
      {showProblems && check.bank.length > 0 && <ul className="m3-qb-issues" role="alert">{check.bank.map((item) => <li key={item}>{item}</li>)}</ul>}
      {error && <p className="m3-error-message" role="alert">{error}</p>}
      {question && (
        <div className="m3-qb-layout">
          <nav className="m3-qb-nav" aria-label="Questions">
            {questions.map((item, itemIndex) => (
              <button key={item.id} type="button" aria-current={itemIndex === index ? "true" : undefined}
                data-invalid={String(showProblems && check.perQuestion.has(itemIndex))}
                aria-label={`Question ${itemIndex + 1}, ${TYPE_LABEL[item.type]}${showProblems && check.perQuestion.has(itemIndex) ? ", needs changes" : ""}`}
                onClick={() => setIndex(itemIndex)}>
                <span>Question {itemIndex + 1}</span><small>{TYPE_LABEL[item.type]}</small>
              </button>
            ))}
          </nav>
          <fieldset className="m3-qb-form" disabled={readOnly || saving} aria-label={`Question ${index + 1}`}>
            {problems.length > 0 && <ul className="m3-qb-issues" role="alert">{problems.map((item) => <li key={item}>{item}</li>)}</ul>}
            <label>Category
              <select value={question.type} onChange={(event) => change({ type: event.target.value as QuestionType })}>
                {TYPES.map((type) => <option key={type} value={type}>{TYPE_LABEL[type]}</option>)}
              </select>
            </label>
            <label>Question
              <textarea rows={2} value={question.questionText} onChange={(event) => change({ questionText: event.target.value })} />
            </label>
            <fieldset className="m3-qb-options">
              <legend>Answer choices <span className="m3-qb-help">(select the correct answer)</span></legend>
              {question.options.map((option, optionIndex) => (
                <div className="m3-qb-option" key={optionIndex}>
                  <input type="radio" name={`correct-${question.id}`} checked={question.correctIndex === optionIndex}
                    aria-label={`Choice ${LETTERS[optionIndex]} is the correct answer`} onChange={() => change({ correctIndex: optionIndex })} />
                  <span aria-hidden="true">{LETTERS[optionIndex]}.</span>
                  <input value={option} aria-label={`Choice ${LETTERS[optionIndex]}`}
                    onChange={(event) => change({ options: question.options.map((value, current) => (current === optionIndex ? event.target.value : value)) as EditableQuestion["options"] })} />
                </div>
              ))}
            </fieldset>
            <label>Hint
              <input value={question.scaffoldingHint} onChange={(event) => change({ scaffoldingHint: event.target.value })} />
            </label>
            <label>Answer explanation{!rules.requireExplanation && <span className="m3-qb-help"> (optional)</span>}
              <span className="m3-qb-help">Explain why the correct answer fits the passage, in words a learner understands.</span>
              <textarea rows={3} maxLength={1500} value={question.answerExplanation} onChange={(event) => change({ answerExplanation: event.target.value })} />
            </label>
            <label>Supporting evidence from the passage{!rules.requireEvidence && <span className="m3-qb-help"> (optional)</span>}
              <span className="m3-qb-help">Copy a short, exact excerpt from the passage, without quotation marks or ellipses.</span>
              <textarea rows={3} maxLength={1000} value={question.supportingEvidence} onChange={(event) => change({ supportingEvidence: event.target.value })} />
            </label>
            <div className="m3-qb-pager">
              <button type="button" className="m3-button m3-button--secondary" disabled={index === 0} onClick={() => setIndex(index - 1)}>
                <ChevronLeft size={17} aria-hidden="true" /> Previous</button>
              <button type="button" className="m3-button m3-button--secondary" disabled={index === questions.length - 1} onClick={() => setIndex(index + 1)}>
                Next <ChevronRight size={17} aria-hidden="true" /></button>
            </div>
          </fieldset>
        </div>
      )}
    </M3Dialog>
  );
}
