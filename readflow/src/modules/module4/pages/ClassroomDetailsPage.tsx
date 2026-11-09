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
  parseOptionalDueDate,
  formatDueDateTime,
  dueDateIssue,
  supportsOptionalColumn,
  setReadingActivityRemoved,
  setRoomModuleRemoved,
  getClassroomReadingActivities,
  getReadingActivityError,
  getLegacyRoomSubjectOptions,
  setLegacyRoomSubject,
  getModuleTargetingEnabled,
  assignModuleToSelectedStudents,
  supportsRoomArchive,
  isRoomArchived,
  setClassroomArchived,
  type ModuleTargeting,
  type LegacyRoomSubjectOptions,
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
import DueDateTimeInput from "../components/DueDateTimeInput";
import EnrolledStudentsPanel, { EnrolledStudentsButton } from "../components/EnrolledStudentsPanel";
import LegacyRoomSubjectPanel from "../components/LegacyRoomSubjectPanel";
import RoomActionsMenu from "../components/RoomActionsMenu";

const LANGUAGE_NAMES: Record<ReadingLanguage, string> = { en: "English", fil: "Filipino" };

// A room created with a subject shows it read-only and always filters by it; the
// database still checks every assignment against the saved subject. Only older
// rooms without a saved subject (subject IS NULL) keep the language picker.
function RoomLanguageSelect({ id, subject, value, disabled, onChange }: {
  id: string;
  subject: ReadingLanguage | null | undefined;
  value: ReadingLanguage | "";
  disabled?: boolean;
  onChange: (language: ReadingLanguage | "") => void;
}) {
  if (subject) {
    return (
      <div className="mb-4">
        <p id={`${id}Label`} className="mb-2 block text-sm font-bold text-[#173f3b]">
          Classroom Subject
        </p>
        <p
          id={id}
          data-subject={subject}
          aria-labelledby={`${id}Label`}
          aria-describedby={`${id}Help`}
          className="w-full rounded-xl bg-white/80 px-4 py-3 text-sm font-extrabold text-[#173f3b]"
        >
          {LANGUAGE_NAMES[subject]}
        </p>
        <p id={`${id}Help`} className="mt-1 text-xs text-[#6d8582]">
          Set when this learning room was created. Only {LANGUAGE_NAMES[subject]} content can be assigned here.
        </p>
      </div>
    );
  }
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
      <p className="mt-1 text-xs text-[#6d8582]">
        This older learning room has no saved subject. Choose the language of the content you are assigning.
      </p>
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
  archiveBusy: boolean;
  archiveError: string;
  onToggleArchive: () => void;
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
  archiveBusy,
  archiveError,
  onToggleArchive,
  onCancelEdit,
  onSave,
}: ClassroomInfoSectionProps) {
  return !editing ? (
    <div className="mb-6 rounded-3xl bg-[#dce8e7] p-6 shadow-lg md:p-7">
      <div className="flex items-start justify-between gap-5">
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
            {isRoomArchived(classroom) && (
              <span className="rounded-full bg-[#5c7471]/15 px-3 py-1 text-xs font-bold text-[#173f3b]">
                This learning room is archived
              </span>
            )}
          </div>

          <h1 className="text-3xl font-extrabold text-[#173f3b] md:text-4xl">
            {classroom.room_name}
          </h1>

          {classroom.description?.trim() && classroom.description.trim().toLowerCase() !== "none" && (
            <p className="mt-3 max-w-2xl leading-7 text-[#5c7471]">
              {classroom.description}
            </p>
          )}
        </div>

        <RoomActionsMenu
          onEdit={onStartEdit}
          archiveSupported={supportsRoomArchive(classroom)}
          archived={isRoomArchived(classroom)}
          archiveBusy={archiveBusy}
          onToggleArchive={onToggleArchive}
        />
      </div>
      {archiveError && <p role="alert" className="mt-3 text-sm font-bold text-[#b42318]">{archiveError}</p>}

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

type ModuleAssignmentSectionProps = {
  assignedModules: AssignedReadingModule[];
  unassignedModules: ReadingModule[];
  showModuleForm: boolean;
  selectedModuleId: string;
  assigningModule: boolean;
  moduleError: string;
  subjectLocked: boolean;
  /** The room's saved subject; null for older rooms without one. */
  subject: ReadingLanguage | null;
  roomLanguage: ReadingLanguage | "";
  /** Shown only once the optional room_modules.due_at migration is applied. */
  deadlinesSupported: boolean;
  moduleDueAt: string;
  /** Remove/Restore buttons appear only once the optional unassign migration is applied. */
  removalSupported: boolean;
  changingModuleId: string;
  /** Whole Class / Selected Students appears only when the database reports targeting is enabled. */
  targetingEnabled: boolean;
  /** Archived rooms accept no new assignments (proposed m4_room_archive). */
  archived: boolean;
  students: EnrolledStudent[];
  moduleTargeting: ModuleTargeting;
  moduleStudentIds: string[];
  onModuleTargetingChange: (targeting: ModuleTargeting) => void;
  onToggleModuleStudent: (studentId: string) => void;
  onToggleForm: () => void;
  onSelectModule: (moduleId: string) => void;
  onModuleDueAtChange: (value: string) => void;
  onRoomLanguageChange: (language: ReadingLanguage | "") => void;
  onAssignModule: (event: React.FormEvent<HTMLFormElement>) => void;
  onToggleModuleRemoved: (module: AssignedReadingModule) => void;
};

function ModuleAssignmentSection({
  assignedModules,
  unassignedModules,
  showModuleForm,
  selectedModuleId,
  assigningModule,
  moduleError,
  roomLanguage,
  subjectLocked,
  subject,
  deadlinesSupported,
  moduleDueAt,
  removalSupported,
  changingModuleId,
  targetingEnabled,
  archived,
  students,
  moduleTargeting,
  moduleStudentIds,
  onModuleTargetingChange,
  onToggleModuleStudent,
  onToggleForm,
  onSelectModule,
  onModuleDueAtChange,
  onRoomLanguageChange,
  onAssignModule,
  onToggleModuleRemoved,
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
          disabled={assigningModule || (archived && !showModuleForm)}
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
            subject={subject}
            value={roomLanguage}
            disabled={assigningModule || subjectLocked}
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

          {deadlinesSupported && (
            <div className="mt-4">
              <p
                id="moduleDueAtLabel"
                className="mb-2 block text-sm font-bold text-[#173f3b]"
              >
                Due date and time (optional)
              </p>
              <DueDateTimeInput
                id="moduleDueAt"
                labelId="moduleDueAtLabel"
                value={moduleDueAt}
                disabled={assigningModule}
                onValueChange={onModuleDueAtChange}
                invalid={Boolean(dueDateIssue(moduleDueAt))}
                describedBy="moduleDueAtHelp moduleDueAtIssue"
              />
              <p id="moduleDueAtHelp" className="mt-1 text-xs text-[#6d8582]">
                Philippine time. Leave empty for no deadline. Students see the due date, and they can still finish after it.
              </p>
              <p id="moduleDueAtIssue" className="mt-1 text-xs font-bold text-[#a9443c]">{dueDateIssue(moduleDueAt)}</p>
            </div>
          )}

          {targetingEnabled && (
            <fieldset className="mt-4">
              <legend className="mb-2 block text-sm font-bold text-[#173f3b]">Assign to</legend>
              <div className="flex flex-wrap gap-3">
                {(["whole_class", "selected_students"] as const).map((option) => (
                  <label key={option} className="flex cursor-pointer items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-bold text-[#173f3b]">
                    <input
                      type="radio"
                      name="moduleTargeting"
                      value={option}
                      checked={moduleTargeting === option}
                      disabled={assigningModule}
                      onChange={() => onModuleTargetingChange(option)}
                      className="accent-[#173f3b]"
                    />
                    {option === "whole_class" ? "Whole Class" : "Selected Students"}
                  </label>
                ))}
              </div>
              <p className="mt-1 text-xs text-[#6d8582]">
                {moduleTargeting === "whole_class"
                  ? "Every enrolled student, including students who join later."
                  : "Only the students you check. Students who join later are not included."}
              </p>
              {moduleTargeting === "selected_students" && (
                students.length === 0 ? (
                  <p className="mt-3 text-sm text-[#6d8582]">Students must join this learning room before they can be selected.</p>
                ) : (
                  <div id="moduleStudents" className="mt-3 grid gap-2 md:grid-cols-2">
                    {students.map((student) => (
                      <label key={student.enrollment_id} className="flex min-w-0 cursor-pointer items-center gap-3 rounded-xl bg-white p-3">
                        <input
                          type="checkbox"
                          checked={moduleStudentIds.includes(student.student_id)}
                          disabled={assigningModule}
                          onChange={() => onToggleModuleStudent(student.student_id)}
                          className="h-4 w-4 accent-[#173f3b]"
                        />
                        <span className="truncate text-sm font-bold text-[#173f3b]">{student.full_name}</span>
                      </label>
                    ))}
                  </div>
                )
              )}
              {moduleTargeting === "selected_students" && (
                <p className="mt-2 text-sm font-semibold text-[#173f3b]">
                  {moduleStudentIds.length === 0
                    ? "No students selected."
                    : `${moduleStudentIds.length} ${moduleStudentIds.length === 1 ? "student" : "students"} selected.`}
                </p>
              )}
            </fieldset>
          )}

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

                    {module.due_at && (
                      <span className="rounded-full bg-[#173f3b]/10 px-3 py-1 text-xs font-semibold text-[#173f3b]">
                        Due {formatDueDateTime(module.due_at)}
                      </span>
                    )}

                    {module.removed_at && (
                      <span className="rounded-full bg-[#5c7471] px-3 py-1 text-xs font-bold text-white">
                        Removed · hidden from students
                      </span>
                    )}

                    {module.targeting === "selected_students" && (
                      <span
                        className="rounded-full bg-[#173f3b] px-3 py-1 text-xs font-bold text-white"
                        title={module.recipient_ids
                          .map((id) => students.find((student) => student.student_id === id)?.full_name ?? "Former student")
                          .join(", ")}
                      >
                        Selected students · {module.recipient_ids.length}
                      </span>
                    )}
                  </div>
                </div>

                {removalSupported && !archived && (
                  <button
                    type="button"
                    disabled={Boolean(changingModuleId)}
                    onClick={() => onToggleModuleRemoved(module)}
                    className="ml-auto shrink-0 rounded-xl bg-white px-3 py-2 text-xs font-extrabold text-[#173f3b] transition hover:bg-[#f4f7f5] disabled:opacity-60"
                  >
                    {changingModuleId === module.assignment_id
                      ? "Saving..."
                      : module.removed_at
                        ? "Restore"
                        : "Remove"}
                  </button>
                )}
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
  const [studentsPanelOpen, setStudentsPanelOpen] = useState(false);
  // Closing the panel returns focus to the button that opened it.
  function closeStudentsPanel() {
    setStudentsPanelOpen(false);
    window.setTimeout(() => document.getElementById("enrolledStudentsButton")?.focus(), 0);
  }
  const savingRoom = useRef(false);
  const removingStudent = useRef(false);

  const [roomName, setRoomName] = useState("");
  const [section, setSection] = useState("");
  const [description, setDescription] = useState("");

  // Reading module assignment
  // Shared by Assign Module and Assign Reading Activity; never saved to the room.
  const [roomLanguage, setRoomLanguage] = useState<ReadingLanguage | "">("");
  // Older rooms only, and only when the database supports saving their subject.
  const [legacySubject, setLegacySubject] = useState<LegacyRoomSubjectOptions | null>(null);
  const [legacySubjectSaving, setLegacySubjectSaving] = useState(false);
  const [legacySubjectError, setLegacySubjectError] = useState("");
  const [legacySubjectChoice, setLegacySubjectChoice] = useState<ReadingLanguage | "">("");
  // Module targeting appears only when the database reports it is enabled.
  const [moduleTargetingEnabled, setModuleTargetingEnabled] = useState(false);
  const [moduleTargeting, setModuleTargeting] = useState<ModuleTargeting>("whole_class");
  const [moduleStudentIds, setModuleStudentIds] = useState<string[]>([]);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [archiveError, setArchiveError] = useState("");
  const [showModuleForm, setShowModuleForm] = useState(false);
  const [selectedModuleId, setSelectedModuleId] = useState("");
  // Optional; empty means no deadline.
  const [moduleDueAt, setModuleDueAt] = useState("");
  // Optional features that need the proposed migrations; hidden until they are applied.
  const [moduleDeadlinesSupported, setModuleDeadlinesSupported] = useState(false);
  const [moduleRemovalSupported, setModuleRemovalSupported] = useState(false);
  const [activityRemovalSupported, setActivityRemovalSupported] = useState(false);
  const [changingModuleId, setChangingModuleId] = useState("");
  const [changingActivityId, setChangingActivityId] = useState("");
  const [assigningModule, setAssigningModule] = useState(false);

  // Reading activity assignment
  const [showActivityForm, setShowActivityForm] = useState(false);
  const [selectedMaterialId, setSelectedMaterialId] = useState("");
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  const [assigningActivity, setAssigningActivity] = useState(false);
  // Only reviewed sets of the selected material can be assigned.
  const [questionSets, setQuestionSets] = useState<MaterialQuestionSetSummary[]>([]);
  const [selectedQuestionSetId, setSelectedQuestionSetId] = useState("");
  // Optional; empty means no deadline.
  const [activityDueAt, setActivityDueAt] = useState("");
  const [loadingQuestionSets, setLoadingQuestionSets] = useState(false);
  const [questionSetError, setQuestionSetError] = useState("");

  const [questionSetRefresh, setQuestionSetRefresh] = useState(0);
  useEffect(() => {
    let live = true;
    void getModuleTargetingEnabled().then((enabled) => { if (live) setModuleTargetingEnabled(enabled); });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    if (!classroom || classroom.subject) {
      setLegacySubject(null);
      return;
    }
    let live = true;
    void getLegacyRoomSubjectOptions(classroom.id).then((options) => { if (live) setLegacySubject(options); });
    return () => { live = false; };
  }, [classroom?.id, classroom?.subject]);

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
    let active = true;
    const check = (
      table: "room_modules" | "reading_activity_assignments",
      column: "due_at" | "removed_at",
      apply: (supported: boolean) => void
    ) => supportsOptionalColumn(table, column)
      .then((supported) => { if (active) apply(supported); })
      .catch((err) => console.error("Unable to check optional classroom features:", err));
    void check("room_modules", "due_at", setModuleDeadlinesSupported);
    void check("room_modules", "removed_at", setModuleRemovalSupported);
    void check("reading_activity_assignments", "removed_at", setActivityRemovalSupported);
    return () => { active = false; };
  }, []);

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
          getAssignedModules(roomId, { includeRemoved: true }),
          getUploadedReadingMaterials(),
        ]);

        setClassroom(room);
        setRoomLanguage(room.subject ?? "");
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

    const alreadyAssigned = assignedModules.find(
      (module) => module.module_id === selectedModuleId
    );

    if (alreadyAssigned) {
      setModuleError(alreadyAssigned.removed_at
        ? "This reading module was removed earlier. Use Restore in the list to assign it again."
        : "This reading module is already assigned.");
      return;
    }

    const selectedOnly = moduleTargetingEnabled && moduleTargeting === "selected_students";
    if (selectedOnly && moduleStudentIds.length === 0) {
      setModuleError("Select at least one student, or choose Whole Class.");
      return;
    }

    let dueAt: string | null = null;
    if (moduleDeadlinesSupported) {
      try {
        dueAt = parseOptionalDueDate(moduleDueAt);
      } catch (err) {
        setModuleError(getReadingActivityError(err));
        return;
      }
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

      if (selectedOnly) {
        await assignModuleToSelectedStudents(roomId, selectedModuleId, moduleStudentIds, dueAt);
      } else {
        await assignModuleToRoom(roomId, selectedModuleId, user.id, dueAt);
      }

      const updatedAssignments = await getAssignedModules(roomId, { includeRemoved: true });

      setAssignedModules(updatedAssignments);
      setSelectedModuleId("");
      setModuleDueAt("");
      setModuleTargeting("whole_class");
      setModuleStudentIds([]);
      setShowModuleForm(false);
    } catch (err) {
      console.error("Failed to assign reading module:", err);
      const text = (err as { message?: unknown } | null)?.message;
      setModuleError(selectedOnly && typeof text === "string" && text ? text : "Unable to assign reading module.");
    } finally {
      moduleRequestPending.current = false;
      setAssigningModule(false);
    }
  }

  // Soft removal: hides the item from students and blocks new attempts.
  // Saved readings, comprehension results, history, analytics and XP are kept.
  async function handleToggleModuleRemoved(module: AssignedReadingModule) {
    if (!roomId || changingModuleId) return;
    const removing = !module.removed_at;
    const confirmed = await confirmReadFlow(removing
      ? `Remove "${module.title}" from this classroom? Students will no longer see it or be able to start it. Their saved results, reading history and XP are kept, and you can restore it later.`
      : `Restore "${module.title}" for this classroom? Students will see it again.`);
    if (!confirmed) return;
    setChangingModuleId(module.assignment_id);
    try {
      await setRoomModuleRemoved(module.assignment_id, removing);
      setAssignedModules(await getAssignedModules(roomId, { includeRemoved: true }));
    } catch (err) {
      console.error("Failed to change module assignment:", err);
      await showReadFlowDialog(err instanceof Error ? err.message : "Unable to update this module.");
    } finally {
      setChangingModuleId("");
    }
  }

  async function handleToggleActivityRemoved(activity: ReadingActivityAssignment, title: string, studentName: string) {
    if (!roomId || changingActivityId) return;
    const removing = !activity.removed_at;
    const confirmed = await confirmReadFlow(removing
      ? `Remove "${title}" for ${studentName}? The student will no longer see it or be able to start it. Their saved results, reading history and XP are kept, and you can restore it later.`
      : `Restore "${title}" for ${studentName}? The student will see it again.`);
    if (!confirmed) return;
    setChangingActivityId(activity.id);
    try {
      await setReadingActivityRemoved(activity.id, removing);
      await refreshActivities(roomId);
    } catch (err) {
      console.error("Failed to change reading activity:", err);
      await showReadFlowDialog(err instanceof Error ? err.message : "Unable to update this activity.");
    } finally {
      setChangingActivityId("");
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

    let dueAt: string | null;
    try {
      dueAt = parseOptionalDueDate(activityDueAt);
    } catch (err) {
      setActivityError(getReadingActivityError(err));
      return;
    }

    try {
      activityRequestPending.current = true;
      setAssigningActivity(true);

      await assignReadingActivity(
        roomId,
        selectedMaterialId,
        selectedStudentIds,
        dueAt,
        selectedQuestionSetId || null
      );

      setActivitySuccess("Reading activity assigned successfully!");

      setSelectedMaterialId("");
      setSelectedStudentIds([]);
      setActivityDueAt("");
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

  async function handleToggleArchive() {
    if (!classroom || archiveBusy) return;
    const archive = !isRoomArchived(classroom);
    if (!(await confirmReadFlow(archive
      ? `Archive "${classroom.room_name}"? Students will not be able to join or start new activities. Nothing is deleted, and you can restore it later.`
      : `Restore "${classroom.room_name}"? Students can join and start activities again.`))) return;
    setArchiveBusy(true);
    setArchiveError("");
    try {
      await setClassroomArchived(classroom.id, archive);
      setClassroom(await getClassroomById(classroom.id));
      setShowModuleForm(false);
      setShowActivityForm(false);
    } catch (err) {
      const text = (err as { message?: unknown } | null)?.message;
      setArchiveError(typeof text === "string" && text ? text : "The learning room could not be changed.");
    } finally {
      setArchiveBusy(false);
    }
  }

  async function handleSaveLegacySubject(subject: ReadingLanguage) {
    if (!classroom || classroom.subject) return;
    const name = subject === "fil" ? "Filipino" : "English";
    if (!(await confirmReadFlow(`Save ${name} as this room's subject? Both assignment forms will then show only ${name} readings, and the subject cannot be changed later.`))) return;
    setLegacySubjectSaving(true);
    setLegacySubjectError("");
    try {
      const saved = await setLegacyRoomSubject(classroom.id, subject);
      handleRoomLanguageChange(saved);
      setClassroom({ ...classroom, subject: saved });
    } catch (err) {
      const text = (err as { message?: unknown } | null)?.message;
      setLegacySubjectError(typeof text === "string" && text ? text : "The classroom subject could not be saved.");
    } finally {
      setLegacySubjectSaving(false);
    }
  }

  // A selection in the other language is cleared; saved assignments are untouched.
  function handleRoomLanguageChange(language: ReadingLanguage | "") {
    if (classroom?.subject) return;
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
      {/* Back: an archived room belongs to Archived Classrooms */}
      <Link
        to={isRoomArchived(classroom) ? "/m3/teacher/archived-classrooms" : "/m3/teacher/learning-rooms"}
        className="mb-5 inline-flex items-center gap-2 text-sm font-bold text-white/80 transition hover:text-white"
      >
        {isRoomArchived(classroom) ? "← Back to Archived Classrooms" : "← Back to Learning Rooms"}
      </Link>

      {isRoomArchived(classroom) && (
        <p role="note" className="mb-5 rounded-2xl bg-white/80 px-5 py-4 text-sm text-[#173f3b]">
          <strong>This classroom is archived and read-only.</strong> You can review its students, assigned readings and saved
          results. Nothing can be assigned, edited or removed until you restore it from the actions menu (⋮).{" "}
          <Link to={`/m3/teacher/oral-reading?roomId=${encodeURIComponent(classroom.id)}`} className="font-bold underline">
            Review this classroom&apos;s reading and comprehension results
          </Link>
          .
        </p>
      )}

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
        archiveBusy={archiveBusy}
        archiveError={archiveError}
        onToggleArchive={() => void handleToggleArchive()}
        onCancelEdit={handleCancelEdit}
        onSave={handleSaveClassroom}
      />

      {/* Overview */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        <EnrolledStudentsButton
          count={students.length}
          onOpen={() => setStudentsPanelOpen(true)}
          className="rounded-2xl bg-[#f7cf4a] p-5 text-[#173f3b] shadow-sm"
        />

        <div className="rounded-2xl bg-[#ef7468] p-5 shadow-sm">
          <p className="text-sm font-bold text-white/80">
            Assigned Reading Modules
          </p>

          <p className="mt-1 text-3xl font-black text-white">
            {assignedModules.filter((module) => !module.removed_at).length}
          </p>
        </div>
      </div>

      <EnrolledStudentsPanel
        open={studentsPanelOpen}
        roomName={classroom.room_name}
        students={students}
        onClose={closeStudentsPanel}
        onRemoveStudent={isRoomArchived(classroom) ? undefined : handleRemoveStudent}
      />

      {legacySubject && !classroom.subject && !isRoomArchived(classroom) && (
        <LegacyRoomSubjectPanel
          options={legacySubject}
          selected={legacySubjectChoice}
          onSelect={setLegacySubjectChoice}
          saving={legacySubjectSaving}
          error={legacySubjectError}
          onSave={(subject) => void handleSaveLegacySubject(subject)}
        />
      )}

      <div>
        {/* Reading Modules */}
        <ModuleAssignmentSection
          assignedModules={assignedModules}
          unassignedModules={unassignedModules}
          showModuleForm={showModuleForm}
          selectedModuleId={selectedModuleId}
          assigningModule={assigningModule}
          moduleError={moduleError}
          subjectLocked={Boolean(classroom.subject)}
          subject={classroom.subject ?? null}
          roomLanguage={roomLanguage}
          deadlinesSupported={moduleDeadlinesSupported}
          moduleDueAt={moduleDueAt}
          removalSupported={moduleRemovalSupported}
          changingModuleId={changingModuleId}
          targetingEnabled={moduleTargetingEnabled}
          archived={isRoomArchived(classroom)}
          students={students}
          moduleTargeting={moduleTargeting}
          moduleStudentIds={moduleStudentIds}
          onModuleTargetingChange={(targeting) => { setModuleTargeting(targeting); setModuleError(""); }}
          onToggleModuleStudent={(studentId) => setModuleStudentIds((ids) =>
            ids.includes(studentId) ? ids.filter((id) => id !== studentId) : [...ids, studentId])}
          onRoomLanguageChange={handleRoomLanguageChange}
          onToggleForm={() => {
            setModuleError("");
            setShowModuleForm((current) => !current);
          }}
          onSelectModule={setSelectedModuleId}
          onModuleDueAtChange={setModuleDueAt}
          onAssignModule={handleAssignModule}
          onToggleModuleRemoved={(module) => void handleToggleModuleRemoved(module)}
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
            disabled={assigningActivity || (isRoomArchived(classroom) && !showActivityForm)}
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
              {activities.map(activity => {
                const title = uploadedMaterials.find(material => material.id === activity.material_id)?.title ?? "Reading Activity";
                const studentName = students.find(student => student.student_id === activity.student_id)?.display_name ?? "Previously enrolled student";
                return (
                  <li key={activity.id} className="flex items-start gap-3 rounded-xl bg-white/70 px-4 py-3 text-[#173f3b]">
                    <div className="min-w-0">
                      <p className="font-bold">{title}</p>
                      <p className="text-sm">{activity.question_set_id ? activity.question_set_name ?? "Question set" : "Read-aloud only"}</p>
                      <p className="text-sm">{studentName} · {activity.status.replace("_", " ")}</p>
                      {activity.due_at && <p className="text-sm">Due {formatDueDateTime(activity.due_at)}</p>}
                      {activity.removed_at && <p className="text-sm font-bold text-[#5c7471]">Removed · hidden from the student</p>}
                    </div>
                    {activityRemovalSupported && !isRoomArchived(classroom) && (
                      <button type="button" disabled={Boolean(changingActivityId)}
                        onClick={() => void handleToggleActivityRemoved(activity, title, studentName)}
                        className="ml-auto shrink-0 rounded-xl bg-white px-3 py-2 text-xs font-extrabold text-[#173f3b] transition hover:bg-[#f4f7f5] disabled:opacity-60">
                        {changingActivityId === activity.id ? "Saving..." : activity.removed_at ? "Restore" : "Remove"}
                      </button>
                    )}
                  </li>
                );
              })}
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
              subject={classroom.subject ?? null}
              disabled={Boolean(classroom.subject)}
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

            {/* Optional deadline: shown to students, late work is still accepted. */}
            <div className="mt-6">
              <p
                id="activityDueAtLabel"
                className="mb-2 block text-sm font-bold text-[#173f3b]"
              >
                Due date and time (optional)
              </p>
              <DueDateTimeInput
                id="activityDueAt"
                labelId="activityDueAtLabel"
                value={activityDueAt}
                onValueChange={setActivityDueAt}
                invalid={Boolean(dueDateIssue(activityDueAt))}
                describedBy="activityDueAtHelp activityDueAtIssue"
              />
              <p id="activityDueAtHelp" className="mt-1 text-xs text-[#6d8582]">
                Philippine time. Leave empty for no deadline. Students see the due date, and they can still finish after it.
              </p>
              <p id="activityDueAtIssue" className="mt-1 text-xs font-bold text-[#a9443c]">{dueDateIssue(activityDueAt)}</p>
            </div>

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
