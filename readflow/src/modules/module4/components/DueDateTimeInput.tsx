import { currentDueDateMinimum } from "../services/classroomService";

interface DueDateTimeInputProps {
  /** Id of the group; the inputs use `${id}Date` and `${id}Time`. */
  id: string;
  labelId: string;
  /** Same format as before: "YYYY-MM-DDTHH:mm", or "" for no deadline. */
  value: string;
  onValueChange: (value: string) => void;
  invalid: boolean;
  describedBy: string;
  disabled?: boolean;
}

/** Splits "YYYY-MM-DDTHH:mm" (or a half-filled "YYYY-MM-DDT" / "THH:mm") into its parts. */
export function splitDueValue(value: string): [string, string] {
  const index = value.indexOf("T");
  return index < 0 ? [value, ""] : [value.slice(0, index), value.slice(index + 1)];
}

/** "" when both parts are empty; otherwise "date T time" (half-filled values fail validation). */
export function joinDueValue(date: string, time: string): string {
  return date || time ? `${date}T${time}` : "";
}

const inputClass =
  "w-full rounded-xl border-2 border-transparent bg-white px-4 py-3 text-sm text-[#173f3b] outline-none transition focus:border-[#f7cf4a] disabled:opacity-60";

/**
 * Separate date and time fields. A single datetime-local field opens a calendar even
 * when only the time needs changing; a time field opens a time picker instead.
 * The value stays a Philippine-time "YYYY-MM-DDTHH:mm" string, validated as before.
 */
export default function DueDateTimeInput({
  id,
  labelId,
  value,
  onValueChange,
  invalid,
  describedBy,
  disabled,
}: DueDateTimeInputProps) {
  const [date, time] = splitDueValue(value);
  const minDate = currentDueDateMinimum().slice(0, 10);

  return (
    <div
      id={id}
      role="group"
      aria-labelledby={labelId}
      aria-describedby={describedBy}
      className="flex flex-wrap items-end gap-3"
    >
      <label htmlFor={`${id}Date`} className="min-w-[10rem] flex-1 text-xs font-bold text-[#36504b] sm:max-w-[12rem]">
        Date
        <input
          id={`${id}Date`}
          type="date"
          value={date}
          min={minDate}
          disabled={disabled}
          aria-invalid={invalid}
          aria-describedby={describedBy}
          onChange={(event) => onValueChange(joinDueValue(event.target.value, time))}
          className={`mt-1 ${inputClass}`}
        />
      </label>
      <label htmlFor={`${id}Time`} className="min-w-[8rem] flex-1 text-xs font-bold text-[#36504b] sm:max-w-[10rem]">
        Time
        <input
          id={`${id}Time`}
          type="time"
          step={60}
          value={time}
          disabled={disabled}
          aria-invalid={invalid}
          aria-describedby={describedBy}
          onChange={(event) => onValueChange(joinDueValue(date, event.target.value))}
          className={`mt-1 ${inputClass}`}
        />
      </label>
      {value && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => onValueChange("")}
          className="rounded-xl bg-[#dce8e7] px-4 py-3 text-sm font-bold text-[#173f3b] disabled:opacity-60"
        >
          Clear deadline
        </button>
      )}
    </div>
  );
}
