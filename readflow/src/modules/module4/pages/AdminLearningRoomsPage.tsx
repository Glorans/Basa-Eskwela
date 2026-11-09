import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../../lib/supabaseClient";
import {
  adminCreateClassroom,
  getAdminClassroomActions,
  getApprovedTeachersForAdmin,
  type ApprovedTeacher,
  type Classroom,
  type ReadingLanguage,
} from "../services/classroomService";
import LearningRoomForm from "../components/LearningRoomForm";

export default function AdminLearningRoomsPage() {
  const navigate = useNavigate();

  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Admin room creation (proposed m4_admin_room_management): the button appears only when the
  // database lists create_room. The room is owned by the approved Teacher the Admin selects.
  const [canCreate, setCanCreate] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [teachers, setTeachers] = useState<ApprovedTeacher[]>([]);
  const [teachersLoading, setTeachersLoading] = useState(false);
  const [teacherId, setTeacherId] = useState("");
  const [roomName, setRoomName] = useState("");
  const [section, setSection] = useState("");
  const [description, setDescription] = useState("");
  const [subject, setSubject] = useState<ReadingLanguage | "">("");
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState("");
  const [createdNotice, setCreatedNotice] = useState("");

  useEffect(() => {
    let live = true;
    void getAdminClassroomActions().then((actions) => { if (live) setCanCreate(actions.includes("create_room")); });
    return () => { live = false; };
  }, []);

  function errorText(err: unknown, fallback: string) {
    const text = (err as { message?: unknown } | null)?.message;
    return typeof text === "string" && text ? text : fallback;
  }

  function resetForm() {
    setTeacherId("");
    setRoomName("");
    setSection("");
    setDescription("");
    setSubject("");
    setFormError("");
  }

  async function openCreateForm() {
    resetForm();
    setCreatedNotice("");
    setShowCreateForm(true);
    setTeachersLoading(true);
    try {
      setTeachers(await getApprovedTeachersForAdmin());
    } catch (err) {
      setTeachers([]);
      setFormError(errorText(err, "Unable to load approved Teachers."));
    } finally {
      setTeachersLoading(false);
    }
  }

  async function handleCreateRoom(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (creating) return;
    if (!teacherId) {
      setFormError("Select an approved Teacher for this learning room.");
      return;
    }
    if (!roomName.trim()) {
      setFormError("Room name is required.");
      return;
    }
    if (!subject) {
      setFormError("Please select English or Filipino.");
      return;
    }
    try {
      setCreating(true);
      setFormError("");
      const room = await adminCreateClassroom({ teacherId, subject, roomName, section, description });
      const owner = teachers.find((teacher) => teacher.id === teacherId)?.display_name ?? "the selected Teacher";
      setClassrooms((current) => [room, ...current]);
      resetForm();
      setShowCreateForm(false);
      setCreatedNotice(`"${room.room_name}" was created for ${owner}. Room code: ${room.room_code}`);
    } catch (err) {
      console.error("Failed to create learning room as Admin:", err);
      setFormError(errorText(err, "Unable to create learning room."));
    } finally {
      setCreating(false);
    }
  }

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
            {showCreateForm ? "Create Learning Room" : "Learning Rooms"}
          </h1>

          <p className="mt-2 text-sm text-white/70 md:text-base">
            {showCreateForm
              ? "Create a classroom and choose the approved Teacher who will manage it."
              : "View and monitor classrooms created by teachers."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
        {canCreate && (
          <button
            type="button"
            disabled={creating}
            onClick={() => {
              if (showCreateForm) {
                resetForm();
                setShowCreateForm(false);
              } else {
                void openCreateForm();
              }
            }}
            className={`rounded-2xl px-5 py-3 font-bold shadow-md transition hover:-translate-y-0.5 disabled:opacity-60 ${
              showCreateForm
                ? "bg-[#ef7468] text-white hover:bg-[#df665c]"
                : "bg-[#f7cf4a] text-[#173f3b] hover:bg-[#f2c83a]"
            }`}
          >
            {showCreateForm ? "Cancel" : "+ Create Learning Room"}
          </button>
        )}

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
      </div>

      {createdNotice && !showCreateForm && (
        <p role="status" className="mb-6 rounded-2xl bg-[#e5f5e9] px-5 py-4 text-sm font-bold text-[#173f3b]">
          {createdNotice}
        </p>
      )}

      {showCreateForm ? (
        <>
          {formError && (
            <div role="alert" className="mb-6 rounded-2xl border border-[#ef7468]/40 bg-[#fff0ee] px-5 py-4 text-sm font-semibold text-[#a9443c]">
              {formError}
            </div>
          )}
          <LearningRoomForm
            roomName={roomName}
            section={section}
            description={description}
            subject={subject}
            creating={creating}
            onRoomNameChange={setRoomName}
            onSectionChange={setSection}
            onDescriptionChange={setDescription}
            onSubjectChange={setSubject}
            onSubmit={(event) => void handleCreateRoom(event)}
            submitLabel="Create Learning Room"
            ownerField={(
              <div className="mb-5">
                <label htmlFor="roomTeacher" className="mb-2 block text-sm font-bold text-[#173f3b]">
                  Teacher <span className="text-[#e45f55]">*</span>
                </label>
                <select id="roomTeacher" value={teacherId} required disabled={creating || teachersLoading}
                  aria-describedby="roomTeacherHelp" onChange={(event) => setTeacherId(event.target.value)}
                  className="w-full rounded-xl border-2 border-transparent bg-white px-4 py-3 text-[#173f3b] outline-none transition focus:border-[#f7cf4a]">
                  <option value="">{teachersLoading ? "Loading approved Teachers..." : "Choose an approved Teacher"}</option>
                  {teachers.map((teacher) => (
                    <option key={teacher.id} value={teacher.id}>{teacher.display_name}</option>
                  ))}
                </select>
                <p id="roomTeacherHelp" className="mt-1 text-sm text-[#5c7471]">
                  {!teachersLoading && teachers.length === 0
                    ? "There are no approved Teachers yet. Approve a Teacher before creating a learning room."
                    : "The selected Teacher owns and manages this learning room. You keep Admin access to it."}
                </p>
              </div>
            )}
          />
        </>
      ) : classrooms.length === 0 ? (
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

                {room.description?.trim() && room.description.trim().toLowerCase() !== "none" && (
                  <p className="mt-2 line-clamp-2 text-sm leading-6 text-[#5c7471]">
                    {room.description}
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