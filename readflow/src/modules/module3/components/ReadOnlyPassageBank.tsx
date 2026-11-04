import type { AdminPassage } from "../services/adminCollectionService";
import { SIX_ONLY, describeBankRequirement, isBalancedBank, numberWord, targetBankSize } from "../utils/passageBankSize.ts";

const CATEGORIES = ["literal", "inferential", "critical"] as const;
const LABELS = { literal: "Literal", inferential: "Inferential", critical: "Critical" } as const;

// Admin-only preview (data comes from the Admin-only m3_admin_collection RPC).
// Renders text only: no inputs, so nothing here can change the bank.
export default function ReadOnlyPassageBank({ passage, bankSizes = SIX_ONLY }: { passage: AdminPassage; bankSizes?: readonly number[] }) {
  const { questions } = passage;
  const each = targetBankSize(questions.length, bankSizes) / 3;
  const counts = CATEGORIES.map((category) => ({
    category,
    count: questions.filter((question) => question.type === category).length,
  }));

  if (!questions.length) {
    return (
      <p className="m3-editor-notice m3-editor-notice--missing" role="note">
        No question bank yet. Edit the draft to generate and review{" "}
        {bankSizes.length === 1
          ? "six questions (2 literal, 2 inferential and 2 critical)"
          : describeBankRequirement(bankSizes)}{" "}
        for this passage.
      </p>
    );
  }

  const reviewed = questions.every((question) => question.reviewStatus === "reviewed");

  return (
    <section className="m3-editor-review m3-editor-readonly-bank" aria-label={`Saved question bank, ${questions.length} questions`}>
      <header className="m3-editor-readonly-summary">
        <h4>Saved Question Bank (read-only)</h4>
        <p className="m3-editor-help">
          {counts.map(({ category, count }) => `${LABELS[category]} ${count}/${each}`).join(" · ")}
          {" · "}
          {reviewed ? "All questions reviewed" : "Some questions still need review"}
        </p>
        {!isBalancedBank(questions, bankSizes) && (
          <p className="m3-editor-notice m3-editor-notice--missing" role="note">
            This bank does not have exactly {numberWord(each)} questions of each type. Edit the draft to
            regenerate it before publishing.
          </p>
        )}
      </header>

      <ol className="m3-editor-readonly-questions">
        {questions.map((question, index) => (
          <li key={question.id} className="m3-editor-question">
            <header className="m3-editor-question-heading">
              <h5>Question {index + 1}</h5>
              <span className="m3-editor-badge">{question.type}</span>
              <span
                className={`m3-editor-badge ${question.reviewStatus === "reviewed" ? "m3-editor-badge--ready" : "m3-editor-badge--pending"}`}
              >
                {question.reviewStatus === "reviewed" ? "Reviewed" : "Needs review"}
              </span>
            </header>
            <p className="m3-editor-readonly-text">{question.questionText}</p>
            <ul className="m3-editor-readonly-options" aria-label="Answer options">
              {question.options.map((option, optionIndex) => (
                <li key={optionIndex} data-correct={option === question.correctAnswer || undefined}>
                  {option}
                  {option === question.correctAnswer && <strong> (correct answer)</strong>}
                </li>
              ))}
            </ul>
            <dl className="m3-editor-readonly-details">
              <div><dt>Hint</dt><dd>{question.scaffoldingHint}</dd></div>
              <div><dt>Answer explanation</dt><dd>{question.answerExplanation || "Not provided"}</dd></div>
              <div><dt>Supporting evidence</dt><dd>{question.supportingEvidence || "Not provided"}</dd></div>
            </dl>
          </li>
        ))}
      </ol>
    </section>
  );
}
