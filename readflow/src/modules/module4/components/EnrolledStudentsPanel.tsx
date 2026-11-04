import type { EnrolledStudent } from "../services/classroomService";

// Shared by the Teacher and Admin classroom pages. The page owns the open state,
// the data and every action; this file only renders. Remove appears only when the
// page passes onRemoveStudent (the room's Teacher; RLS lets no one else delete).

export function EnrolledStudentsButton({ count, onOpen, className }: {
  count: number;
  onOpen: () => void;
  className: string;
}) {
  return (
    <button
      type="button"
      id="enrolledStudentsButton"
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-controls="enrolledStudentsPanel"
      className={`w-full text-left transition hover:brightness-95 focus-visible:outline focus-visible:outline-4 focus-visible:outline-[#173f3b] ${className}`}
    >
      <span className="block text-sm font-bold opacity-75">Enrolled Students</span>
      <span className="mt-1 block text-3xl font-black">{count}</span>
      <span className="mt-2 inline-block text-sm font-extrabold underline underline-offset-4">
        View students
      </span>
    </button>
  );
}

function joinedDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Join date unavailable"
    : `Joined ${date.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Manila" })}`;
}

export default function EnrolledStudentsPanel({ open, roomName, students, onClose, onRemoveStudent }: {
  open: boolean;
  roomName: string;
  students: EnrolledStudent[];
  onClose: () => void;
  onRemoveStudent?: (enrollmentId: string, studentName: string) => void | Promise<void>;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-[#173f3b]/60 p-0 sm:items-center sm:p-6"
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
      onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}
    >
      <div
        id="enrolledStudentsPanel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="enrolledStudentsTitle"
        aria-describedby="enrolledStudentsDescription"
        className="flex max-h-[90dvh] w-full max-w-2xl flex-col rounded-t-3xl bg-[#dce8e7] shadow-xl sm:rounded-3xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-[#c6d6d3] p-5 sm:p-6">
          <div className="min-w-0">
            <h2 id="enrolledStudentsTitle" className="text-2xl font-extrabold text-[#173f3b]">
              Enrolled Students ({students.length})
            </h2>
            <p id="enrolledStudentsDescription" className="mt-1 break-words text-sm text-[#5c7471]">
              Students currently enrolled in {roomName}.
            </p>
          </div>
          <button
            type="button"
            autoFocus
            onClick={onClose}
            className="shrink-0 rounded-xl bg-white px-4 py-2 text-sm font-extrabold text-[#173f3b] transition hover:bg-[#f4f7f5]"
          >
            Close
          </button>
        </header>

        <div className="overflow-y-auto p-5 sm:p-6">
          {students.length === 0 ? (
            <div className="rounded-2xl bg-white/60 px-5 py-8 text-center">
              <div className="mb-2 text-3xl" aria-hidden="true">👥</div>
              <p className="font-bold text-[#173f3b]">No enrolled students yet</p>
              <p className="mt-1 text-sm text-[#6d8582]">Share the room code with students to let them join.</p>
            </div>
          ) : (
            <ul className="space-y-3">
              {students.map((student) => (
                <li
                  key={student.enrollment_id}
                  className="flex flex-col gap-4 rounded-2xl bg-white/70 p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#f7cf4a] font-black text-[#173f3b]" aria-hidden="true">
                      {student.display_name?.trim().charAt(0).toUpperCase() || "?"}
                    </div>
                    <div className="min-w-0">
                      <p className="break-words font-extrabold text-[#173f3b]">{student.display_name}</p>
                      <p className="text-xs text-[#6d8582]">{joinedDate(student.enrolled_at)}</p>
                    </div>
                  </div>
                  {onRemoveStudent && (
                    <button
                      type="button"
                      onClick={() => onRemoveStudent(student.enrollment_id, student.display_name)}
                      className="self-start rounded-xl bg-[#ef7468] px-4 py-2 text-sm font-bold text-white transition hover:bg-[#df665c] sm:self-auto"
                    >
                      Remove
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
