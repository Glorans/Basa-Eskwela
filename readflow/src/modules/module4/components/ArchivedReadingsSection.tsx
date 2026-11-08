// Student Reading History: Archived Readings. Classrooms the teacher archived are no longer active Learning
// Rooms, but their assigned stories and saved results stay readable. Each opens the classroom read-only (no
// recorder, no new answers; the server refuses new submissions for archived rooms). Nothing shows when there
// is no archived classroom.
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../../../lib/supabaseClient";
import { getStudentClassrooms, isRoomArchived, type Classroom } from "../services/classroomService";

export default function ArchivedReadingsSection() {
  const navigate = useNavigate();
  const location = useLocation();
  const [rooms, setRooms] = useState<Classroom[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const { data: { user }, error: userError } = await supabase.auth.getUser();
        if (userError) throw userError;
        if (!user) return;
        const all = await getStudentClassrooms(user.id);
        if (active) setRooms(all.filter(isRoomArchived));
      } catch {
        if (active) setError("Archived readings are unavailable right now.");
      }
    }
    void load();
    return () => { active = false; };
  }, []);

  // Linked from Learning Rooms as #archived-readings.
  useEffect(() => {
    if (location.hash === "#archived-readings" && rooms.length) {
      document.getElementById("archived-readings")?.scrollIntoView({ block: "start" });
    }
  }, [location.hash, rooms.length]);

  if (!rooms.length && !error) return null;
  return (
    <section id="archived-readings" aria-labelledby="archivedReadingsHeading" className="m-4 rounded-3xl bg-white p-6 text-[#173f3b] md:m-8">
      <h2 id="archivedReadingsHeading" className="text-2xl font-extrabold">Archived Readings</h2>
      <p className="my-3">
        These classrooms were archived by your teacher. You can still read their stories and see your saved results,
        but new readings and answers cannot be submitted.
      </p>
      {error ? <p role="alert">{error}</p> : (
        <ul className="space-y-3">
          {rooms.map((room) => (
            <li key={room.id}>
              <button
                type="button"
                onClick={() => navigate(`/dashboard/learning-rooms/${room.id}`)}
                className="block w-full rounded-2xl border-2 border-[#dce8e7] bg-white p-5 text-left transition hover:border-[#173f3b] focus-visible:border-[#173f3b] focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-[#f7cf4a]"
              >
                <span className="block text-xl font-bold">
                  {room.room_name}{room.section ? ` - ${room.section}` : ""} (Archived)
                </span>
                <span className="mt-1 block font-bold underline">Open read-only</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
