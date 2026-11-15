// Student: Archived Rooms. Two different things, shown separately:
//  * "Archived by you": rooms this Student archived for their own list only (proposed
//    m4_student_room_archive). They stay fully usable; Restore puts them back in Learning Rooms.
//  * "Archived by your teacher": rooms archived for everyone (rooms.archived_at). Read-only, and a
//    Student cannot restore them; the database refuses it as well.
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { confirmReadFlow } from "../../../components/ReadFlowDialog";
import { supabase } from "../../../lib/supabaseClient";
import { getStudentClassrooms, isRoomArchived, type Classroom } from "../services/classroomService";
import { getMyArchivedRooms, setMyRoomArchived, type StudentRoomArchives } from "../services/studentRoomArchive";
import { getStudentRoomTeacherNames, type RoomTeacherNames } from "../services/studentRoomTeachers";

export default function StudentArchivedRoomsPage() {
  const navigate = useNavigate();
  const [rooms, setRooms] = useState<Classroom[]>([]);
  const [personal, setPersonal] = useState<StudentRoomArchives>({ supported: false, roomIds: new Set() });
  const [teacherNames, setTeacherNames] = useState<RoomTeacherNames>();
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const byTeacher = rooms.filter((room) => isRoomArchived(room));
  const byYou = rooms.filter((room) => !isRoomArchived(room) && personal.roomIds.has(room.id));

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const { data: { user }, error: userError } = await supabase.auth.getUser();
        if (userError) throw userError;
        if (!user) throw new Error("No authenticated student found.");
        const [joined, archives] = await Promise.all([getStudentClassrooms(user.id), getMyArchivedRooms()]);
        if (!active) return;
        setRooms(joined);
        setPersonal(archives);
        if (joined.length) {
          getStudentRoomTeacherNames().then((names) => { if (active) setTeacherNames(names); })
            .catch(() => { if (active) setTeacherNames({}); });
        } else {
          setTeacherNames({});
        }
      } catch (err) {
        console.error("Failed to load archived learning rooms:", err);
        if (active) setError("Unable to load your archived learning rooms.");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, []);

  async function handleRestore(room: Classroom) {
    if (restoring) return;
    if (!(await confirmReadFlow(`Restore "${room.room_name}"? It returns to your Learning Rooms.`))) return;
    setRestoring(room.id);
    setError("");
    setNotice("");
    try {
      await setMyRoomArchived(room.id, false);
      setPersonal((current) => {
        const roomIds = new Set(current.roomIds);
        roomIds.delete(room.id);
        return { ...current, roomIds };
      });
      setNotice(`"${room.room_name}" was restored and is back in your Learning Rooms.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The learning room could not be restored.");
    } finally {
      setRestoring(null);
    }
  }

  function teacherLine(room: Classroom) {
    return teacherNames === undefined ? "Teacher: Loading..."
      : teacherNames[room.id] ? `Teacher: ${teacherNames[room.id]}` : "Teacher name unavailable";
  }

  function card(room: Classroom, badge: string, actions: React.ReactNode, note?: string) {
    return (
      <article key={room.id} className="flex flex-col rounded-3xl bg-[#dce8e7] p-6 shadow-md">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#f7cf4a] text-2xl" aria-hidden="true">
            📦
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <span className="rounded-full bg-[#5c7471] px-3 py-1 text-xs font-bold text-white">{badge}</span>
            {room.section && (
              <span className="rounded-full bg-[#ef7468] px-3 py-1 text-xs font-bold text-white">{room.section}</span>
            )}
          </div>
        </div>
        <h3 className="text-xl font-extrabold text-[#173f3b] [overflow-wrap:anywhere]">{room.room_name}</h3>
        <p className="mt-1 min-w-0 text-sm font-semibold text-[#2f5c57] [overflow-wrap:anywhere]">{teacherLine(room)}</p>
        {note && <p className="mt-3 text-sm leading-6 text-[#5c7471]">{note}</p>}
        <div className="mt-auto grid gap-2 pt-5">{actions}</div>
      </article>
    );
  }

  const primary = "w-full rounded-xl bg-[#f7cf4a] px-4 py-3 text-sm font-extrabold text-[#173f3b] transition hover:bg-[#f2c83a] disabled:cursor-not-allowed disabled:opacity-60";
  const secondary = "w-full rounded-xl bg-white px-4 py-3 text-sm font-extrabold text-[#173f3b] transition hover:bg-[#f4f7f5] disabled:cursor-not-allowed disabled:opacity-60";

  return (
    <section className="min-h-full p-5 md:p-8">
      <button
        type="button"
        onClick={() => navigate("/dashboard/join-classroom")}
        className="mb-5 inline-flex items-center gap-2 text-sm font-bold text-white/80 transition hover:text-white"
      >
        ← Back to Learning Rooms
      </button>

      <div className="mb-7">
        <h1 className="text-3xl font-extrabold text-white md:text-4xl">Archived Rooms</h1>
        <p className="mt-2 text-sm text-white/75 md:text-base">
          Rooms you archived are hidden only from your own list. Your teacher, classmates, activities and results stay the same.
        </p>
      </div>

      <div aria-live="polite" role="status">
        {notice && <p className="mb-4 rounded-xl bg-[#dff1d9] px-4 py-3 text-sm font-bold text-[#2f7632]">✓ {notice}</p>}
      </div>
      {error && <p role="alert" className="mb-4 rounded-xl bg-[#fff0ee] px-4 py-3 text-sm font-bold text-[#a9443c]">{error}</p>}

      {loading ? (
        <div className="rounded-3xl bg-[#dce8e7] px-6 py-12 text-center shadow-md">
          <p role="status" className="font-semibold text-[#5c7471]">Loading your archived learning rooms...</p>
        </div>
      ) : (
        <>
          <h2 className="mb-1 text-xl font-extrabold text-white">Archived by you</h2>
          <p className="mb-4 text-sm text-white/65">You can open these rooms and restore them to your Learning Rooms at any time.</p>
          {!personal.supported ? (
            <p className="mb-8 rounded-3xl bg-[#dce8e7] px-6 py-8 text-center text-sm font-semibold text-[#5c7471]">
              Archiving your own Learning Rooms isn't available yet.
            </p>
          ) : byYou.length === 0 ? (
            <p className="mb-8 rounded-3xl bg-[#dce8e7] px-6 py-8 text-center text-sm font-semibold text-[#5c7471]">
              You haven't archived any learning rooms. Use the ⋮ menu on a room in Learning Rooms to archive it.
            </p>
          ) : (
            <div className="mb-8 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {byYou.map((room) => card(room, "Archived by you", <>
                <button type="button" className={primary} disabled={Boolean(restoring)} aria-label={`Restore ${room.room_name}`}
                  onClick={() => void handleRestore(room)}>
                  {restoring === room.id ? "Restoring..." : "Restore"}
                </button>
                <button type="button" className={secondary} onClick={() => navigate(`/dashboard/learning-rooms/${room.id}`)}>
                  View Classroom
                </button>
              </>))}
            </div>
          )}

          <h2 className="mb-1 text-xl font-extrabold text-white">Archived by your teacher</h2>
          <p className="mb-4 text-sm text-white/65">
            Your teacher archived these classrooms for everyone. You can read their stories and see your saved results, but you can't restore them.
          </p>
          {byTeacher.length === 0 ? (
            <p className="rounded-3xl bg-[#dce8e7] px-6 py-8 text-center text-sm font-semibold text-[#5c7471]">
              None of your classrooms were archived by your teacher.
            </p>
          ) : (
            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {byTeacher.map((room) => card(room, "Archived by your teacher", (
                <button type="button" className={secondary} onClick={() => navigate(`/dashboard/learning-rooms/${room.id}`)}>
                  Open read-only
                </button>
              ), personal.roomIds.has(room.id) ? "You also archived this room for yourself." : undefined))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
