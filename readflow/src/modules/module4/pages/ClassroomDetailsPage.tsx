import { confirmReadFlow, showReadFlowDialog } from "../../../components/ReadFlowDialog";
import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../../../lib/supabaseClient";
import {
  getClassroomById,
  getRoomEnrollments,
  removeEnrolledStudent,
  updateClassroom,
  getPublishedModules,
  getAssignedModules,
  assignModuleToRoom,
  getUploadedReadingMaterials,
  assignReadingActivity,
  getClassroomReadingActivities,
  getReadingActivityError,
  type ReadingActivityAssignment,
  type Classroom,
  type EnrolledStudent,
  type ReadingModule,
  type AssignedReadingModule,
  type UploadedReadingMaterial,
  type ReadingLanguage,
} from "../services/classroomService";
import { getMaterialQuestionSets, getMaterialServiceError } from "../../module3/services/materialService";
import type { MaterialQuestionSetSummary } from "../../module3/types/content";

const LANGUAGE_NAMES: Record<ReadingLanguage, string> = { en: "English", fil: "Filipino" };

// Rooms do not store a language, so the teacher chooses it here; only
// modules and materials in that language can then be assigned.
function RoomLanguageSelect({ id, value, disabled, onChange }: {
  id: string;
  value: ReadingLanguage | "";
  disabled?: boolean;
  onChange: (language: ReadingLanguage | "") => void;
}) {
  return (
    <div className="mb-4">
      <label htmlFor={id} className="mb-2 block text-sm font-bold text-[#173f3b]">
        Classroom Language
      </label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value as ReadingLanguage | "")}
        required
        className="w-full rounded-xl border-2 border-transparent bg-white px-4 py-3 text-sm text-[#173f3b] outline-none transition focus:border-[#f7cf4a]"
      >
        <option value="">Select the classroom language</option>
        <option value="en">English</option>
        <option value="fil">Filipino</option>
      </select>
    </div>
  );
}

function questionSetLabel(set: MaterialQuestionSetSummary) {
  return `${set.name} (${set.questionCount} questions: ${set.counts.literal} literal, ${set.counts.inferential} inferential, ${set.counts.critical} critical)`;
}

// Display sections. They only render props; all state and handlers stay in
// ClassroomDetailsPage. The activity list and form stay in the page because
// tests/m4ActivityFeedback.test.ts drives them there without rendering children.

type ClassroomInfoSectionProps = {
  classroom: Classroom;
  editing: boolean;
  saving: boolean;
  roomName: string;
  section: string;
  description: string;
  onRoomNameChange: (value: string) => void;
  onSectionChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSave: (event: React.FormEvent<HTMLFormElement>) => void;
};

function ClassroomInfoSection({
  classroom,
  editing,
  saving,
  roomName,
  section,
  description,
  onRoomNameChange,
  onSectionChange,
  onDescriptionChange,
  onStartEdit,
  onCancelEdit,
  onSave,
}: ClassroomInfoSectionProps) {
  return !editing ? (
    <div className="mb-6 rounded-3xl bg-[#dce8e7] p-6 shadow-lg md:p-7">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#f7cf4a] text-2xl">
              📖
            </div>

            {classroom.section && (
              <span className="rounded-full bg-[#ef7468] px-3 py-1 text-xs font-bold text-white">
                {classroom.section}
              </span>
            )}
          </div>

          <h1 className="text-3xl font-extrabold text-[#173f3b] md:text-4xl">
            {classroom.room_name}
          </h1>

          {classroom.description && (
            <p className="mt-3 max-w-2xl leading-7 text-[#5c7471]">
              {classroom.description}
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={onStartEdit}
          className="shrink-0 rounded-xl bg-[#f7cf4a] px-5 py-3 font-extrabold text-[#173f3b] shadow-sm transition hover:bg-[#f2c83a]"
        >
          ✎ Edit Learning Room
        </button>
      </div>

      {/* Room Code */}
      <div className="mt-6 max-w-sm rounded-2xl bg-white/75 px-5 py-4">
        <p className="text-xs font-bold uppercase tracking-wider text-[#6d8582]">
          Room Code
        </p>

        <p className="mt-1 text-2xl font-black tracking-[0.18em] text-[#173f3b]">
          {classroom.room_code}
        </p>

        <p className="mt-1 text-xs text-[#708784]">
          Share this code with students so they can join.
        </p>
      </div>
    </div>
  ) : (
    <form
      onSubmit={onSave}
      className="mb-6 rounded-3xl bg-[#dce8e7] p-6 shadow-lg md:p-7"
    >
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold text-[#173f3b]">
          Edit Learning Room
        </h1>

        <p className="mt-1 text-sm text-[#5c7471]">
          Update the classroom information below.
        </p>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <div>
          <label
            htmlFor="roomName"
            className="mb-2 block text-sm font-bold text-[#173f3b]"
          >
            Room Name
          </label>

          <input
            id="roomName"
            type="text"
            value={roomName}
            onChange={(event) =>
              onRoomNameChange(event.target.value)
            }
            required
            className="w-full rounded-xl border-2 border-transparent bg-white px-4 py-3 text-[#173f3b] outline-none transition focus:border-[#f7cf4a]"
          />
        </div>

        <div>
          <label
            htmlFor="section"
            className="mb-2 block text-sm font-bold text-[#173f3b]"
          >
            Section
          </label>

          <input
            id="section"
            type="text"
            value={section}
            onChange={(event) =>
              onSectionChange(event.target.value)
            }
            className="w-full rounded-xl border-2 border-transparent bg-white px-4 py-3 text-[#173f3b] outline-none transition focus:border-[#f7cf4a]"
          />
        </div>
      </div>

      <div className="mt-5">
        <label
          htmlFor="description"
          className="mb-2 block text-sm font-bold text-[#173f3b]"
        >
          Description
        </label>

        <textarea
          id="description"
          value={description}
          onChange={(event) =>
            onDescriptionChange(event.target.value)
          }
          rows={4}
          className="w-full resize-none rounded-xl border-2 border-transparent bg-white px-4 py-3 text-[#173f3b] outline-none transition focus:border-[#f7cf4a]"
        />
      </div>

      <div className="mt-5 rounded-2xl bg-white/70 px-4 py-3">
        <span className="text-xs font-bold uppercase tracking-wide text-[#6d8582]">
          Room Code
        </span>

        <span className="ml-3 font-black tracking-wider text-[#173f3b]">
          {classroom.room_code}
        </span>
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={saving}
          className="rounded-xl bg-[#f7cf4a] px-6 py-3 font-extrabold text-[#173f3b] transition hover:bg-[#f2c83a] disabled:opacity-60"
        >
          {saving ? "Saving..." : "Save Changes"}
        </button>

        <button
          type="button"
          onClick={onCancelEdit}
          disabled={saving}
          className="rounded-xl bg-[#ef7468] px-6 py-3 font-bold text-white transition hover:bg-[#df665c] disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

type EnrolledStudentsSectionProps = {
  students: EnrolledStudent[];
  onRemoveStudent: (enrollmentId: string, studentName: string) => void;
};

function EnrolledStudentsSection({
  students,
  onRemoveStudent,
}: EnrolledStudentsSectionProps) {
  return (
    <div className="rounded-3xl bg-[#dce8e7] p-6 shadow-md">
      <div className="mb-5">
        <h2 className="text-2xl font-extrabold text-[#173f3b]">
          Enrolled Students
        </h2>

        <p className="mt-1 text-sm text-[#5c7471]">
          Students currently enrolled in this learning room.
        </p>
      </div>

      {students.length === 0 ? (
        <div className="rounded-2xl bg-white/60 px-5 py-8 text-center">
          <div className="mb-2 text-3xl">👥</div>

          <p className="font-bold text-[#173f3b]">
            No enrolled students yet
          </p>

          <p className="mt-1 text-sm text-[#6d8582]">
            Share the room code with students to let them join.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {students.map((student) => (
            <div
              key={student.enrollment_id}
              className="flex flex-col gap-4 rounded-2xl bg-white/70 p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#f7cf4a] font-black text-[#173f3b]">
                  {student.display_name
                    .charAt(0)
                    .toUpperCase()}
                </div>

                <div>
                  <p className="font-extrabold text-[#173f3b]">
                    {student.display_name}
                  </p>

                  <p className="text-xs text-[#6d8582]">
                    Joined{" "}
                    {new Date(
                      student.enrolled_at
                    ).toLocaleDateString()}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() =>
                  onRemoveStudent(
                    student.enrollment_id,
                    student.display_name
                  )
                }
                className="rounded-xl bg-[#ef7468] px-4 py-2 text-sm font-bold text-white transition hover:bg-[#df665c]"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

type ModuleAssignmentSectionProps = {
  assignedModules: AssignedReadingModule[];
  unassignedModules: ReadingModule[];
  showModuleForm: boolean;
  selectedModuleId: string;
  assigningModule: boolean;
  moduleError: string;
  roomLanguage: ReadingLanguage | "";
  onToggleForm: () => void;
  onSelectModule: (moduleId: string) => void;
  onRoomLanguageChange: (language: ReadingLanguage | "") => void;
  onAssignModule: (event: React.FormEvent<HTMLFormElement>) => void;
};

function ModuleAssignmentSection({
  assignedModules,
  unassignedModules,
  showModuleForm,
  selectedModuleId,
  assigningModule,
  moduleError,
  roomLanguage,
  onToggleForm,
  onSelectModule,
  onRoomLanguageChange,
  onAssignModule,
}: ModuleAssignmentSectionProps) {
  return (
    <div className="rounded-3xl bg-[#dce8e7] p-6 shadow-md">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-extrabold text-[#173f3b]">
            Assigned Reading Modules
          </h2>

          <p className="mt-1 text-sm text-[#5c7471]">
            Reading content assigned to this classroom.
          </p>
        </div>

        <button
          type="button"
          disabled={assigningModule}
          onClick={onToggleForm}
          className={`shrink-0 rounded-xl px-4 py-2.5 text-sm font-extrabold transition ${
            showModuleForm
              ? "bg-[#ef7468] text-white hover:bg-[#df665c]"
              : "bg-[#f7cf4a] text-[#173f3b] hover:bg-[#f2c83a]"
          }`}
        >
          {showModuleForm
            ? "Cancel"
            : "Assign Module"}
        </button>
      </div>

      {/* Assign Module */}
      {showModuleForm && (
        <form
          onSubmit={onAssignModule}
          className="mb-5 rounded-2xl bg-white/70 p-4"
        >
          <RoomLanguageSelect
            id="moduleLanguage"
            value={roomLanguage}
            disabled={assigningModule}
            onChange={onRoomLanguageChange}
          />

          <label
            htmlFor="readingModule"
            className="mb-2 block text-sm font-bold text-[#173f3b]"
          >
            Reading Module
          </label>

          <select
            id="readingModule"
            disabled={assigningModule || !roomLanguage}
            value={selectedModuleId}
            onChange={(event) =>
              onSelectModule(event.target.value)
            }
            required
            className="w-full rounded-xl border-2 border-transparent bg-white px-4 py-3 text-sm text-[#173f3b] outline-none transition focus:border-[#f7cf4a]"
          >
            <option value="">
              Select a reading module
            </option>

            {unassignedModules.map((module) => (
              <option
                key={module.id}
                value={module.id}
              >
                {module.title}
                {module.difficulty
                  ? ` - ${module.difficulty}`
                  : ""}
              </option>
            ))}
          </select>

          <p role="alert" className="mt-3 text-sm font-bold text-[#a9443c]">{moduleError}</p>
          {!roomLanguage ? (
            <p className="mt-3 text-sm text-[#6d8582]">
              Select the classroom language to see matching modules.
            </p>
          ) : unassignedModules.length === 0 ? (
            <p className="mt-3 text-sm text-[#6d8582]">
              No additional published {LANGUAGE_NAMES[roomLanguage]} modules available.
            </p>
          ) : (
            <button
              type="submit"
              disabled={assigningModule}
              className="mt-4 w-full rounded-xl bg-[#f7cf4a] px-5 py-3 font-extrabold text-[#173f3b] transition hover:bg-[#f2c83a] disabled:opacity-60"
            >
              {assigningModule
                ? "Assigning..."
                : "Assign Module"}
            </button>
          )}
        </form>
      )}

      {/* Assigned Modules */}
      {assignedModules.length === 0 ? (
        <div className="rounded-2xl bg-white/60 px-5 py-8 text-center">
          <div className="mb-2 text-3xl">📚</div>

          <p className="font-bold text-[#173f3b]">
            No reading modules assigned yet
          </p>

          <p className="mt-1 text-sm text-[#6d8582]">
            Assign a published reading module to get started.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {assignedModules.map((module) => (
            <div
              key={module.assignment_id}
              className="rounded-2xl bg-white/70 p-4"
            >
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#f7cf4a] text-lg">
                  📖
                </div>

                <div className="min-w-0">
                  <p className="font-extrabold text-[#173f3b]">
                    {module.title}
                  </p>

                  <div className="mt-2 flex flex-wrap gap-2">
                    {module.difficulty && (
                      <span className="rounded-full bg-[#ef7468] px-3 py-1 text-xs font-bold text-white">
                        {module.difficulty}
                      </span>
                    )}

                    <span className="rounded-full bg-[#173f3b]/10 px-3 py-1 text-xs font-semibold text-[#173f3b]">
                      Assigned{" "}
                      {new Date(
                        module.assigned_at
                      ).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ClassroomDetailsPage() {
  const { roomId } = useParams<{ roomId: string }>();

  const [classroom, setClassroom] = useState<Classroom | null>(null);
  const [students, setStudents] = useState<EnrolledStudent[]>([]);
  const [publishedModules, setPublishedModules] = useState<ReadingModule[]>([]);
  const [assignedModules, setAssignedModules] = useState<
    AssignedReadingModule[]
  >([]);
  const [uploadedMaterials, setUploadedMaterials] = useState<
    UploadedReadingMaterial[]
  >([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRoom = useRef(false);
  const removingStudent = useRef(false);

  const [roomName, setRoomName] = useState("");
  const [section, setSection] = useState("");
  const [description, setDescription] = useState("");

  // Reading module assignment
  // Shared by Assign Module and Assign Reading Activity; never saved to the room.
  const [roomLanguage, setRoomLanguage] = useState<ReadingLanguage | "">("");
  const [showModuleForm, setShowModuleForm] = useState(false);
  const [selectedModuleId, setSelectedModuleId] = useState("");
  const [assigningModule, setAssigningModule] = useState(false);

  // Reading activity assignment
  const [showActivityForm, setShowActivityForm] = useState(false);
  const [selectedMaterialId, setSelectedMaterialId] = useState("");
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  const [assigningActivity, setAssigningActivity] = useState(false);
  // Only reviewed sets of the selected material can be assigned.
  const [questionSets, setQuestionSets] = useState<MaterialQuestionSetSummary[]>([]);
  const [selectedQuestionSetId, setSelectedQuestionSetId] = useState("");
  const [loadingQuestionSets, setLoadingQuestionSets] = useState(false);
  const [questionSetError, setQuestionSetError] = useState("");

  const [questionSetRefresh, setQuestionSetRefresh] = useState(0);
  useEffect(() => {
    const refresh = () => setQuestionSetRefresh(value => value + 1);
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);

  useEffect(() => {
    setQuestionSets([]);
    setSelectedQuestionSetId("");
    setQuestionSetError("");
    if (!selectedMaterialId) {
      setLoadingQuestionSets(false);
      return;
    }
    let active = true;
    setLoadingQuestionSets(true);
    getMaterialQuestionSets(selectedMaterialId)
      .then(sets => {
        if (!active) return;
        const reviewed = sets.filter(set => set.reviewStatus === "reviewed");
        setQuestionSets(reviewed);
        if (reviewed.length === 1) setSelectedQuestionSetId(reviewed[0].id);
      })
      .catch(err => {
        if (active) setQuestionSetError(getMaterialServiceError(err, "Unable to load question sets for this material."));
      })
      .finally(() => {
        if (active) setLoadingQuestionSets(false);
      });
    return () => { active = false; };
  }, [selectedMaterialId, showActivityForm, questionSetRefresh]);

  const [activities, setActivities] = useState<ReadingActivityAssignment[]>([]);
  const [activityListError, setActivityListError] = useState("");
  const activityRequestPending = useRef(false);

  async function refreshActivities(id: string) {
    try {
      setActivities(await getClassroomReadingActivities(id));
      setActivityListError("");
    } catch (err) {
      console.error("Failed to load classroom activities:", err);
      setActivityListError("Unable to refresh assigned activities. Reload the list before assigning again to check what is already saved.");
    }
  }
  const moduleRequestPending = useRef(false);
  const [activityError, setActivityError] = useState("");
  const [moduleError, setModuleError] = useState("");
  const [activitySuccess, setActivitySuccess] = useState("");

  useEffect(() => {
    if (!activitySuccess) return;
    const timer = window.setTimeout(() => setActivitySuccess(""), 4000);
    return () => window.clearTimeout(timer);
  }, [activitySuccess]);

  useEffect(() => {
    setActivitySuccess("");
    setActivityError("");
    setModuleError("");
    setActivities([]);
    if (roomId) void refreshActivities(roomId);
  }, [roomId]);

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

        const [
          room,
          enrolledStudents,
          availableModules,
          roomModules,
          availableMaterials,
        ] = await Promise.all([
          getClassroomById(roomId),
          getRoomEnrollments(roomId),
          getPublishedModules(),
          getAssignedModules(roomId),
          getUploadedReadingMaterials(),
        ]);

        setClassroom(room);
        setStudents(enrolledStudents);
        setPublishedModules(availableModules);
        setAssignedModules(roomModules);
        setUploadedMaterials(availableMaterials);

        setRoomName(room.room_name);
        setSection(room.section ?? "");
        setDescription(room.description ?? "");
      } catch (err) {
        console.error("Failed to load classroom:", err);
        setError("Unable to load classroom.");
      } finally {
        setLoading(false);
      }
    }

    void loadClassroom();
  }, [roomId]);

  async function handleRemoveStudent(
    enrollmentId: string,
    studentName: string
  ) {
    if (removingStudent.current) return;
    removingStudent.current = true;
    const confirmed = await confirmReadFlow(
      `Remove ${studentName} from this classroom?`
    );

    if (!confirmed) {
      removingStudent.current = false;
      return;
    }

    try {
      await removeEnrolledStudent(enrollmentId);

      setStudents((currentStudents) =>
        currentStudents.filter(
          (student) => student.enrollment_id !== enrollmentId
        )
      );

      setSelectedStudentIds((currentIds) =>
        currentIds.filter((studentId) =>
          students.some(
            (student) =>
              student.student_id === studentId &&
              student.enrollment_id !== enrollmentId
          )
        )
      );
    } catch (err) {
      console.error("Failed to remove student:", err);
      await showReadFlowDialog(err && typeof err === "object" && "message" in err ? String(err.message) : "Unable to remove student.");
    } finally {
      removingStudent.current = false;
    }
  }

  function handleStartEdit() {
    if (!classroom) return;

    setRoomName(classroom.room_name);
    setSection(classroom.section ?? "");
    setDescription(classroom.description ?? "");
    setEditing(true);
  }

  function handleCancelEdit() {
    if (!classroom) return;

    setRoomName(classroom.room_name);
    setSection(classroom.section ?? "");
    setDescription(classroom.description ?? "");
    setEditing(false);
  }

  async function handleSaveClassroom(
    event: React.FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    if (!roomId || !classroom || savingRoom.current) {
      return;
    }

    if (!roomName.trim()) {
      await showReadFlowDialog("Room name is required.");
      return;
    }

    try {
      savingRoom.current = true;
      setSaving(true);

      const updatedRoom = await updateClassroom(roomId, {
        roomName,
        section,
        description,
      });

      setClassroom(updatedRoom);
      setEditing(false);
    } catch (err) {
      console.error("Failed to update classroom:", err);
      await showReadFlowDialog(err && typeof err === "object" && "message" in err ? String(err.message) : "Unable to update classroom.");
    } finally {
      savingRoom.current = false;
      setSaving(false);
    }
  }

  async function handleAssignModule(
    event: React.FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    if (!roomId || moduleRequestPending.current) {
      return;
    }

    setModuleError("");

    if (!selectedModuleId) {
      setModuleError("Please select a reading module.");
      return;
    }

    const moduleLanguage = publishedModules.find((module) => module.id === selectedModuleId)?.language;
    if (!roomLanguage || moduleLanguage !== roomLanguage) {
      setModuleError("Please select a reading module in the classroom language.");
      return;
    }

    const alreadyAssigned = assignedModules.some(
      (module) => module.module_id === selectedModuleId
    );

    if (alreadyAssigned) {
      setModuleError("This reading module is already assigned.");
      return;
    }

    try {
      moduleRequestPending.current = true;
      setAssigningModule(true);

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

      await assignModuleToRoom(roomId, selectedModuleId, user.id);

      const updatedAssignments = await getAssignedModules(roomId);

      setAssignedModules(updatedAssignments);
      setSelectedModuleId("");
      setShowModuleForm(false);
    } catch (err) {
      console.error("Failed to assign reading module:", err);
      setModuleError("Unable to assign reading module.");
    } finally {
      moduleRequestPending.current = false;
      setAssigningModule(false);
    }
  }

  function handleStudentSelection(studentId: string) {
    setSelectedStudentIds((currentIds) => {
      if (currentIds.includes(studentId)) {
        return currentIds.filter((id) => id !== studentId);
      }

      return [...currentIds, studentId];
    });
  }

  function handleSelectWholeClass() {
    if (selectedStudentIds.length === students.length) {
      setSelectedStudentIds([]);
      return;
    }

    setSelectedStudentIds(
      students.map((student) => student.student_id)
    );
  }

  function handleToggleActivityForm() {
    if (activityRequestPending.current) return;
    setActivityError("");
    setShowActivityForm((current) => {
      const nextValue = !current;

      if (!nextValue) {
        setSelectedMaterialId("");
        setSelectedStudentIds([]);
      }

      return nextValue;
    });
  }

  async function handleAssignActivity(
    event: React.FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    if (!roomId || activityRequestPending.current || loadingQuestionSets) {
      return;
    }

    setActivityError("");
    setActivitySuccess("");

    if (!selectedMaterialId) {
      setActivityError("Please select a reading material.");
      return;
    }

    const materialLanguage = uploadedMaterials.find((material) => material.id === selectedMaterialId)?.language;
    if (!roomLanguage || materialLanguage !== roomLanguage) {
      setActivityError("Please select a reading material in the classroom language.");
      return;
    }

    if (selectedStudentIds.length === 0) {
      setActivityError("Please select at least one student.");
      return;
    }

    try {
      activityRequestPending.current = true;
      setAssigningActivity(true);

      await assignReadingActivity(
        roomId,
        selectedMaterialId,
        selectedStudentIds,
        null,
        selectedQuestionSetId || null
      );

      setActivitySuccess("Reading activity assigned successfully!");

      setSelectedMaterialId("");
      setSelectedStudentIds([]);
      setShowActivityForm(false);
      await refreshActivities(roomId);
    } catch (err) {
      console.error("Failed to assign reading activity:", err);

      setActivityError(getReadingActivityError(err));
    } finally {
      activityRequestPending.current = false;
      setAssigningActivity(false);
    }
  }

  if (loading) {
    return (
      <section className="min-h-full p-5 md:p-8">
        <div className="rounded-3xl bg-[#dce8e7] p-8 shadow-sm">
          <h1 className="text-2xl font-extrabold text-[#173f3b]">
            Classroom
          </h1>

          <p className="mt-2 text-[#5c7471]">
            Loading classroom...
          </p>
        </div>
      </section>
    );
  }

  if (error || !classroom) {
    return (
      <section className="min-h-full p-5 md:p-8">
        <div className="rounded-3xl bg-[#dce8e7] p-8 shadow-sm">
          <h1 className="text-2xl font-extrabold text-[#173f3b]">
            Classroom
          </h1>

          <p className="mt-2 text-[#a9443c]">
            {error || "Classroom not found."}
          </p>

          <Link
            to="/m3/teacher/learning-rooms"
            className="mt-5 inline-block rounded-xl bg-[#f7cf4a] px-5 py-3 font-bold text-[#173f3b]"
          >
            ← Back to Learning Rooms
          </Link>
        </div>
      </section>
    );
  }

  const unassignedModules = publishedModules.filter(
    (module) =>
      module.language === roomLanguage &&
      !assignedModules.some(
        (assigned) => assigned.module_id === module.id
      )
  );
  const matchingMaterials = uploadedMaterials.filter(
    (material) => material.language === roomLanguage
  );

  // A selection in the other language is cleared; saved assignments are untouched.
  function handleRoomLanguageChange(language: ReadingLanguage | "") {
    setRoomLanguage(language);
    setModuleError("");
    setActivityError("");
    if (publishedModules.find((module) => module.id === selectedModuleId)?.language !== language) {
      setSelectedModuleId("");
    }
    if (uploadedMaterials.find((material) => material.id === selectedMaterialId)?.language !== language) {
      setSelectedMaterialId("");
    }
  }

  const wholeClassSelected =
    students.length > 0 &&
    selectedStudentIds.length === students.length;

  return (
    <section className="min-h-full p-5 md:p-8">
      <div role="status" aria-live="polite" aria-atomic="true"
        className="pointer-events-none fixed inset-x-4 top-4 z-50 flex justify-center">
        {activitySuccess && (
          <div className="flex max-w-sm items-center gap-3 rounded-2xl border border-[#86b99a] bg-[#e5f5e9] px-5 py-3 text-sm font-bold text-[#173f3b] shadow-lg">
            {activitySuccess}
          </div>
        )}
      </div>
      {/* Back */}
      <Link
        to="/m3/teacher/learning-rooms"
        className="mb-5 inline-flex items-center gap-2 text-sm font-bold text-white/80 transition hover:text-white"
      >
        ← Back to Learning Rooms
      </Link>

      {/* Classroom Information */}
      <ClassroomInfoSection
        classroom={classroom}
        editing={editing}
        saving={saving}
        roomName={roomName}
        section={section}
        description={description}
        onRoomNameChange={setRoomName}
        onSectionChange={setSection}
        onDescriptionChange={setDescription}
        onStartEdit={handleStartEdit}
        onCancelEdit={handleCancelEdit}
        onSave={handleSaveClassroom}
      />

      {/* Overview */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl bg-[#f7cf4a] p-5 shadow-sm">
          <p className="text-sm font-bold text-[#173f3b]/70">
            Enrolled Students
          </p>

          <p className="mt-1 text-3xl font-black text-[#173f3b]">
            {students.length}
          </p>
        </div>

        <div className="rounded-2xl bg-[#ef7468] p-5 shadow-sm">
          <p className="text-sm font-bold text-white/80">
            Assigned Reading Modules
          </p>

          <p className="mt-1 text-3xl font-black text-white">
            {assignedModules.length}
          </p>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        {/* Students */}
        <EnrolledStudentsSection
          students={students}
          onRemoveStudent={handleRemoveStudent}
        />

        {/* Reading Modules */}
        <ModuleAssignmentSection
          assignedModules={assignedModules}
          unassignedModules={unassignedModules}
          showModuleForm={showModuleForm}
          selectedModuleId={selectedModuleId}
          assigningModule={assigningModule}
          moduleError={moduleError}
          roomLanguage={roomLanguage}
          onRoomLanguageChange={handleRoomLanguageChange}
          onToggleForm={() => {
            setModuleError("");
            setShowModuleForm((current) => !current);
          }}
          onSelectModule={setSelectedModuleId}
          onAssignModule={handleAssignModule}
        />
      </div>

      {/* Reading Activities */}
      <div className="mt-6 rounded-3xl bg-[#dce8e7] p-6 shadow-md">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-2xl font-extrabold text-[#173f3b]">
              Reading Activities
            </h2>

            <p className="mt-1 text-sm text-[#5c7471]">
              Assign uploaded reading materials to the whole class
              or selected students.
            </p>
          </div>

          <button
            type="button"
            onClick={handleToggleActivityForm}
            disabled={assigningActivity}
            className={`shrink-0 rounded-xl px-4 py-2.5 text-sm font-extrabold transition ${
              showActivityForm
                ? "bg-[#ef7468] text-white hover:bg-[#df665c]"
                : "bg-[#f7cf4a] text-[#173f3b] hover:bg-[#f2c83a]"
            }`}
          >
            {showActivityForm
              ? "Cancel"
              : "Assign Activity"}
          </button>
        </div>

        <div className="mt-5" aria-label="Assigned reading activities">
          <h3 className="font-extrabold text-[#173f3b]">Assigned Reading Activities</h3>
          {activityListError && (
            <div role="alert" className="mt-3 text-sm text-[#a9443c]">
              <p>{activityListError}</p>
              <button type="button" onClick={() => roomId && void refreshActivities(roomId)}
                className="mt-2 rounded-xl bg-white px-4 py-2 font-bold text-[#173f3b]">Reload activity list</button>
            </div>
          )}
          {activities.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {activities.map(activity => (
                <li key={activity.id} className="rounded-xl bg-white/70 px-4 py-3 text-[#173f3b]">
                  <p className="font-bold">{uploadedMaterials.find(material => material.id === activity.material_id)?.title ?? "Reading Activity"}</p>
                  <p className="text-sm">{activity.question_set_id ? activity.question_set_name ?? "Question set" : "Read-aloud only"}</p>
                  <p className="text-sm">{students.find(student => student.student_id === activity.student_id)?.display_name ?? "Previously enrolled student"} · {activity.status.replace("_", " ")}</p>
                </li>
              ))}
            </ul>
          ) : !activityListError && <p className="mt-2 text-sm text-[#5c7471]">No reading activities assigned yet.</p>}
        </div>

        {!showActivityForm && (
          <div className="mt-5 rounded-2xl bg-white/60 px-5 py-7 text-center">
            <div className="mb-2 text-3xl">📄</div>

            <p className="font-bold text-[#173f3b]">
              Assign a reading activity
            </p>

            <p className="mt-1 text-sm text-[#6d8582]">
              Use a completed reading material uploaded through
              Reading Materials.
            </p>
          </div>
        )}

        {showActivityForm && (
          <form
            onSubmit={handleAssignActivity}
            className="mt-5 rounded-2xl bg-white/70 p-5"
          >
            <fieldset disabled={assigningActivity} aria-busy={assigningActivity} className="min-w-0">
            <RoomLanguageSelect
              id="activityLanguage"
              value={roomLanguage}
              onChange={handleRoomLanguageChange}
            />

            {/* Reading Material */}
            <div>
              <label
                htmlFor="readingMaterial"
                className="mb-2 block text-sm font-bold text-[#173f3b]"
              >
                Reading Material
              </label>

              <select
                id="readingMaterial"
                value={selectedMaterialId}
                onChange={(event) =>
                  setSelectedMaterialId(event.target.value)
                }
                disabled={matchingMaterials.length === 0}
                required
                className="w-full rounded-xl border-2 border-transparent bg-white px-4 py-3 text-sm text-[#173f3b] outline-none transition focus:border-[#f7cf4a] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <option value="">
                  Select an uploaded reading material
                </option>

                {matchingMaterials.map((material) => (
                  <option
                    key={material.id}
                    value={material.id}
                  >
                    {material.title}
                  </option>
                ))}
              </select>

              {uploadedMaterials.length === 0 ? (
                <p className="mt-2 text-sm text-[#a9443c]">
                  No completed uploaded materials are available.
                  Upload and process a reading material first.
                </p>
              ) : !roomLanguage ? (
                <p className="mt-2 text-sm text-[#6d8582]">
                  Select the classroom language to see matching materials.
                </p>
              ) : matchingMaterials.length === 0 && (
                <p className="mt-2 text-sm text-[#a9443c]">
                  No completed {LANGUAGE_NAMES[roomLanguage]} reading materials are available.
                </p>
              )}
            </div>

            {/* Question Set */}
            {selectedMaterialId && (
              <div className="mt-6">
                <label
                  htmlFor="questionSet"
                  className="mb-2 block text-sm font-bold text-[#173f3b]"
                >
                  Question set
                </label>

                <select
                  id="questionSet"
                  value={selectedQuestionSetId}
                  onChange={(event) =>
                    setSelectedQuestionSetId(event.target.value)
                  }
                  disabled={loadingQuestionSets}
                  aria-busy={loadingQuestionSets}
                  className="w-full rounded-xl border-2 border-transparent bg-white px-4 py-2.5 text-sm font-extrabold text-[#173f3b] outline-none transition focus:border-[#f7cf4a] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <option value="">No questions (read-aloud only)</option>
                  {questionSets.map((set) => (
                    <option key={set.id} value={set.id}>
                      {questionSetLabel(set)}
                    </option>
                  ))}
                </select>

                {loadingQuestionSets && (
                  <p role="status" className="mt-2 text-sm text-[#5c7471]">
                    Loading question sets...
                  </p>
                )}
                {questionSetError && (
                  <p role="alert" className="mt-2 text-sm text-[#a9443c]">
                    {questionSetError}
                  </p>
                )}
                {!loadingQuestionSets && !questionSetError && questionSets.length === 0 && (
                  <p className="mt-2 text-sm text-[#5c7471]">
                    <Link
                      className="font-bold underline"
                      to={`/m3/teacher/materials/${selectedMaterialId}`}
                    >
                      Review a question set first so it can be assigned.
                    </Link>
                  </p>
                )}
              </div>
            )}

            {/* Students */}
            <div className="mt-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-bold text-[#173f3b]">
                    Assign To
                  </p>

                  <p className="mt-1 text-xs text-[#6d8582]">
                    Choose the whole class or individual students.
                  </p>
                </div>

                {students.length > 0 && (
                  <button
                    type="button"
                    onClick={handleSelectWholeClass}
                    className={`rounded-xl px-4 py-2 text-sm font-bold transition ${
                      wholeClassSelected
                        ? "bg-[#173f3b] text-white"
                        : "bg-[#f7cf4a] text-[#173f3b] hover:bg-[#f2c83a]"
                    }`}
                  >
                    {wholeClassSelected
                      ? "Whole Class Selected"
                      : "Select Whole Class"}
                  </button>
                )}
              </div>

              {students.length === 0 ? (
                <div className="mt-4 rounded-xl bg-white px-4 py-5 text-center">
                  <p className="font-bold text-[#173f3b]">
                    No students available
                  </p>

                  <p className="mt-1 text-sm text-[#6d8582]">
                    Students must join this learning room before
                    activities can be assigned.
                  </p>
                </div>
              ) : (
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  {students.map((student) => {
                    const selected = selectedStudentIds.includes(
                      student.student_id
                    );

                    return (
                      <label
                        key={student.enrollment_id}
                        className={`flex cursor-pointer items-center gap-3 rounded-xl border-2 p-4 transition ${
                          selected
                            ? "border-[#f7cf4a] bg-[#fff8d8]"
                            : "border-transparent bg-white hover:border-[#f7cf4a]/60"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() =>
                            handleStudentSelection(
                              student.student_id
                            )
                          }
                          className="h-4 w-4 accent-[#173f3b]"
                        />

                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#f7cf4a] text-sm font-black text-[#173f3b]">
                          {student.full_name
                            .charAt(0)
                            .toUpperCase()}
                        </div>

                        <div className="min-w-0">
                          <p className="truncate font-bold text-[#173f3b]">
                            {student.full_name}
                          </p>

                          <p className="text-xs text-[#6d8582]">
                            Enrolled student
                          </p>
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="mt-6 rounded-xl bg-[#173f3b]/5 px-4 py-3">
              <p className="text-sm font-semibold text-[#173f3b]">
                {selectedStudentIds.length === 0
                  ? "No students selected."
                  : `${selectedStudentIds.length} ${
                      selectedStudentIds.length === 1
                        ? "student"
                        : "students"
                    } selected.`}
              </p>
            </div>

            <p role="alert" className="mt-3 text-sm font-bold text-[#a9443c]">{activityError}</p>
            <button
              type="submit"
              disabled={
                assigningActivity ||
                loadingQuestionSets ||
                matchingMaterials.length === 0 ||
                students.length === 0 ||
                !selectedMaterialId ||
                selectedStudentIds.length === 0
              }
              className="mt-5 w-full rounded-xl bg-[#f7cf4a] px-4 py-2.5 text-sm font-extrabold text-[#173f3b] transition hover:bg-[#f2c83a] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {assigningActivity
                ? "Assigning Activity..."
                : "Assign Reading Activity"}
            </button>
            </fieldset>
          </form>
        )}
      </div>
    </section>
  );
}
