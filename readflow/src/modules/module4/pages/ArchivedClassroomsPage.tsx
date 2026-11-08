// Teacher: Archived Classrooms. Only the Teacher's own rooms (getTeacherClassrooms filters by teacher_id and
// RLS limits it again). Each room opens read-only (members, assignments, results); Restore is the only change.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { confirmReadFlow } from "../../../components/ReadFlowDialog";
import { supabase } from "../../../lib/supabaseClient";
import RoomCard from "../components/RoomCard";
import {
  getTeacherClassrooms,
  isRoomArchived,
  setClassroomArchived,
  type Classroom,
} from "../services/classroomService";

export default function ArchivedClassroomsPage() {
  const [rooms, setRooms] = useState<Classroom[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [restoring, setRestoring] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const { data: { user }, error: userError } = await supabase.auth.getUser();
        if (userError) throw userError;
        if (!user) throw new Error("No authenticated teacher found.");
        const all = await getTeacherClassrooms(user.id);
        if (active) setRooms(all.filter(isRoomArchived));
      } catch (err) {
        console.error("Failed to load archived classrooms:", err);
        if (active) setError("Unable to load archived classrooms.");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, []);

  async function handleRestore(room: Classroom) {
    if (restoring) return;
    if (!(await confirmReadFlow(`Restore "${room.room_name}"? It returns to Learning Rooms, and students can join and start activities again.`))) return;
    setRestoring(room.id);
    setError("");
    setNotice("");
    try {
      await setClassroomArchived(room.id, false);
      setRooms((current) => current.filter((item) => item.id !== room.id));
      setNotice(`"${room.room_name}" was restored and is back in Learning Rooms.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The learning room could not be restored.");
    } finally {
      setRestoring(null);
    }
  }

  return (
    <section className="mx-auto w-full max-w-7xl px-4 py-6 md:px-6 lg:px-8">
      <header className="mb-6">
        <h1 className="text-3xl font-extrabold text-[#173f3b] md:text-4xl">Archived Classrooms</h1>
      </header>

      <div aria-live="polite" role="status">
        {notice && <p className="mb-4 rounded-xl bg-[#e9f7ef] px-4 py-3 text-sm font-bold text-[#15803d]">{notice}</p>}
      </div>
      {error && <p role="alert" className="mb-4 rounded-xl bg-[#fdecea] px-4 py-3 text-sm font-bold text-[#b42318]">{error}</p>}

      {loading ? (
        <p role="status" className="text-[#5c7471]">Loading archived classrooms...</p>
      ) : rooms.length === 0 ? (
        <div className="rounded-3xl bg-white/60 px-6 py-10 text-center">
          <h2 className="text-xl font-extrabold text-[#173f3b]">No archived classrooms</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-[#5c7471]">
            When you archive a learning room, it moves here. Your active rooms are in{" "}
            <Link to="/m3/teacher/learning-rooms" className="font-bold text-[#173f3b] underline">Learning Rooms</Link>.
          </p>
        </div>
      ) : (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {rooms.map((room) => (
            <RoomCard key={room.id} room={room}>
              <button
                type="button"
                disabled={Boolean(restoring)}
                aria-label={`Restore ${room.room_name}`}
                onClick={() => void handleRestore(room)}
                className="mt-3 block w-full rounded-xl bg-white px-4 py-3 text-center text-sm font-extrabold text-[#173f3b] transition hover:bg-[#f4f7f5] disabled:opacity-60"
              >
                {restoring === room.id ? "Restoring..." : "Restore Classroom"}
              </button>
            </RoomCard>
          ))}
        </div>
      )}
    </section>
  );
}
