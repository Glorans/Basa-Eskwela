import { useState } from "react";
import M3Dialog from "./M3Dialog";
import type { EditableQuestion } from "./QuestionBankEditorModal";
import "../../module6/pages/ComprehensionPage.css";

const TYPE_LABEL = { literal: "Literal", inferential: "Inferential", critical: "Critical" } as const;

/**
 * "Preview as Student": the Student comprehension screen (M6 ComprehensionPage layout and styles: one question at a
 * time, choose an answer, Submit answer, the Correct / Incorrect feedback with the explanation and evidence, Next
 * Question, then a summary). Everything happens in this browser tab: nothing is sent to the server, no attempt,
 * result, grade, diagnostic record, progress or XP is created, and no speech service is used.
 */
export default function ComprehensionStudentPreview({ title, passageTitle, questions, onClose }: {
  title: string;
  passageTitle?: string;
  questions: EditableQuestion[];
  onClose: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [answers, setAnswers] = useState<(number | null)[]>(() => questions.map(() => null));
  const [finished, setFinished] = useState(false);
  const question = questions[index];
  const answered = answers[index];
  const correctCount = answers.filter((answer, answerIndex) => answer !== null && answer === questions[answerIndex].correctIndex).length;

  function restart() { setIndex(0); setSelected(null); setAnswers(questions.map(() => null)); setFinished(false); }

  return (
    <M3Dialog title="Preview as Student" onRequestClose={onClose}
      subtitle={<>{title}{passageTitle ? ` · ${passageTitle}` : ""} · {questions.length} questions. Preview only: nothing is saved.</>}
      footer={<><button type="button" className="m3-button m3-button--secondary" onClick={restart}>Start Over</button>
        <button type="button" className="m3-button m3-button--primary" onClick={onClose}>Close Preview</button></>}>
      <div className="m6-page m6-page--questions m3-student-preview">
        {!question ? <p>No questions to preview yet.</p> : finished ? (
          <section className="m6-card" aria-label="Preview summary">
            <h2>Preview finished</h2>
            <div className="m6-score"><strong>{correctCount} / {questions.length}</strong> <span>correct in this preview</span></div>
            <p className="m6-final-note">This was a preview. No result, grade or progress was saved, and no Student sees these answers.</p>
          </section>
        ) : (
          <section className="m6-card m6-question-card" aria-label="Current question">
            <p className="m6-question-progress">Question {index + 1} of {questions.length} · {TYPE_LABEL[question.type]}</p>
            <h2>{question.questionText}</h2>
            <fieldset disabled={answered !== null}>
              <legend>Choose one answer</legend>
              {question.options.map((option, optionIndex) => (
                <label className="m6-option" key={optionIndex}>
                  <input type="radio" name={`preview-${question.id}`} value={optionIndex}
                    checked={(answered ?? selected) === optionIndex} onChange={() => setSelected(optionIndex)} />
                  <span><strong>{String.fromCharCode(65 + optionIndex)}.</strong> {option}</span>
                </label>
              ))}
            </fieldset>
            {question.scaffoldingHint && answered === null && <aside><strong>Hint: </strong>{question.scaffoldingHint}</aside>}
            {answered === null && <p className="m6-final-note">You can answer each question once. Your submitted answer is final.</p>}
            {answered !== null && (
              <section className={`m6-submitted-feedback m6-submitted-feedback--${answered === question.correctIndex ? "correct" : "incorrect"}`} role="status">
                <h3>{answered === question.correctIndex ? "Correct!" : "Incorrect"}</h3>
                <p>Your answer: <strong>{question.options[answered]}</strong></p>
                <aside className="m6-answer-feedback">
                  <p><strong>Correct answer: </strong>{question.options[question.correctIndex]}</p>
                  {question.answerExplanation && <p><strong>Why this answer fits: </strong>{question.answerExplanation}</p>}
                  {question.supportingEvidence && <p><strong>Evidence from the passage: </strong><q>{question.supportingEvidence}</q></p>}
                </aside>
              </section>
            )}
            <div className="m6-actions">
              {answered === null && <button className="m6-button" type="button" disabled={selected === null}
                onClick={() => setAnswers((current) => current.map((value, valueIndex) => (valueIndex === index ? selected : value)))}>Submit answer</button>}
              {answered !== null && index < questions.length - 1 && <button className="m6-button" type="button"
                onClick={() => { setIndex(index + 1); setSelected(null); }}>Next Question</button>}
              {answered !== null && index === questions.length - 1 && <button className="m6-button" type="button"
                onClick={() => setFinished(true)}>Finish Assessment</button>}
            </div>
          </section>
        )}
      </div>
    </M3Dialog>
  );
}
