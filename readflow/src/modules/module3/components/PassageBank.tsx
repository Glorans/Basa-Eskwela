import { useState } from "react";
import type { AdminPassage } from "../services/adminCollectionService";

export default function PassageBank({
  passage,
  disabled,
  onSave,
  onDirty,
}: {
  passage: AdminPassage;
  disabled: boolean;
  onSave: (questions: AdminPassage["questions"]) => void;
  onDirty: (value: boolean) => void;
}) {
  const [questions, updateQuestions] = useState(passage.questions);

  function setQuestions(value: AdminPassage["questions"]) {
    updateQuestions(value);
    onDirty(true);
  }

  function changeQuestion(
    index: number,
    change: Partial<AdminPassage["questions"][number]>,
  ) {
    setQuestions(
      questions.map((question, questionIndex) =>
        questionIndex === index
          ? { ...question, ...change }
          : question,
      ),
    );
  }

  return (
    <details className="m3-editor-review">
      <summary>
        View/Edit Questions
        <span>Literal &middot; Inferential &middot; Critical</span>
      </summary>

      <fieldset
        disabled={disabled}
        className="m3-collection-fields"
      >
        <p className="m3-editor-help">
          Review the answer, explanation, and evidence for every
          question. Evidence must be copied directly from this
          passage without adding quotation marks or ellipses.
        </p>

        {questions.map((question, index) => (
          <div
            key={question.id}
            className="m3-collection-fields m3-editor-question"
          >
            <header className="m3-editor-question-heading">
              <h4>Question {index + 1}</h4>
              <span className="m3-editor-badge">
                {question.type}
              </span>
            </header>

            <label>
              Category
              <select
                value={question.type}
                onChange={(event) =>
                  changeQuestion(index, {
                    type: event.target.value as typeof question.type,
                  })
                }
              >
                {["literal", "inferential", "critical"].map(
                  (type) => (
                    <option key={type}>{type}</option>
                  ),
                )}
              </select>
            </label>

            <label>
              Question
              <textarea
                rows={2}
                value={question.questionText}
                onChange={(event) =>
                  changeQuestion(index, {
                    questionText: event.target.value,
                  })
                }
              />
            </label>

            {question.options.map((option, optionIndex) => (
              <label key={optionIndex}>
                Option {optionIndex + 1}
                <input
                  value={option}
                  onChange={(event) =>
                    changeQuestion(index, {
                      options: question.options.map(
                        (value, currentIndex) =>
                          currentIndex === optionIndex
                            ? event.target.value
                            : value,
                      ),
                      correctAnswer:
                        question.correctAnswer === option
                          ? event.target.value
                          : question.correctAnswer,
                    })
                  }
                />
              </label>
            ))}

            <label>
              Correct answer
              <select
                value={question.correctAnswer}
                onChange={(event) =>
                  changeQuestion(index, {
                    correctAnswer: event.target.value,
                  })
                }
              >
                {question.options.map((option, optionIndex) => (
                  <option key={optionIndex} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Scaffolding hint
              <input
                value={question.scaffoldingHint}
                onChange={(event) =>
                  changeQuestion(index, {
                    scaffoldingHint: event.target.value,
                  })
                }
              />
            </label>

            <label>
              Answer explanation
              <span className="m3-editor-help">
                Explain why the correct answer fits the passage
                using language a learner can understand.
              </span>
              <textarea
                rows={3}
                maxLength={1500}
                value={question.answerExplanation ?? ""}
                onChange={(event) =>
                  changeQuestion(index, {
                    answerExplanation: event.target.value,
                  })
                }
              />
            </label>

            <label>
              Supporting evidence from the passage
              <span className="m3-editor-help">
                Copy a short, exact excerpt that supports the answer.
              </span>
              <textarea
                rows={3}
                maxLength={1000}
                value={question.supportingEvidence ?? ""}
                onChange={(event) =>
                  changeQuestion(index, {
                    supportingEvidence: event.target.value,
                  })
                }
              />
            </label>
          </div>
        ))}

        <div className="m3-collection-actions">
          <button
            type="button"
            className="m3-button m3-button--primary"
            onClick={() => onSave(questions)}
          >
            Save Reviewed Questions
          </button>

          <button
            type="button"
            className="m3-button m3-button--secondary"
            onClick={() => {
              updateQuestions(passage.questions);
              onDirty(false);
            }}
          >
            Discard Question Edits
          </button>
        </div>
      </fieldset>
    </details>
  );
}
