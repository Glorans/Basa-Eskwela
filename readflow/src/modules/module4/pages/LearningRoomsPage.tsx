import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../../../lib/supabaseClient";
import {
  createClassroom,
  getTeacherClassrooms,
  isRoomArchived,
  type Classroom,
  type ReadingLanguage,
} from "../services/classroomService";
import RoomCard from "../components/RoomCard";

export default function LearningRoomsPage() {
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [roomName, setRoomName] = useState("");
  const [section, setSection] = useState("");
  const [description, setDescription] = useState("");
  const [subject, setSubject] = useState<ReadingLanguage | "">("");
  const [creating, setCreating] = useState(false);
  // Archived rooms live on the Archived Classrooms page; this page lists active rooms only.
  const activeRooms = classrooms.filter((room) => !isRoomArchived(room));
  const archivedCount = classrooms.length - activeRooms.length;

  useEffect(() => {
    async function loadClassrooms() {
      try {
        setLoading(true);
        setError("");

        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser();

        if (userError) {
          throw userError;
        }

        if (!user) {
          throw new Error("No authenticated teacher found.");
        }

        const rooms = await getTeacherClassrooms(user.id);
        setClassrooms(rooms);
      } catch (err) {
        console.error("Failed to load learning rooms:", err);
        setError("Unable to load learning rooms.");
      } finally {
        setLoading(false);
      }
    }

    void loadClassrooms();
  }, []);

  async function handleCreateRoom(
    event: React.FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    if (!roomName.trim()) {
      setError("Room name is required.");
      return;
    }

    if (!subject) {
      setError("Please select English or Filipino.");
      return;
    }

    try {
      setCreating(true);
      setError("");

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError) {
        throw userError;
      }

      if (!user) {
        throw new Error("No authenticated teacher found.");
      }

      const newRoom = await createClassroom({
        teacherId: user.id,
        subject,
        roomName,
        section,
        description,
      });

      setClassrooms((current) => [newRoom, ...current]);

      setRoomName("");
      setSection("");
      setDescription("");
      setSubject("");
      setShowCreateForm(false);
    } catch (err) {
      console.error("Failed to create learning room:", err);
      setError(err instanceof Error && err.message.startsWith("Room subjects are not installed")
        ? err.message : "Unable to create learning room.");
    } finally {
      setCreating(false);
    }
  }

  if (loading) {
    return (
      <section className="min-h-full p-6 md:p-8">
        <div className="rounded-3xl bg-[#dce8e7] p-8 shadow-sm">
          <h1 className="text-3xl font-bold text-[#173f3b]">
            Learning Rooms
          </h1>
          <p className="mt-3 text-[#4b6663]">Loading classrooms...</p>
        </div>
      </section>
    );
  }

  return (
    <section className="min-h-full p-5 md:p-8">
      {/* Page Header */}
      <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-extrabold text-white md:text-4xl">
            {showCreateForm ? "Create Learning Room" : "Learning Rooms"}
          </h1>
          <p className="mt-1 text-sm text-white/75 md:text-base">
            Create and manage your reading classrooms.
          </p>
        </div>

        <button
          type="button"
          disabled={creating}
          onClick={() => {
            if (showCreateForm) {
              setRoomName("");
              setSection("");
              setDescription("");
              setSubject("");
            }
            setShowCreateForm((current) => !current);
            setError("");
          }}
          className={`rounded-2xl px-5 py-3 font-bold shadow-md transition hover:-translate-y-0.5 ${
            showCreateForm
              ? "bg-[#ef7468] text-white hover:bg-[#df665c]"
              : "bg-[#f7cf4a] text-[#173f3b] hover:bg-[#f2c83a]"
          }`}
        >
          {showCreateForm ? "Cancel" : "+ Create Learning Room"}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-6 rounded-2xl border border-[#ef7468]/40 bg-[#fff0ee] px-5 py-4 text-sm font-semibold text-[#a9443c]">
          {error}
        </div>
      )}

      {/* Create Room Form */}
      {showCreateForm ? (
        <form
          onSubmit={handleCreateRoom}
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
                onChange={(event) => setRoomName(event.target.value)}
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
                onChange={(event) => setSection(event.target.value)}
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
              onChange={(event) => setSubject(event.target.value as ReadingLanguage | "")}
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
              onChange={(event) => setDescription(event.target.value)}
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
              {creating ? "Creating..." : "Create Room"}
            </button>
          </div>
        </form>
      ) : (
        <>
      {/* Room Count */}
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold text-white">
          Your Learning Rooms
        </h2>

        <span className="rounded-full bg-white/10 px-3 py-1 text-sm font-semibold text-white/80">
          {classrooms.length}{" "}
          {classrooms.length === 1 ? "Room" : "Rooms"}
        </span>
      </div>

      {/* Empty State */}
      {classrooms.length === 0 ? (
        <div className="rounded-3xl bg-[#dce8e7] px-6 py-14 text-center shadow-md">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[#f7cf4a] text-3xl">
            📚
          </div>

          <h2 className="text-xl font-extrabold text-[#173f3b]">
            No learning rooms yet
          </h2>

          <p className="mx-auto mt-2 max-w-md text-sm text-[#5c7471]">
            Create your first learning room to start organizing students
            and assigning reading modules.
          </p>

          <button
            type="button"
            onClick={() => {
              setShowCreateForm(true);
              setError("");
            }}
            className="mt-5 rounded-xl bg-[#f7cf4a] px-5 py-3 font-bold text-[#173f3b] transition hover:bg-[#f2c83a]"
          >
            + Create Learning Room
          </button>
        </div>
      ) : (
        /* Room Cards */
        <>
          {activeRooms.length === 0 ? (
            <p role="status" className="rounded-2xl bg-white/60 px-5 py-4 text-sm text-[#5c7471]">
              All your learning rooms are archived. Create a new room, or restore one from Archived Classrooms.
            </p>
          ) : (
            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {activeRooms.map((room) => (
                <RoomCard key={room.id} room={room} />
              ))}
            </div>
          )}
          {archivedCount > 0 && (
            <p className="mt-6 text-sm text-[#5c7471]">
              {archivedCount === 1 ? "1 archived classroom is" : `${archivedCount} archived classrooms are`} kept in{" "}
              <Link to="/m3/teacher/archived-classrooms" className="font-bold text-[#173f3b] underline">
                Archived Classrooms
              </Link>
              .
            </p>
          )}
        </>
      )}
        </>
      )}
    </section>
  );
}