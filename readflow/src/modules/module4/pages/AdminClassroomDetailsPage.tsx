import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  getClassroomById,
  getRoomEnrollments,
  getAssignedModules,
  type Classroom,
  type EnrolledStudent,
  type AssignedReadingModule,
} from "../services/classroomService";

export default function AdminClassroomDetailsPage() {
  const navigate = useNavigate();
  const { roomId } = useParams<{ roomId: string }>();

  const [classroom, setClassroom] =
    useState<Classroom | null>(null);

  const [students, setStudents] =
    useState<EnrolledStudent[]>([]);

  const [assignedModules, setAssignedModules] =
    useState<AssignedReadingModule[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadClassroomDetails() {
      if (!roomId) {
        setError("Classroom not found.");
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError("");

        const [room, enrolledStudents, modules] =
          await Promise.all([
            getClassroomById(roomId),
            getRoomEnrollments(roomId),
            getAssignedModules(roomId),
          ]);

        setClassroom(room);
        setStudents(enrolledStudents);
        setAssignedModules(modules);
      } catch (err) {
        console.error(
          "Failed to load classroom details:",
          err
        );

        setError("Unable to load classroom details.");
      } finally {
        setLoading(false);
      }
    }

    void loadClassroomDetails();
  }, [roomId]);

  if (loading) {
    return (
      <section className="min-h-full p-5 md:p-8">
        <div className="rounded-3xl bg-[#dce8e7] px-6 py-14 text-center shadow-md">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#f7cf4a] text-2xl">
            🏫
          </div>

          <p className="font-semibold text-[#5c7471]">
            Loading classroom...
          </p>
        </div>
      </section>
    );
  }

  if (error || !classroom) {
    return (
      <section className="min-h-full p-5 md:p-8">
        <div className="rounded-3xl bg-[#dce8e7] px-6 py-14 text-center shadow-md">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#ef7468] text-2xl font-black text-white">
            !
          </div>

          <h1 className="text-2xl font-extrabold text-[#173f3b]">
            Classroom Details
          </h1>

          <p className="mt-2 text-sm text-[#5c7471]">
            {error || "Classroom not found."}
          </p>

          <button
            type="button"
            onClick={() =>
              navigate("/admin/learning-rooms")
            }
            className="mt-6 rounded-xl bg-[#f7cf4a] px-5 py-3 font-extrabold text-[#173f3b] transition hover:bg-[#f2c83a]"
          >
            ← Back to Learning Rooms
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="min-h-full p-5 md:p-8">
      {/* Back */}
      <button
        type="button"
        onClick={() =>
          navigate("/admin/learning-rooms")
        }
        className="mb-5 inline-flex items-center gap-2 text-sm font-bold text-white/80 transition hover:text-white"
      >
        ← Back to Learning Rooms
      </button>

      {/* Classroom Information */}
      <div className="mb-7 rounded-3xl bg-[#dce8e7] p-6 shadow-lg md:p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[#f7cf4a] text-3xl">
              🏫
            </div>

            <div>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-extrabold text-[#173f3b] md:text-3xl">
                  {classroom.room_name}
                </h1>

                {classroom.section && (
                  <span className="rounded-full bg-[#ef7468] px-3 py-1 text-xs font-bold text-white">
                    {classroom.section}
                  </span>
                )}
              </div>

              {classroom.description?.trim() && classroom.description.trim().toLowerCase() !== "none" && (
                <p className="max-w-2xl text-sm leading-6 text-[#5c7471] md:text-base">
                  {classroom.description}
                </p>
              )}
            </div>
          </div>

          {/* Room Code */}
          <div className="min-w-[180px] rounded-2xl bg-white/70 px-5 py-4">
            <p className="text-xs font-bold uppercase tracking-wide text-[#6d8582]">
              Room Code
            </p>

            <p className="mt-1 text-lg font-black tracking-[0.15em] text-[#173f3b]">
              {classroom.room_code}
            </p>

            <div className="mt-3 border-t border-[#cbdad8] pt-3">
              <p className="text-xs font-bold uppercase tracking-wide text-[#6d8582]">
                Created
              </p>

              <p className="mt-1 text-sm font-bold text-[#173f3b]">
                {new Date(
                  classroom.created_at
                ).toLocaleDateString(undefined, {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Overview */}
      <div className="mb-7 grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl bg-[#dce8e7] p-5 shadow-md">
          <p className="text-sm font-bold text-[#6d8582]">
            Enrolled Students
          </p>

          <p className="mt-1 text-3xl font-black text-[#173f3b]">
            {students.length}
          </p>
        </div>

        <div className="rounded-2xl bg-[#dce8e7] p-5 shadow-md">
          <p className="text-sm font-bold text-[#6d8582]">
            Assigned Reading Modules
          </p>

          <p className="mt-1 text-3xl font-black text-[#173f3b]">
            {assignedModules.length}
          </p>
        </div>
      </div>

      {/* Enrolled Students */}
      <div className="mb-7">
        <div className="mb-4">
          <h2 className="text-xl font-extrabold text-white md:text-2xl">
            Enrolled Students
          </h2>

          <p className="mt-1 text-sm text-white/65">
            Students currently enrolled in this learning room.
          </p>
        </div>

        {students.length === 0 ? (
          <div className="rounded-3xl bg-[#dce8e7] px-6 py-12 text-center shadow-md">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#f7cf4a] text-2xl">
              👥
            </div>

            <h3 className="font-extrabold text-[#173f3b]">
              No enrolled students
            </h3>

            <p className="mt-2 text-sm text-[#5c7471]">
              No students have joined this learning room yet.
            </p>
          </div>
        ) : (
          <div className="rounded-3xl bg-[#dce8e7] p-5 shadow-md md:p-6">
            <div className="space-y-3">
              {students.map((student) => {
                const initial =
                  student.display_name?.trim().charAt(0).toUpperCase() ||
                  "?";

                return (
                  <div
                    key={student.enrollment_id}
                    className="flex items-center gap-4 rounded-2xl bg-white/70 px-4 py-4"
                  >
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#f7cf4a] text-base font-black text-[#173f3b]">
                      {initial}
                    </div>

                    <div className="min-w-0">
                      <p className="truncate font-extrabold text-[#173f3b]">
                        {student.display_name}
                      </p>

                      <p className="mt-1 text-xs font-semibold text-[#6d8582]">
                        Joined{" "}
                        {new Date(
                          student.enrolled_at
                        ).toLocaleDateString(undefined, {
                          year: "numeric",
                          month: "long",
                          day: "numeric",
                        })}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Assigned Modules */}
      <div>
        <div className="mb-4">
          <h2 className="text-xl font-extrabold text-white md:text-2xl">
            Assigned Reading Modules
          </h2>

          <p className="mt-1 text-sm text-white/65">
            Reading modules assigned to this classroom by the
            teacher.
          </p>
        </div>

        {assignedModules.length === 0 ? (
          <div className="rounded-3xl bg-[#dce8e7] px-6 py-12 text-center shadow-md">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#f7cf4a] text-2xl">
              📚
            </div>

            <h3 className="font-extrabold text-[#173f3b]">
              No modules assigned
            </h3>

            <p className="mt-2 text-sm text-[#5c7471]">
              The teacher has not assigned a reading module to
              this classroom yet.
            </p>
          </div>
        ) : (
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {assignedModules.map((module, index) => (
              <article
                key={module.assignment_id}
                className="flex min-h-[210px] flex-col rounded-3xl bg-[#dce8e7] p-6 shadow-md"
              >
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#f7cf4a] text-xl">
                    📖
                  </div>

                  {module.difficulty && (
                    <span className="rounded-full bg-[#ef7468] px-3 py-1 text-xs font-bold text-white">
                      {module.difficulty}
                    </span>
                  )}
                </div>

                <p className="text-xs font-bold uppercase tracking-wide text-[#7b9290]">
                  Reading Module {index + 1}
                </p>

                <h3 className="mt-1 text-lg font-extrabold text-[#173f3b]">
                  {module.title}
                </h3>

                <div className="mt-auto pt-5">
                  <div className="rounded-xl bg-white/70 px-4 py-3">
                    <p className="text-xs font-bold uppercase tracking-wide text-[#6d8582]">
                      Assigned
                    </p>

                    <p className="mt-1 text-sm font-bold text-[#173f3b]">
                      {new Date(
                        module.assigned_at
                      ).toLocaleDateString(undefined, {
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                      })}
                    </p>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}