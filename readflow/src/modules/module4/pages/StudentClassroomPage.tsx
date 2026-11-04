import { activityLanguageState, getActivityText } from "../../../pages/reading-activity/activityLanguage";
import { getAssignedReadingProgress, getOralReadingModule, type AssignedReadingProgress } from "../../module5/services/oralReadingService";
import { assignedReadingTarget } from "../../module5/services/assignedReadingNavigation";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import {
  getClassroomById,
  getAssignedModules,
  getStudentReadingActivities,
  formatDueDateTime,
  isRoomArchived,
  type Classroom,
  type AssignedReadingModule,
  type StudentReadingActivity,
} from "../services/classroomService";

export default function StudentClassroomPage() {
  const navigate = useNavigate();
  const { roomId } = useParams<{ roomId: string }>();

  const [classroom, setClassroom] = useState<Classroom | null>(null);

  const [assignedModules, setAssignedModules] = useState<
    AssignedReadingModule[]
  >([]);

  // Reading activities assigned directly to this student
  const [readingActivities, setReadingActivities] = useState<
    StudentReadingActivity[]
  >([]);

  const [progress, setProgress] = useState<AssignedReadingProgress[]>([]);
  const [progressError, setProgressError] = useState("");
  const [openingActivity, setOpeningActivity] = useState<string>();
  const [openingError, setOpeningError] = useState<{ id: string; message: string }>();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadClassroom() {
      if (!roomId) {
        setError("Classroom not found.");
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError("");

        const [room, modules, activities] = await Promise.all([
          getClassroomById(roomId),
          getAssignedModules(roomId),
          getStudentReadingActivities(roomId),
        ]);

        setClassroom(room);
        setAssignedModules(modules);
        setReadingActivities(activities);
        setProgress([]);
        setProgressError("");
        try { setProgress(await getAssignedReadingProgress(roomId)); }
        catch { setProgressError("Assessment progress is unavailable. Open the activity to retry."); }
      } catch (err) {
        console.error(
          "Failed to load student classroom:",
          err
        );

        setError("Unable to load classroom.");
      } finally {
        setLoading(false);
      }
    }

    void loadClassroom();
  }, [roomId]);

  if (loading) {
    return (
      <section className="min-h-full p-5 md:p-8">
        <div className="rounded-3xl bg-[#dce8e7] px-6 py-14 text-center shadow-md">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#f7cf4a] text-2xl">
            📚
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
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#ef7468] text-2xl">
            !
          </div>

          <h1 className="text-2xl font-extrabold text-[#173f3b]">
            Learning Room
          </h1>

          <p className="mt-2 text-sm text-[#5c7471]">
            {error || "Classroom not found."}
          </p>

          <button
            type="button"
            onClick={() =>
              navigate("/dashboard/join-classroom")
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
      <button
        type="button"
        onClick={() =>
          navigate("/dashboard/join-classroom")
        }
        className="mb-5 inline-flex items-center gap-2 text-sm font-bold text-white/80 transition hover:text-white"
      >
        ← Back to Learning Rooms
      </button>

      {/* Classroom Information */}
      <div className="mb-7 rounded-3xl bg-[#dce8e7] p-6 shadow-lg md:p-8">
        <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
          <div className="flex gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[#f7cf4a] text-3xl">
              📖
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

              {isRoomArchived(classroom) && (
                <p role="note" className="mb-2 rounded-xl bg-[#5c7471]/15 px-3 py-2 text-sm font-bold text-[#173f3b]">
                  Your teacher archived this learning room. You can still see your saved work, but new activities cannot be started.
                </p>
              )}

              {classroom.description?.trim() && classroom.description.trim().toLowerCase() !== "none" && (
                <p className="max-w-2xl text-sm leading-6 text-[#5c7471] md:text-base">
                  {classroom.description}
                </p>
              )}
            </div>
          </div>

          <div className="shrink-0 rounded-2xl bg-white/70 px-5 py-4 text-center">
            <p className="text-2xl font-black text-[#173f3b]">
              {assignedModules.length}
            </p>

            <p className="text-xs font-bold uppercase tracking-wide text-[#6d8582]">
              {assignedModules.length === 1
                ? "Assigned Module"
                : "Assigned Modules"}
            </p>
          </div>
        </div>
      </div>

      {/* ======================================================
          EXISTING ASSIGNED READING MODULES
          Existing functionality preserved
         ====================================================== */}

      <div className="mb-4">
        <h2 className="text-xl font-extrabold text-white md:text-2xl">
          Assigned Reading Modules
        </h2>

        <p className="mt-1 text-sm text-white/65">
          Reading modules assigned to your classroom by your teacher.
        </p>
      </div>

      {assignedModules.length === 0 ? (
        <div className="rounded-3xl bg-[#dce8e7] px-6 py-14 text-center shadow-md">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[#f7cf4a] text-3xl">
            📘
          </div>

          <h3 className="text-xl font-extrabold text-[#173f3b]">
            No modules assigned yet
          </h3>

          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#5c7471]">
            Your teacher has not assigned any reading modules to this
            learning room yet.
          </p>
        </div>
      ) : (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {assignedModules.map((module, index) => (
            <article
              key={module.assignment_id}
              className="flex min-h-[270px] flex-col rounded-3xl bg-[#dce8e7] p-6 shadow-md transition duration-200 hover:-translate-y-1 hover:shadow-lg"
            >
              <div className="mb-5 flex items-start justify-between gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#f7cf4a] text-2xl">
                  📚
                </div>

                {module.difficulty && (
                  <span className="rounded-full bg-[#ef7468] px-3 py-1 text-xs font-bold text-white">
                    {module.difficulty}
                  </span>
                )}
              </div>

              <div>
                <p className="mb-1 text-xs font-bold uppercase tracking-wide text-[#7b9290]">
                  Reading Module {index + 1}
                </p>

                <h3 className="text-xl font-extrabold leading-snug text-[#173f3b]">
                  {module.title}
                </h3>
              </div>

              <div className="mt-5 rounded-2xl bg-white/70 px-4 py-3">
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

                {module.due_at && (
                  <>
                    <p className="mt-3 text-xs font-bold uppercase tracking-wide text-[#6d8582]">
                      Due
                    </p>

                    <p className="mt-1 text-sm font-bold text-[#173f3b]">
                      {formatDueDateTime(module.due_at)}
                    </p>
                  </>
                )}
              </div>

              <div className="mt-auto pt-5">
                <button
                  type="button"
                  onClick={() =>
                    navigate(
                      `/dashboard/materials/${module.module_id}?roomId=${classroom.id}&assignmentId=${module.assignment_id}`,
                      {
                        state: {
                          fromClassroom: true,
                          roomId: classroom.id,
                          assignmentId: module.assignment_id,
                        },
                      }
                    )
                  }
                  className="w-full rounded-xl bg-[#f7cf4a] px-4 py-3 text-sm font-extrabold text-[#173f3b] transition hover:bg-[#f2c83a]"
                >
                  Open Reading Module →
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {/* ======================================================
          ASSIGNED READING ACTIVITIES
         ====================================================== */}

      <div className="mb-4 mt-10">
        <h2 className="text-xl font-extrabold text-white md:text-2xl">
          Assigned Reading Activities
        </h2>

        <p className="mt-1 text-sm text-white/65">
          Reading activities assigned specifically to you by your
          teacher.
        </p>
      </div>

      {readingActivities.length === 0 ? (
        <div className="rounded-3xl bg-[#dce8e7] px-6 py-14 text-center shadow-md">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[#f7cf4a] text-3xl">
            📄
          </div>

          <h3 className="text-xl font-extrabold text-[#173f3b]">
            No reading activities assigned yet
          </h3>

          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#5c7471]">
            Your teacher has not assigned any individual reading
            activities to you in this learning room yet.
          </p>
        </div>
      ) : (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {readingActivities.map((activity, index) => {
            const { language, t } = getActivityText(activity.language);
            return (
            <article
              key={activity.assignment_id}
              lang={language}
              className="flex min-h-[270px] flex-col rounded-3xl bg-[#dce8e7] p-6 shadow-md transition duration-200 hover:-translate-y-1 hover:shadow-lg"
            >
              <div className="mb-5 flex items-start justify-between gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#f7cf4a] text-2xl">
                  📖
                </div>

                <span className="rounded-full bg-[#ef7468] px-3 py-1 text-xs font-bold capitalize text-white">
                  {t(progress.find(item => item.activityAssignmentId === activity.assignment_id)?.status ?? (progressError ? "Progress unavailable" : "Checking progress..."))}
                </span>
              </div>

              <div>
                <p className="mb-1 text-xs font-bold uppercase tracking-wide text-[#7b9290]">
                  {t("Reading Activity")} {index + 1}
                </p>

                <h3 className="text-xl font-extrabold leading-snug text-[#173f3b]">
                  {activity.title}
                </h3>

                <p className="mt-2 text-sm font-bold text-[#5c7471]">
                  {activity.has_questions ? t("Read aloud, then answer questions") : t("Read aloud")}
                </p>
              </div>

              <div className="mt-5 rounded-2xl bg-white/70 px-4 py-3">
                <p className="text-xs font-bold uppercase tracking-wide text-[#6d8582]">
                  {t("Assigned")}
                </p>

                <p className="mt-1 text-sm font-bold text-[#173f3b]">
                  {new Date(
                    activity.assigned_at
                  ).toLocaleDateString(language === "fil" ? "fil-PH" : undefined, {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })}
                </p>

                {activity.due_at && (
                  <>
                    <p className="mt-3 text-xs font-bold uppercase tracking-wide text-[#6d8582]">
                      {t("Due")}
                    </p>

                    <p className="mt-1 text-sm font-bold text-[#173f3b]">
                      {formatDueDateTime(activity.due_at, language === "fil" ? "fil-PH" : undefined)}
                    </p>
                  </>
                )}
              </div>

              <div className="mt-auto pt-5">
                <button
                  type="button"
                  disabled={Boolean(openingActivity)}
                  onClick={async () => {
                    setOpeningActivity(activity.assignment_id);
                    setOpeningError(undefined);
                    try {
                      const available = progressError ? await getAssignedReadingProgress(classroom.id) : progress;
                      const saved = available.find(item => item.activityAssignmentId === activity.assignment_id
                        && item.materialId === activity.material_id && item.roomId === classroom.id);
                      if (!saved) throw new Error("This reading activity is not assigned to you.");
                      const target = assignedReadingTarget(saved);
                      // Resolve on the card so navigation never opens an empty recorder.
                      const oralReadingModule = saved.oralReadingAttemptId || saved.comprehensionAttemptId ? undefined
                        : await getOralReadingModule(undefined, { materialId: saved.materialId,
                          roomId: saved.roomId, activityAssignmentId: saved.activityAssignmentId });
                      navigate(target, { state: { ...activityLanguageState(activity.language),
                        readingActivity: saved, oralReadingModule } });
                    } catch (error) {
                      setOpeningError({ id: activity.assignment_id, message: error instanceof Error ? error.message : "Unable to open activity." });
                    } finally {
                      setOpeningActivity(undefined);
                    }
                  }}
                  className="w-full rounded-xl bg-[#f7cf4a] px-4 py-3 text-sm font-extrabold text-[#173f3b] transition hover:bg-[#f2c83a]"
                >
                  {openingActivity === activity.assignment_id ? <span role="status">{t("Opening your reading activity...")}</span> : t("Open Reading Activity")}
                </button>
                {openingError?.id === activity.assignment_id && <p role="alert">{openingError.message}</p>}
              </div>
            </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
