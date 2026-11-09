import type { ReactNode } from "react";
import type { ReadingLanguage } from "../services/classroomService";

// The learning-room creation form shared by the Teacher and Admin Learning Rooms pages.
// It only renders props; validation, state and saving stay in the page that uses it.
type LearningRoomFormProps = {
  roomName: string;
  section: string;
  description: string;
  subject: ReadingLanguage | "";
  creating: boolean;
  onRoomNameChange: (value: string) => void;
  onSectionChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onSubjectChange: (value: ReadingLanguage | "") => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  /** Extra required field shown before the room details (the Admin's Teacher picker). */
  ownerField?: ReactNode;
  /** Submit button text; the Teacher page keeps "Create Room". */
  submitLabel?: string;
};

export default function LearningRoomForm({
  roomName, section, description, subject, creating,
  onRoomNameChange, onSectionChange, onDescriptionChange, onSubjectChange, onSubmit, ownerField, submitLabel = "Create Room",
}: LearningRoomFormProps) {
  return (
    <form
      onSubmit={onSubmit}
      className="mb-7 rounded-3xl bg-[#dce8e7] p-6 shadow-lg md:p-7"
    >
      <div className="mb-6">
        <h2 className="text-2xl font-extrabold text-[#173f3b]">
          Create Learning Room
        </h2>
        <p className="mt-1 text-sm text-[#5c7471]">
          Enter the classroom information below. A room code will be
          generated automatically.
        </p>
      </div>

      {ownerField}

      <div className="grid gap-5 md:grid-cols-2">
        <div>
          <label
            htmlFor="roomName"
            className="mb-2 block text-sm font-bold text-[#173f3b]"
          >
            Room Name <span className="text-[#e45f55]">*</span>
          </label>

          <input
            id="roomName"
            type="text"
            value={roomName}
            onChange={(event) => onRoomNameChange(event.target.value)}
            placeholder="e.g., Grade 5 Reading Group A"
            required
            className="w-full rounded-xl border-2 border-transparent bg-white px-4 py-3 text-[#173f3b] outline-none transition placeholder:text-gray-400 focus:border-[#f7cf4a]"
          />
        </div>

        <div>
          <label
            htmlFor="section"
            className="mb-2 block text-sm font-bold text-[#173f3b]"
          >
            Section (optional)
          </label>

          <input
            id="section"
            type="text"
            value={section}
            onChange={(event) => onSectionChange(event.target.value)}
            placeholder="e.g., Rizal"
            className="w-full rounded-xl border-2 border-transparent bg-white px-4 py-3 text-[#173f3b] outline-none transition placeholder:text-gray-400 focus:border-[#f7cf4a]"
          />
        </div>
      </div>

      <div className="mt-5">
        <label htmlFor="subject" className="mb-2 block text-sm font-bold text-[#173f3b]">
          Subject <span className="text-[#e45f55]">*</span>
        </label>
        <select id="subject" value={subject} required disabled={creating} aria-describedby="subjectHelp"
          onChange={(event) => onSubjectChange(event.target.value as ReadingLanguage | "")}
          className="w-full rounded-xl border-2 border-transparent bg-white px-4 py-3 text-[#173f3b] outline-none transition focus:border-[#f7cf4a]">
          <option value="">Choose a subject</option>
          <option value="en">English</option>
          <option value="fil">Filipino</option>
        </select>
        <p id="subjectHelp" className="mt-1 text-sm text-[#5c7471]">
          Only reading materials matching this subject can be assigned to the room.
        </p>
      </div>

      <div className="mt-5">
        <label
          htmlFor="description"
          className="mb-2 block text-sm font-bold text-[#173f3b]"
        >
          Description (optional)
        </label>

        <textarea
          id="description"
          value={description}
          onChange={(event) => onDescriptionChange(event.target.value)}
          placeholder="e.g., Reading activities for Grade 5 students"
          rows={4}
          className="w-full resize-none rounded-xl border-2 border-transparent bg-white px-4 py-3 text-[#173f3b] outline-none transition placeholder:text-gray-400 focus:border-[#f7cf4a]"
        />
      </div>

      <div className="mt-6 flex justify-end">
        <button
          type="submit"
          disabled={creating}
          className="rounded-xl bg-[#f7cf4a] px-6 py-3 font-extrabold text-[#173f3b] shadow-sm transition hover:bg-[#f2c83a] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {creating ? "Creating..." : submitLabel}
        </button>
      </div>
    </form>
  );
}
