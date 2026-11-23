import { useId } from "react";
import "./M3Dialog.css";
import {
  QUESTION_COUNT_INSTRUCTION,
  QUESTION_COUNT_MAX,
  QUESTION_COUNT_MIN,
  QUESTION_COUNT_STEP,
  checkQuestionCount,
} from "../utils/questionCount";

/**
 * Shared numeric question-count control (every role, every generation control). The author types the total; the
 * category breakdown is shown before generating, and an invalid value explains itself instead of being adjusted.
 * The parent sends a request only when `checkQuestionCount(value).ok`.
 */
export default function QuestionCountInput({ value, onChange, max = QUESTION_COUNT_MAX, disabled = false, label = "Number of questions" }: {
  value: string;
  onChange: (value: string) => void;
  max?: number;
  disabled?: boolean;
  label?: string;
}) {
  const id = useId();
  const check = checkQuestionCount(value, max);
  return (
    <div className="m3-question-count">
      <p className="m3-question-count__instruction" id={`${id}-help`}>{QUESTION_COUNT_INSTRUCTION}</p>
      <label className="m3-question-count__field" htmlFor={`${id}-input`}>
        <span>{label}</span>
        <input
          id={`${id}-input`}
          type="number"
          inputMode="numeric"
          min={QUESTION_COUNT_MIN}
          max={max}
          step={QUESTION_COUNT_STEP}
          value={value}
          disabled={disabled}
          aria-invalid={!check.ok}
          aria-describedby={`${id}-help ${id}-result`}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
      <p id={`${id}-result`} className={check.ok ? "m3-question-count__breakdown" : "m3-question-count__error"}
        role={check.ok ? undefined : "alert"} aria-live="polite">
        {check.ok
          ? <>
              <span className="m3-question-count__chip">{check.breakdown.literal} Literal</span>
              <span className="m3-question-count__chip">{check.breakdown.inferential} Inferential</span>
              <span className="m3-question-count__chip">{check.breakdown.critical} Critical</span>
            </>
          : check.error}
      </p>
    </div>
  );
}
