import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../../lib/supabaseClient";
import type { Classroom } from "../services/classroomService";

export default function AdminLearningRoomsPage() {
  const navigate = useNavigate();

  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadClassrooms() {
      try {
        setLoading(true);
        setError("");

        const { data, error: roomsError } = await supabase
          .from("rooms")
          .select("*")
          .order("created_at", { ascending: false });

        if (roomsError) {
          throw roomsError;
        }

        setClassrooms(data ?? []);
      } catch (err) {
        console.error(
          "Failed to load learning rooms:",
          err
        );

        setError("Unable to load learning rooms.");
      } finally {
        setLoading(false);
      }
    }

    void loadClassrooms();
  }, []);

  if (loading) {
    return (
      <section className="min-h-full p-5 md:p-8">
        <div className="mb-7">
          <h1 className="text-3xl font-extrabold text-white md:text-4xl">
            Learning Rooms
          </h1>

          <p className="mt-2 text-sm text-white/70 md:text-base">
            View and monitor classrooms created by teachers.
          </p>
        </div>

        <div className="rounded-3xl bg-[#dce8e7] px-6 py-14 text-center shadow-md">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#f7cf4a] text-2xl">
            🏫
          </div>

          <p className="font-semibold text-[#5c7471]">
            Loading learning rooms...
          </p>
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="min-h-full p-5 md:p-8">
        <div className="mb-7">
          <h1 className="text-3xl font-extrabold text-white md:text-4xl">
            Learning Rooms
          </h1>
        </div>

        <div className="rounded-3xl bg-[#dce8e7] px-6 py-14 text-center shadow-md">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#ef7468] text-2xl font-black text-white">
            !
          </div>

          <h2 className="text-xl font-extrabold text-[#173f3b]">
            Unable to load learning rooms
          </h2>

          <p className="mt-2 text-sm text-[#5c7471]">
            {error}
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="min-h-full p-5 md:p-8">
      {/* Page Header */}
      <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-extrabold text-white md:text-4xl">
            Learning Rooms
          </h1>

          <p className="mt-2 text-sm text-white/70 md:text-base">
            View and monitor classrooms created by teachers.
          </p>
        </div>

        <div className="w-fit rounded-2xl bg-white/10 px-5 py-3 text-center">
          <p className="text-2xl font-black text-white">
            {classrooms.length}
          </p>

          <p className="text-xs font-bold uppercase tracking-wide text-white/70">
            {classrooms.length === 1
              ? "Learning Room"
              : "Learning Rooms"}
          </p>
        </div>
      </div>

      {/* Empty State */}
      {classrooms.length === 0 ? (
        <div className="rounded-3xl bg-[#dce8e7] px-6 py-14 text-center shadow-md">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[#f7cf4a] text-3xl">
            🏫
          </div>

          <h2 className="text-xl font-extrabold text-[#173f3b]">
            No learning rooms yet
          </h2>

          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#5c7471]">
            Classrooms created by teachers will automatically
            appear here.
          </p>
        </div>
      ) : (
        /* Classroom Grid */
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {classrooms.map((room) => (
            <article
              key={room.id}
              className="flex min-h-[310px] flex-col rounded-3xl bg-[#dce8e7] p-6 shadow-md transition duration-200 hover:-translate-y-1 hover:shadow-lg"
            >
              {/* Card Header */}
              <div className="mb-5 flex items-start justify-between gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#f7cf4a] text-2xl">
                  🏫
                </div>

                {room.section && (
                  <span className="rounded-full bg-[#ef7468] px-3 py-1 text-xs font-bold text-white">
                    {room.section}
                  </span>
                )}
              </div>

              {/* Room Details */}
              <div>
                <h2 className="text-xl font-extrabold leading-snug text-[#173f3b]">
                  {room.room_name}
                </h2>

                {room.description ? (
                  <p className="mt-2 line-clamp-2 text-sm leading-6 text-[#5c7471]">
                    {room.description}
                  </p>
                ) : (
                  <p className="mt-2 text-sm italic text-[#7b9290]">
                    None
                  </p>
                )}
              </div>

              {/* Room Information */}
              <div className="mt-5 space-y-3 rounded-2xl bg-white/70 px-4 py-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-[#6d8582]">
                    Room Code
                  </p>

                  <p className="mt-1 text-base font-black tracking-[0.12em] text-[#173f3b]">
                    {room.room_code}
                  </p>
                </div>

                <div className="border-t border-[#cbdad8] pt-3">
                  <p className="text-xs font-bold uppercase tracking-wide text-[#6d8582]">
                    Created
                  </p>

                  <p className="mt-1 text-sm font-bold text-[#173f3b]">
                    {new Date(
                      room.created_at
                    ).toLocaleDateString(undefined, {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    })}
                  </p>
                </div>
              </div>

              {/* View Classroom */}
              <div className="mt-auto pt-5">
                <button
                  type="button"
                  onClick={() =>
                    navigate(
                      `/admin/learning-rooms/${room.id}`
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