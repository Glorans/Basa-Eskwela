import type { LegacyRoomSubjectOptions, ReadingLanguage } from "../services/classroomService";

const NAMES: Record<ReadingLanguage, string> = { en: "English", fil: "Filipino" };

// Shown only for an older room without a saved subject, and only when the database supports
// converting it. The language picker in the assignment forms stays until a subject is saved.
// No hooks: the page owns the selection (tests render this inside the page).
export default function LegacyRoomSubjectPanel({ options, selected, saving, error, onSelect, onSave }: {
  options: LegacyRoomSubjectOptions;
  selected: ReadingLanguage | "";
  saving: boolean;
  error: string;
  onSelect: (subject: ReadingLanguage | "") => void;
  onSave: (subject: ReadingLanguage) => void;
}) {
  if (options.subject) return null;
  // A single allowed subject is preselected; the Teacher still has to press Save and confirm.
  const choice = selected || (options.choices.length === 1 ? options.choices[0] : "");

  const mixed = options.contentLanguages.includes("en") && options.contentLanguages.includes("fil");
  return (
    <section aria-labelledby="legacySubjectHeading" className="mb-6 rounded-2xl bg-white/80 p-5 text-[#173f3b]">
      <h2 id="legacySubjectHeading" className="text-lg font-black">Classroom Subject</h2>
      {options.canSet ? (
        <>
          <p className="mt-1 text-sm">
            This older learning room has no saved subject. Saving one makes both assignment forms show only that
            language, like new rooms. Existing assignments and learner results stay as they are. The subject cannot be
            changed later.
          </p>
          {options.choices.length === 1 && options.contentLanguages.length > 0 && (
            <p className="mt-1 text-sm">Everything assigned here so far is in {NAMES[options.choices[0]]}, so only {NAMES[options.choices[0]]} can be saved.</p>
          )}
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="text-sm font-bold">
              Subject
              <select
                className="ml-2 rounded-xl bg-white px-3 py-2 text-sm"
                value={choice}
                disabled={saving}
                id="legacyRoomSubject"
                onChange={(event) => onSelect(event.target.value as ReadingLanguage | "")}
              >
                {options.choices.length > 1 && <option value="">Select a subject</option>}
                {options.choices.map((subject) => <option key={subject} value={subject}>{NAMES[subject]}</option>)}
              </select>
            </label>
            <button
              type="button"
              className="rounded-xl bg-[#173f3b] px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
              disabled={!choice || saving}
              aria-busy={saving}
              onClick={() => choice && onSave(choice)}
            >
              {saving ? "Saving..." : "Save Classroom Subject"}
            </button>
          </div>
        </>
      ) : (
        <p className="mt-1 text-sm">
          {mixed
            ? "This older learning room has both English and Filipino readings, so a single subject cannot be saved. Keep choosing the language when you assign readings."
            : "This older learning room's subject cannot be saved automatically. Keep choosing the language when you assign readings."}
        </p>
      )}
      {error && <p role="alert" className="mt-2 text-sm font-bold text-[#b42318]">{error}</p>}
    </section>
  );
}
