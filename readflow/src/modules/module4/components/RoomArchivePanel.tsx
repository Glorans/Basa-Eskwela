// Archive / Restore for a learning room. Rendered only once rooms.archived_at exists (proposed
// m4_room_archive migration). No hooks: the page owns the state.
export default function RoomArchivePanel({ archived, busy, error, onToggle }: {
  archived: boolean;
  busy: boolean;
  error: string;
  onToggle: () => void;
}) {
  return (
    <section
      aria-labelledby="roomArchiveHeading"
      className={`mb-6 flex flex-col gap-3 rounded-2xl p-5 text-[#173f3b] sm:flex-row sm:items-center sm:justify-between ${
        archived ? "bg-[#5c7471]/15" : "bg-white/60"
      }`}
    >
      <div className="min-w-0">
        <h2 id="roomArchiveHeading" className="text-lg font-black">
          {archived ? "This learning room is archived" : "Archive Learning Room"}
        </h2>
        <p className="mt-1 text-sm">
          {archived
            ? "Students cannot join or start new activities, and nothing new can be assigned. Enrollments, results, analytics and XP are kept. The room code stays reserved."
            : "Archive a room you no longer use. Nothing is deleted, and you can restore it later."}
        </p>
        {error && <p role="alert" className="mt-2 text-sm font-bold text-[#b42318]">{error}</p>}
      </div>
      <button
        type="button"
        disabled={busy}
        aria-busy={busy}
        onClick={onToggle}
        className="shrink-0 rounded-xl bg-[#173f3b] px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
      >
        {busy ? "Saving..." : archived ? "Restore Learning Room" : "Archive Learning Room"}
      </button>
    </section>
  );
}
