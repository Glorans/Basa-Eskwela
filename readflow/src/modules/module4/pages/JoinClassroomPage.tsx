import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../../lib/supabaseClient";
import {
  getStudentClassrooms,
  joinClassroomByCode,
  type Classroom,
} from "../services/classroomService";

export default function JoinClassroomPage() {
  const navigate = useNavigate();

  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [roomCode, setRoomCode] = useState("");

  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    async function loadStudentClassrooms() {
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
          throw new Error("No authenticated student found.");
        }

        const joinedRooms = await getStudentClassrooms(user.id);
        setClassrooms(joinedRooms);
      } catch (err) {
        console.error(
          "Failed to load student classrooms:",
          err
        );

        setError("Unable to load your learning rooms.");
      } finally {
        setLoading(false);
      }
    }

    void loadStudentClassrooms();
  }, []);

  async function handleJoinClassroom(
    event: React.FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    const normalizedRoomCode = roomCode.trim().toUpperCase();

    if (!normalizedRoomCode) {
      setError("Please enter a room code.");
      return;
    }

    const alreadyJoined = classrooms.some(
      (room) =>
        room.room_code.toUpperCase() === normalizedRoomCode
    );

    if (alreadyJoined) {
      setSuccess("");
      setError("You have already joined this learning room.");
      return;
    }

    try {
      setJoining(true);
      setError("");
      setSuccess("");

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError) {
        throw userError;
      }

      if (!user) {
        throw new Error("No authenticated student found.");
      }

      await joinClassroomByCode(
        user.id,
        normalizedRoomCode
      );

      const updatedRooms =
        await getStudentClassrooms(user.id);

      setClassrooms(updatedRooms);

      setSuccess(
        "You successfully joined the learning room!"
      );

      setRoomCode("");
    } catch (err) {
      console.error("Failed to join classroom:", err);

      setError(
        "Unable to join classroom. Please check the room code and try again."
      );
    } finally {
      setJoining(false);
    }
  }

  return (
    <section className="min-h-full p-5 md:p-8">
      {/* Back Button */}
      <button
        type="button"
        onClick={() => navigate("/dashboard")}
        className="mb-5 inline-flex items-center gap-2 text-sm font-bold text-white/80 transition hover:text-white"
      >
        ← Back to Dashboard
      </button>

      {/* Page Header */}
      <div className="mb-7">
        <h1 className="text-3xl font-extrabold text-white md:text-4xl">
          Learning Rooms
        </h1>

        <p className="mt-2 text-sm text-white/75 md:text-base">
          View your classrooms and join a learning room using your
          teacher's room code.
        </p>
      </div>

      {/* Join Classroom */}
      <div className="mb-7 rounded-3xl bg-[#dce8e7] p-6 shadow-lg md:p-7">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-lg">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#f7cf4a] text-2xl">
              🔑
            </div>

            <h2 className="text-2xl font-extrabold text-[#173f3b]">
              Join a Learning Room
            </h2>

            <p className="mt-2 text-sm leading-6 text-[#5c7471]">
              Enter the room code provided by your teacher to join
              their classroom.
            </p>
          </div>

          <form
            onSubmit={handleJoinClassroom}
            className="w-full rounded-2xl bg-white/65 p-5 lg:max-w-md"
          >
            <label
              htmlFor="roomCode"
              className="mb-2 block text-sm font-bold text-[#173f3b]"
            >
              Room Code
            </label>

            <div className="flex flex-col gap-3 sm:flex-row">
              <input
                id="roomCode"
                type="text"
                value={roomCode}
                onChange={(event) => {
                  setRoomCode(
                    event.target.value.toUpperCase()
                  );

                  setError("");
                  setSuccess("");
                }}
                placeholder="Example: HPFL5Q3C"
                maxLength={8}
                required
                className="min-w-0 flex-1 rounded-xl border-2 border-transparent bg-white px-4 py-3 font-bold uppercase tracking-widest text-[#173f3b] outline-none transition placeholder:font-normal placeholder:tracking-normal placeholder:text-gray-400 focus:border-[#f7cf4a]"
              />

              <button
                type="submit"
                disabled={joining || loading}
                className="shrink-0 rounded-xl bg-[#f7cf4a] px-5 py-3 font-extrabold text-[#173f3b] shadow-sm transition hover:bg-[#f2c83a] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {joining
                  ? "Joining..."
                  : "Join Room"}
              </button>
            </div>

            {success && (
              <div className="mt-4 rounded-xl bg-[#dff1d9] px-4 py-3 text-sm font-bold text-[#2f7632]">
                ✓ {success}
              </div>
            )}

            {error && (
              <div className="mt-4 rounded-xl bg-[#fff0ee] px-4 py-3 text-sm font-bold text-[#a9443c]">
                {error}
              </div>
            )}
          </form>
        </div>
      </div>

      {/* Rooms Header */}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-extrabold text-white">
            My Learning Rooms
          </h2>

          <p className="mt-1 text-sm text-white/65">
            Classrooms you are currently enrolled in.
          </p>
        </div>

        {!loading && (
          <span className="rounded-full bg-white/10 px-3 py-1 text-sm font-semibold text-white/80">
            {classrooms.length}{" "}
            {classrooms.length === 1 ? "Room" : "Rooms"}
          </span>
        )}
      </div>

      {/* Loading */}
      {loading ? (
        <div className="rounded-3xl bg-[#dce8e7] px-6 py-12 text-center shadow-md">
          <p className="font-semibold text-[#5c7471]">
            Loading your learning rooms...
          </p>
        </div>
      ) : classrooms.length === 0 ? (
        /* Empty State */
        <div className="rounded-3xl bg-[#dce8e7] px-6 py-14 text-center shadow-md">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[#f7cf4a] text-3xl">
            📚
          </div>

          <h3 className="text-xl font-extrabold text-[#173f3b]">
            No learning rooms yet
          </h3>

          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#5c7471]">
            You haven't joined a classroom yet. Ask your teacher for a
            room code and enter it above.
          </p>
        </div>
      ) : (
        /* Classroom Cards */
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {classrooms.map((room) => (
            <article
              key={room.id}
              className="flex min-h-[265px] flex-col rounded-3xl bg-[#dce8e7] p-6 shadow-md transition duration-200 hover:-translate-y-1 hover:shadow-lg"
            >
              {/* Top */}
              <div className="mb-4 flex items-start justify-between gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#f7cf4a] text-2xl">
                  📖
                </div>

                {room.section && (
                  <span className="rounded-full bg-[#ef7468] px-3 py-1 text-xs font-bold text-white">
                    {room.section}
                  </span>
                )}
              </div>

              {/* Room Details */}
              <h3 className="text-xl font-extrabold text-[#173f3b]">
                {room.room_name}
              </h3>

              {room.description ? (
                <p className="mt-2 line-clamp-2 text-sm leading-6 text-[#5c7471]">
                  {room.description}
                </p>
              ) : (
                <p className="mt-2 text-sm italic text-[#7b9290]">
                  No classroom description.
                </p>
              )}

              {/* Room Code */}
              <div className="mt-5 rounded-2xl bg-white/70 px-4 py-3">
                <p className="text-xs font-bold uppercase tracking-wide text-[#6d8582]">
                  Room Code
                </p>

                <p className="mt-1 text-lg font-black tracking-[0.15em] text-[#173f3b]">
                  {room.room_code}
                </p>
              </div>

              {/* View */}
              <div className="mt-auto pt-5">
                <button
                  type="button"
                  onClick={() =>
                    navigate(
                      `/dashboard/learning-rooms/${room.id}`
                    )
                  }
                  className="w-full rounded-xl bg-[#f7cf4a] px-4 py-3 text-sm font-extrabold text-[#173f3b] transition hover:bg-[#f2c83a]"
                >
                  View Classroom
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}