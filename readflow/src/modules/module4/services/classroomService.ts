import { supabase } from "../../../lib/supabaseClient";
import { getProfileDisplayName } from "../../module1/utils/profileFields.ts";
import { normalizeLanguageAlias } from "../../module3/services/moduleModel.ts";

/** Reading language of a module or material; null when it is missing or unsupported. */
export type ReadingLanguage = "en" | "fil";

// ==========================
// OPTIONAL ASSIGNMENT COLUMNS
// ==========================
// room_modules.due_at and removed_at/removed_by come from the proposed migrations
// m4_module_due_dates_PROPOSED.sql and m4_unassign_PROPOSED.sql. Until they are applied,
// assignment rows are read with "*" and these columns are simply absent, so nothing breaks.

function optionalColumn(row: object, column: "due_at" | "removed_at"): string | null {
  const value = (row as Record<string, unknown>)[column];
  return typeof value === "string" ? value : null;
}

const MISSING_SCHEMA_CODES = ["42703", "42883", "PGRST202", "PGRST204"];
const columnSupport = new Map<string, Promise<boolean>>();

/** True when the optional migration that adds this column has been applied. */
export function supportsOptionalColumn(
  table: "room_modules" | "reading_activity_assignments",
  column: "due_at" | "removed_at"
): Promise<boolean> {
  const key = `${table}.${column}`;
  let check = columnSupport.get(key);
  if (!check) {
    // limit(0) reads no rows; PostgREST still rejects an unknown column.
    check = Promise.resolve(supabase.from(table).select(column).limit(0)).then(({ error }) => {
      if (!error) return true;
      columnSupport.delete(key);
      if (MISSING_SCHEMA_CODES.includes(String(error.code))) return false;
      throw error;
    });
    columnSupport.set(key, check);
  }
  return check;
}

export class AssignmentRemovalError extends Error {}

function assignmentRemovalError(error: { code?: string }, item: "activity" | "module"): AssignmentRemovalError {
  if (MISSING_SCHEMA_CODES.includes(String(error.code))) {
    return new AssignmentRemovalError(`Removing ${item}s is not available yet. Please contact your administrator.`);
  }
  if (error.code === "42501") {
    return new AssignmentRemovalError(`Only the teacher who owns this classroom can change this ${item}.`);
  }
  return new AssignmentRemovalError(`Unable to update this ${item}. Please try again.`);
}

/**
 * Soft-removes (or restores) one student's reading activity. Nothing is deleted:
 * saved readings, comprehension results, history, analytics and XP stay as they are.
 */
export async function setReadingActivityRemoved(assignmentId: string, removed: boolean): Promise<boolean> {
  const { data, error } = await supabase.rpc("m4_unassign_activity" as never, {
    p_assignment_id: assignmentId, p_restore: !removed,
  } as never);
  if (error) throw assignmentRemovalError(error, "activity");
  return data === true;
}

/** Soft-removes (or restores) a module assignment for the whole classroom. Nothing is deleted. */
export async function setRoomModuleRemoved(roomModuleId: string, removed: boolean): Promise<boolean> {
  const { data, error } = await supabase.rpc("m4_unassign_module" as never, {
    p_room_module_id: roomModuleId, p_restore: !removed,
  } as never);
  if (error) throw assignmentRemovalError(error, "module");
  return data === true;
}

export type Classroom = {
  id: string;
  teacher_id: string;
  room_name: string;
  section: string | null;
  room_code: string;
  description: string | null;
  created_at: string;
  /** Absent/null for rooms created before the proposed subject migration. */
  subject?: ReadingLanguage | null;
  /** Present only once the proposed m4_room_archive migration is installed; set while archived. */
  archived_at?: string | null;
  archived_by?: string | null;
};

/** Archive/Restore exists only once rooms.archived_at exists (proposed m4_room_archive migration). */
export function supportsRoomArchive(room: Classroom | null | undefined): boolean {
  return Boolean(room) && Object.prototype.hasOwnProperty.call(room, "archived_at");
}

export function isRoomArchived(room: Classroom | null | undefined): boolean {
  return Boolean(room?.archived_at);
}

/** Archives or restores a learning room. Nothing is deleted; the database refuses new joins and activity while archived. */
export async function setClassroomArchived(roomId: string, archive: boolean): Promise<boolean> {
  const { data, error } = await supabase.rpc("m4_set_room_archived" as never, {
    p_room_id: roomId, p_archive: archive,
  } as never);
  if (error) {
    console.error("Error changing the learning room archive state:", error);
    throw new Error(error.code === "42501"
      ? "Only the room's Teacher or an Admin can archive or restore it."
      : `Unable to ${archive ? "archive" : "restore"} this learning room. Nothing was changed.`);
  }
  return data === true;
}

export type CreateClassroomInput = {
  teacherId: string;
  subject: ReadingLanguage;
  roomName: string;
  section: string;
  description: string;
};

export type EnrolledStudent = {
  enrollment_id: string;
  student_id: string;
  display_name: string;
  // Compatibility for the completed M4 reading-activity student picker.
  full_name: string;
  enrolled_at: string;
};
// GET TEACHER CLASSROOMS
export async function getTeacherClassrooms(
  teacherId: string
): Promise<Classroom[]> {
  const { data, error } = await supabase
    .from("rooms")
    .select("*")
    .eq("teacher_id", teacherId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching teacher classrooms:", error);
    throw error;
  }

  return data ?? [];
}
// CREATE CLASSROOM

function generateRoomCode() {
  const characters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";

  for (let i = 0; i < 8; i++) {
    code += characters.charAt(
      Math.floor(Math.random() * characters.length)
    );
  }

  return code;
}

async function generateUniqueRoomCode(): Promise<string> {
  const maxAttempts = 10;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const roomCode = generateRoomCode();

    const { data, error } = await supabase
      .from("rooms")
      .select("id")
      .eq("room_code", roomCode)
      .maybeSingle();

    if (error) {
      console.error("Error checking room code:", error);
      throw error;
    }

    if (!data) {
      return roomCode;
    }
  }

  throw new Error(
    "Unable to generate a unique classroom code. Please try again."
  );
}

export async function createClassroom(
  input: CreateClassroomInput
): Promise<Classroom> {
  if (!["en", "fil"].includes(input.subject)) throw new Error("Please select English or Filipino.");
  const roomCode = await generateUniqueRoomCode();

  const { data, error } = await supabase
    .from("rooms")
    .insert({
      teacher_id: input.teacherId,
      subject: input.subject,
      room_name: input.roomName.trim(),
      section: input.section.trim() || null,
      description: input.description.trim() || null,
      room_code: roomCode,
    })
    .select()
    .single();

  if (error) {
    console.error("Error creating classroom:", error);
    if (["42703", "PGRST204"].includes(error.code)) {
      throw new Error("Room subjects are not installed in this database yet. The proposed room-subject migration must be reviewed and applied before creating a subject-based room.");
    }
    throw error;
  }

  return data;
}
// GET CLASSROOM

export async function getClassroomById(
  roomId: string
): Promise<Classroom> {
  const { data, error } = await supabase
    .from("rooms")
    .select("*")
    .eq("id", roomId)
    .single();

  if (error) {
    console.error("Error fetching classroom:", error);
    throw error;
  }

  return data;
}

// ==========================
// LEGACY ROOM SUBJECTS
// ==========================
// Older rooms (subject IS NULL) can be given a subject once, by their approved Teacher, through
// m4_set_legacy_room_subject from supabase/proposed/m4_legacy_room_subject_PROPOSED.sql. The
// database decides which subject is allowed from everything ever assigned to the room; mixed
// English/Filipino rooms cannot be converted and keep the language picker.

export type LegacyRoomSubjectOptions = {
  subject: ReadingLanguage | null;
  /** Languages of every module/activity ever assigned, including removed ones; "unknown" if unverifiable. */
  contentLanguages: string[];
  /** Subjects the database will accept for this room (empty for mixed or unknown content). */
  choices: ReadingLanguage[];
  canSet: boolean;
};

/** Null when the database does not support legacy conversion (proposal not installed) or the check fails. */
export async function getLegacyRoomSubjectOptions(roomId: string): Promise<LegacyRoomSubjectOptions | null> {
  try {
    const { data, error } = await supabase.rpc("m4_legacy_room_subject_options" as never, { target_room: roomId } as never);
    if (error || !data || typeof data !== "object") return null;
    const value = data as Partial<LegacyRoomSubjectOptions>;
    return {
      subject: value.subject === "en" || value.subject === "fil" ? value.subject : null,
      contentLanguages: Array.isArray(value.contentLanguages) ? value.contentLanguages.map(String) : [],
      choices: Array.isArray(value.choices) ? value.choices.filter((c): c is ReadingLanguage => c === "en" || c === "fil") : [],
      canSet: value.canSet === true,
    };
  } catch {
    return null;
  }
}

export async function setLegacyRoomSubject(roomId: string, subject: ReadingLanguage): Promise<ReadingLanguage> {
  const { data, error } = await supabase.rpc("m4_set_legacy_room_subject" as never, {
    target_room: roomId, new_subject: subject,
  } as never);
  if (error) {
    // The database's refusals are written for Teachers; anything else stays generic.
    const message = typeof error.message === "string" ? error.message : "";
    throw new Error(error.code === "23514" || error.code === "42501" || error.code === "22023"
      ? message
      : "The classroom subject could not be saved. Nothing was changed. Please try again.");
  }
  return data === "fil" ? "fil" : "en";
}
// STUDENT JOINS CLASSROOM

export async function joinClassroomByCode(
  studentId: string,
  roomCode: string
) {
  // The database function securely uses auth.uid()
  // as the actual student ID.
  void studentId;

  const { data, error } = await supabase.rpc(
    "join_room_by_code",
    {
      p_room_code: roomCode.trim().toUpperCase(),
    }
  );

  if (error) {
    console.error("Error joining classroom:", error);
    throw error;
  }

  return data;
}
// GET ENROLLED STUDENTS
export async function getRoomEnrollments(
  roomId: string
): Promise<EnrolledStudent[]> {
  const { data: enrollments, error: enrollmentError } =
    await supabase
      .from("enrollments")
      .select("id, student_id, enrolled_at")
      .eq("room_id", roomId)
      .order("enrolled_at", { ascending: true });

  if (enrollmentError) {
    console.error(
      "Error fetching classroom enrollments:",
      enrollmentError
    );
    throw enrollmentError;
  }

  if (!enrollments || enrollments.length === 0) {
    return [];
  }

  const studentIds = enrollments.map(
    (enrollment) => enrollment.student_id
  );

  const { data: profiles, error: profileError } =
    await supabase
      .from("profiles")
      .select("id, full_name, nickname, role")
      .in("id", studentIds);

  if (profileError) {
    console.error(
      "Error fetching student profiles:",
      profileError
    );
    throw profileError;
  }

  return enrollments.map((enrollment) => {
    const studentProfile = profiles?.find(
      (profile) => profile.id === enrollment.student_id
    );

    return {
      enrollment_id: enrollment.id,
      student_id: enrollment.student_id,
      display_name: getProfileDisplayName(studentProfile),
      full_name: getProfileDisplayName(studentProfile),
      enrolled_at: enrollment.enrolled_at,
    };
  });
}
// REMOVE ENROLLED STUDENT
/** Admin classroom actions the database allows (proposed m4_admin_classroom_actions); [] when not installed. */
export async function getAdminClassroomActions(): Promise<string[]> {
  try {
    const { data, error } = await supabase.rpc("m4_admin_classroom_actions" as never);
    return !error && Array.isArray(data) ? (data as unknown[]).map(String) : [];
  } catch {
    return [];
  }
}

/** Audited Admin removal of an enrolled student (the Admin is recorded as the actor). */
export async function adminRemoveEnrolledStudent(enrollmentId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("m4_admin_remove_enrollment" as never, { p_enrollment_id: enrollmentId } as never);
  if (error) {
    console.error("Error removing enrolled student as Admin:", error);
    throw new Error(error.code === "42501" ? "Admin access is required to remove students." : "Unable to remove this student. Nothing was changed.");
  }
  return data === true;
}

export async function removeEnrolledStudent(
  enrollmentId: string
): Promise<void> {
  const { error } = await supabase
    .from("enrollments")
    .delete()
    .eq("id", enrollmentId);

  if (error) {
    console.error("Error removing enrolled student:", error);
    throw error;
  }
}
// UPDATE CLASSROOM
export type UpdateClassroomInput = {
  roomName: string;
  section: string;
  description: string;
};

export async function updateClassroom(
  roomId: string,
  input: UpdateClassroomInput
): Promise<Classroom> {
  const { data, error } = await supabase
    .from("rooms")
    .update({
      room_name: input.roomName.trim(),
      section: input.section.trim() || null,
      description: input.description.trim() || null,
    })
    .eq("id", roomId)
    .select()
    .single();

  if (error) {
    console.error("Error updating classroom:", error);
    throw error;
  }

  return data;
}
// READING MODULE ASSIGNMENTS
export type ReadingModule = {
  id: string;
  title: string;
  difficulty: string | null;
  status: string;
  /** From the module's learning path. */
  language: ReadingLanguage | null;
};

export type AssignedReadingModule = {
  assignment_id: string;
  module_id: string;
  title: string;
  difficulty: string | null;
  assigned_at: string;
  /** Optional deadline; null when none was set (or before the due-date migration). */
  due_at: string | null;
  /** Set when the teacher removed the module; removed modules are hidden from students. */
  removed_at: string | null;
  /** "selected_students" only after the proposed m4_module_recipients migration; otherwise whole class. */
  targeting: ModuleTargeting;
  /** Recipient student IDs of a selected-students assignment (empty for whole class). */
  recipient_ids: string[];
};

export type ModuleTargeting = "whole_class" | "selected_students";

/** True only once m4_module_recipients is installed AND its separate enable step has run. */
export async function getModuleTargetingEnabled(): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc("m4_module_targeting_enabled" as never);
    return !error && data === true;
  } catch {
    return false;
  }
}

/** Selected-student assignment through the atomic m4_assign_module RPC (validated again in the database). */
export async function assignModuleToSelectedStudents(
  roomId: string,
  moduleId: string,
  studentIds: string[],
  dueAt: string | null = null
): Promise<string> {
  if (!studentIds.length) throw new Error("Select at least one student.");
  assertNewDueDate(dueAt);
  const { data, error } = await supabase.rpc("m4_assign_module" as never, {
    p_room_id: roomId, p_module_id: moduleId, p_mode: "selected_students",
    p_students: [...new Set(studentIds)], p_due_at: dueAt,
  } as never);
  if (error) {
    console.error("Error assigning module to selected students:", error);
    const known: Record<string, string> = {
      "22023": "Check the selected students and the due date, then try again.",
      "42501": "Every selected student must be enrolled in this classroom, and only its Teacher can assign modules.",
      "23514": "This reading module does not match the classroom subject.",
      "55000": "Assigning to selected students is not available yet.",
    };
    throw new Error(known[error.code ?? ""] ?? "Unable to assign reading module.");
  }
  return String(data);
}

// Get published modules that teachers can assign
export async function getPublishedModules(): Promise<ReadingModule[]> {
  const { data, error } = await supabase
    .from("modules")
    .select("id, title, difficulty, status, path_id")
    .eq("status", "published")
    .is("deleted_at", null)
    .order("title", { ascending: true });

  if (error) {
    console.error("Error fetching published modules:", error);
    throw error;
  }

  const rows = data ?? [];
  const pathIds = [...new Set(rows.map((row) => row.path_id).filter((id): id is string => Boolean(id)))];
  const pathLanguages = new Map<string, ReadingLanguage | null>();
  if (pathIds.length) {
    const { data: paths, error: pathError } = await supabase
      .from("learning_paths")
      .select("id, language")
      .in("id", pathIds);
    // Without path languages the modules stay listed but cannot pass a language filter.
    if (pathError) console.error("Error fetching module languages:", pathError);
    (paths ?? []).forEach((path) => pathLanguages.set(path.id, normalizeLanguageAlias(path.language)));
  }

  return rows.map(({ path_id, ...module }) => ({
    ...module,
    language: path_id ? pathLanguages.get(path_id) ?? null : null,
  }));
}

// Assign a module to a classroom
export async function assignModuleToRoom(
  roomId: string,
  moduleId: string,
  teacherId: string,
  dueAt: string | null = null
): Promise<void> {
  assertNewDueDate(dueAt);
  const { error } = await supabase
    .from("room_modules")
    .insert({
      room_id: roomId,
      module_id: moduleId,
      assigned_by: teacherId,
      // Sent only when set, so assigning without a deadline works before the migration.
      ...(dueAt !== null ? { due_at: dueAt } : {}),
    } as never);

  if (error) {
    console.error("Error assigning module to classroom:", error);
    throw error;
  }
}

// Get modules assigned to a classroom. Removed modules are left out unless the
// classroom teacher asks for them (to show and restore them).
export async function getAssignedModules(
  roomId: string,
  { includeRemoved = false }: { includeRemoved?: boolean } = {}
): Promise<AssignedReadingModule[]> {
  const { data: rows, error: assignmentError } =
    await supabase
      .from("room_modules")
      .select("*")
      .eq("room_id", roomId)
      .order("assigned_at", { ascending: false });
  const assignments = (rows ?? []).filter(
    (row) => includeRemoved || !optionalColumn(row, "removed_at")
  );

  if (assignmentError) {
    console.error(
      "Error fetching assigned modules:",
      assignmentError
    );
    throw assignmentError;
  }

  if (!assignments || assignments.length === 0) {
    return [];
  }

  const moduleIds = assignments.map(
    (assignment) => assignment.module_id
  );

  const { data: modules, error: moduleError } =
    await supabase
      .from("modules")
      .select("id, title, difficulty")
      .in("id", moduleIds)
      .eq("status", "published")
      .is("deleted_at", null);

  if (moduleError) {
    console.error(
      "Error fetching assigned module details:",
      moduleError
    );
    throw moduleError;
  }

  // Recipients exist only for selected-student assignments (proposed migration); never queried otherwise.
  const targetedIds = assignments.filter((row) => targetingOf(row) === "selected_students").map((row) => row.id);
  let recipients: { room_module_id: string; student_id: string }[] = [];
  if (targetedIds.length) {
    const { data, error } = await supabase
      .from("room_module_recipients" as never)
      .select("room_module_id, student_id")
      .in("room_module_id", targetedIds);
    if (error) {
      console.error("Error fetching module recipients:", error);
      throw error;
    }
    recipients = (data ?? []) as unknown as typeof recipients;
  }

  return assignments.filter(assignment => modules?.some(module => module.id === assignment.module_id)).map((assignment) => {
    const module = modules?.find(
      (item) => item.id === assignment.module_id
    );

    return {
      assignment_id: assignment.id,
      module_id: assignment.module_id,
      title: module?.title ?? "Unknown Module",
      difficulty: module?.difficulty ?? null,
      assigned_at: assignment.assigned_at,
      due_at: optionalColumn(assignment, "due_at"),
      removed_at: optionalColumn(assignment, "removed_at"),
      targeting: targetingOf(assignment),
      recipient_ids: recipients.filter((row) => row.room_module_id === assignment.id).map((row) => row.student_id),
    };
  });
}

function targetingOf(row: object): ModuleTargeting {
  return (row as Record<string, unknown>).targeting_mode === "selected_students" ? "selected_students" : "whole_class";
}
// ==========================
// GET STUDENT CLASSROOMS
// ==========================

export async function getStudentClassrooms(
  studentId: string
): Promise<Classroom[]> {
  const { data: enrollments, error: enrollmentError } =
    await supabase
      .from("enrollments")
      .select("room_id")
      .eq("student_id", studentId);

  if (enrollmentError) {
    console.error(
      "Error fetching student enrollments:",
      enrollmentError
    );
    throw enrollmentError;
  }

  if (!enrollments || enrollments.length === 0) {
    return [];
  }

  const roomIds = enrollments.map(
    (enrollment) => enrollment.room_id
  );

  const { data: rooms, error: roomError } = await supabase
    .from("rooms")
    .select("*")
    .in("id", roomIds)
    .order("created_at", { ascending: false });

  if (roomError) {
    console.error(
      "Error fetching student classrooms:",
      roomError
    );
    throw roomError;
  }

  return rooms ?? [];
}
// Signed-in user from supabase.auth.getUser(). A getUser error is rethrown as is;
// a missing user throws the caller's own error.
async function getAuthenticatedUser(missingUserError: () => Error) {
  const { data: userData, error: userError } =
    await supabase.auth.getUser();

  if (userError) throw userError;

  const user = userData.user;

  if (!user) {
    throw missingUserError();
  }

  return user;
}
// READING ACTIVITY ASSIGNMENTS
export type UploadedReadingMaterial = {
  id: string;
  title: string;
  uploaded_by: string;
  language: ReadingLanguage | null;
};
export async function getUploadedReadingMaterials(): Promise<
  UploadedReadingMaterial[]
> {
  const user = await getAuthenticatedUser(() => new Error("User not authenticated."));

  const { data, error } = await supabase
    .from("uploaded_materials")
    .select("id, title, uploaded_by, language")
    .eq("uploaded_by", user.id)
    .eq("extraction_status", "completed")
    .order("created_at", { ascending: false });

  if (error) throw error;

  return (data ?? []).map((material) => ({
    ...material,
    language: normalizeLanguageAlias(material.language),
  }));
}
export type ReadingActivityAssignment = {
  id: string;
  room_id: string;
  material_id: string;
  student_id: string;
  assigned_by: string;
  assigned_at: string;
  due_at: string | null;
  status: "assigned" | "in_progress" | "completed";
  /** NULL means read-aloud only (or an assignment made before question sets). */
  question_set_id: string | null;
  question_set_name: string | null;
  /** Set when the teacher removed the activity; null otherwise (or before the migration). */
  removed_at: string | null;
};

export function getReadingActivityError(error: unknown): string {
  const detail = typeof error === "object" && error !== null ? error : {};
  const code = "code" in detail ? String(detail.code) : "";
  const text = ["message", "details"].map(key => key in detail ? String(detail[key as keyof typeof detail]) : "").join(" ");
  if (code === "23505") return "This reading activity has already been assigned to one or more selected students. Choose students who do not already have it.";
  if (code === "42501") return "You do not have permission to assign this activity. Check that you are an approved teacher and own this classroom and material.";
  if (code === "23514") return "The selected question set is not reviewed or does not belong to this material. Reload the question sets and choose a reviewed one.";
  if (code === "23503" && text.includes("question_set")) return "The selected question set no longer exists. Reload the question sets and choose another one.";
  if (code === "23503") return "The classroom, reading material, or student is no longer available. Refresh the classroom and try again.";
  if (["42P01", "42703", "PGRST204", "PGRST205"].includes(code)) return "Reading activity assignment is unavailable because the database setup is incomplete. Please contact your administrator.";
  if (["PGRST301", "PGRST303"].includes(code)) return "Your session has expired. Please sign in again.";
  if (error instanceof ReadingActivityValidationError) return error.message;
  const message = "message" in detail ? String(detail.message) : "";
  return `Unable to assign reading activity. Please try again.${message ? " " + message : ""}${code ? ` Error code: ${code}.` : ""}`;
}

class ReadingActivityValidationError extends Error {}

export async function getClassroomReadingActivities(roomId: string): Promise<ReadingActivityAssignment[]> {
  const { data, error } = await supabase.from("reading_activity_assignments")
    .select("*")
    .eq("room_id", roomId).order("assigned_at", { ascending: false });
  if (error) throw error;
  const rows = data ?? [];
  const setIds = [...new Set(rows.map(row => row.question_set_id).filter((id): id is string => Boolean(id)))];
  const names = new Map<string, string>();
  if (setIds.length) {
    // Names are display-only; the assignment list stays usable if they cannot be read.
    const { data: sets, error: setError } = await supabase.from("material_question_sets").select("id, name").in("id", setIds);
    if (setError) console.error("Unable to load question set names:", setError);
    for (const set of sets ?? []) names.set(set.id, set.name);
  }
  return rows.map(row => ({
    ...row,
    question_set_id: row.question_set_id ?? null,
    question_set_name: row.question_set_id ? names.get(row.question_set_id) ?? null : null,
    removed_at: optionalColumn(row, "removed_at"),
  })) as ReadingActivityAssignment[];
}

/**
 * Converts the optional date-time field (local time, "YYYY-MM-DDTHH:mm") to an ISO timestamp.
 * Empty means no deadline. Deadlines are informational: late work is never blocked.
 */
// Classroom deadlines use Philippine time (Asia/Manila, UTC+8, no daylight saving),
// whatever time zone the teacher's or student's device uses.
export const DUE_DATE_TIME_ZONE = "Asia/Manila";
const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;
const LOCAL_DATE_TIME = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(:\d{2})?$/;

/**
 * New deadlines only: a datetime-local value ("2026-11-09T15:30") is read as Philippine
 * time and must be later than now, including a time that has already passed today.
 * Saved deadlines are never re-validated, so existing past deadlines are kept.
 */
export function parseOptionalDueDate(value: string, now: Date = new Date()): string | null {
  const text = value.trim();
  if (!text) return null;
  const local = LOCAL_DATE_TIME.exec(text);
  const due = new Date(local ? `${local[1]}T${local[2]}${local[3] ?? ":00"}+08:00` : text);
  if (Number.isNaN(due.getTime())) {
    throw new ReadingActivityValidationError("Enter a valid due date and time, or leave it empty.");
  }
  if (due.getTime() <= now.getTime()) {
    throw new ReadingActivityValidationError(
      "This due date and time has already passed. Choose a date and time in the future (Philippine time), or leave it empty.",
    );
  }
  return due.toISOString();
}

/** Insert-time check for a new assignment's ISO deadline (a form may stay open until it passes). */
function assertNewDueDate(dueAt: string | null, now: Date = new Date()) {
  if (dueAt === null) return;
  if (Number.isNaN(Date.parse(dueAt))) {
    throw new ReadingActivityValidationError("Enter a valid due date and time, or leave it empty.");
  }
  parseOptionalDueDate(dueAt, now);
}

/** The current Philippine date and time as a datetime-local value, used as the picker's minimum. */
export function currentDueDateMinimum(now: Date = new Date()): string {
  return new Date(now.getTime() + MANILA_OFFSET_MS).toISOString().slice(0, 16);
}

/** Inline message for a typed deadline, or "" when it is empty or valid. */
export function dueDateIssue(value: string, now: Date = new Date()): string {
  try {
    parseOptionalDueDate(value, now);
    return "";
  } catch (err) {
    return err instanceof Error ? err.message : "Enter a valid due date and time, or leave it empty.";
  }
}

/** Due date and time in Philippine time, e.g. "Nov 9, 2026, 3:30 PM". */
export function formatDueDateTime(dueAt: string, locale?: string): string {
  return new Date(dueAt).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short", timeZone: DUE_DATE_TIME_ZONE });
}

export async function assignReadingActivity(
  roomId: string,
  materialId: string,
  studentIds: string[],
  dueAt: string | null = null,
  questionSetId: string | null = null
): Promise<void> {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(roomId)) throw new ReadingActivityValidationError("The classroom is invalid. Reopen it from Learning Rooms.");
  if (!uuid.test(materialId)) throw new ReadingActivityValidationError("Please select a valid reading material.");
  if (questionSetId !== null && !uuid.test(questionSetId)) throw new ReadingActivityValidationError("Please select a valid question set, or choose read-aloud only.");
  assertNewDueDate(dueAt);
  const uniqueStudentIds = [...new Set(studentIds)];
  if (!uniqueStudentIds.length || uniqueStudentIds.some(id => !uuid.test(id))) {
    throw new ReadingActivityValidationError("Please select at least one valid enrolled student.");
  }
  const user = await getAuthenticatedUser(
    () => new ReadingActivityValidationError("Your session has expired. Please sign in again.")
  );

  // Validate current records rather than trusting a possibly stale classroom picker.
  // RLS and the existing unique constraint remain authoritative at insert time.
  const [room, material, enrollments, existing] = await Promise.all([
    supabase.from("rooms").select("id, teacher_id").eq("id", roomId).maybeSingle(),
    supabase.from("uploaded_materials").select("id, uploaded_by, extraction_status").eq("id", materialId).maybeSingle(),
    supabase.from("enrollments").select("student_id").eq("room_id", roomId).in("student_id", uniqueStudentIds),
    supabase.from("reading_activity_assignments").select("*").eq("room_id", roomId).eq("material_id", materialId).in("student_id", uniqueStudentIds),
  ]);
  for (const result of [room, material, enrollments, existing]) {
    if (result.error) throw result.error;
  }
  if (!room.data || room.data.teacher_id !== user.id) {
    throw new ReadingActivityValidationError("This classroom is unavailable or belongs to another teacher. Reopen your classroom from Learning Rooms.");
  }
  if (!material.data || material.data.uploaded_by !== user.id || material.data.extraction_status !== "completed") {
    throw new ReadingActivityValidationError("Select a completed reading material from your own uploads.");
  }
  if (uniqueStudentIds.some(id => !enrollments.data?.some(row => row.student_id === id))) {
    throw new ReadingActivityValidationError("One or more selected students are no longer enrolled in this classroom. Refresh and select the students again.");
  }
  const unassignedStudentIds = uniqueStudentIds.filter(id => !existing.data?.some(row => row.student_id === id));
  if (!unassignedStudentIds.length) {
    if (existing.data?.some(row => optionalColumn(row, "removed_at"))) {
      throw new ReadingActivityValidationError("This reading activity was removed earlier for one or more selected students. Use Restore in the activity list to assign it again.");
    }
    throw new ReadingActivityValidationError(getReadingActivityError({ code: "23505" }));
  }

  const assignments = unassignedStudentIds.map((studentId) => ({
    room_id: roomId,
    material_id: materialId,
    student_id: studentId,
    assigned_by: user.id,
    due_at: dueAt,
    status: "assigned",
    // The database trigger accepts only a reviewed set of this material.
    question_set_id: questionSetId,
    read_aloud_only: questionSetId === null,
  }));

  const { error } = await supabase
    .from("reading_activity_assignments")
    .insert(assignments);

  if (error) throw error;
}
// ==========================
// STUDENT READING ACTIVITIES
// ==========================

export type StudentReadingActivity = {
  assignment_id: string;
  material_id: string;
  title: string;
  language?: string | null;
  assigned_at: string;
  due_at: string | null;
  status: "assigned" | "in_progress" | "completed";
  /** True when the teacher attached a question set to this activity. */
  has_questions: boolean;
};

export async function getStudentReadingActivities(
  roomId: string
): Promise<StudentReadingActivity[]> {
  const user = await getAuthenticatedUser(() => new Error("User not authenticated."));

  // Get only the logged-in student's assignments
  // for the selected classroom.
  const { data: rows, error: assignmentError } =
    await supabase
      .from("reading_activity_assignments")
      .select("*")
      .eq("room_id", roomId)
      .eq("student_id", user.id)
      .order("assigned_at", { ascending: false });
  // Activities the teacher removed are no longer active; their results stay in history.
  const assignments = (rows ?? []).filter((row) => !optionalColumn(row, "removed_at"));

  if (assignmentError) {
    console.error(
      "Error fetching student reading activities:",
      assignmentError
    );
    throw assignmentError;
  }

  if (!assignments || assignments.length === 0) {
    return [];
  }

  const materialIds = assignments.map(
    (assignment) => assignment.material_id
  );

  // Get the material titles separately.
  // This also keeps the query simple with the existing RLS setup.
  const { data: materials, error: materialError } =
    await supabase
      .from("uploaded_materials")
      .select("id, title, language")
      .in("id", materialIds);

  if (materialError) {
    console.error(
      "Error fetching assigned reading materials:",
      materialError
    );
    throw materialError;
  }

  return assignments.map((assignment) => {
    const material = materials?.find(
      (item) => item.id === assignment.material_id
    );

    return {
      assignment_id: assignment.id,
      material_id: assignment.material_id,
      title: material?.title ?? "Reading Activity",
      language: material?.language,
      assigned_at: assignment.assigned_at,
      due_at: assignment.due_at,
      status: assignment.status as StudentReadingActivity["status"],
      has_questions: Boolean(assignment.question_set_id),
    };
  });
}
// ==========================
// STUDENT ASSIGNED MATERIAL
// ==========================

export type StudentAssignedReadingMaterial = {
  id: string;
  title: string;
  language: string;
  content_text: string | null;
};

export async function getStudentAssignedReadingMaterial(
  materialId: string
): Promise<StudentAssignedReadingMaterial> {
  await getAuthenticatedUser(() => new Error("User not authenticated."));

  const { data, error } = await supabase
    .from("uploaded_materials")
    .select("id, title, language, content_text")
    .eq("id", materialId)
    .single();

  if (error) {
    console.error(
      "Error fetching assigned reading material:",
      error
    );
    throw error;
  }

  return data as StudentAssignedReadingMaterial;
}
// ==========================
// STUDENT ACTIVITY STATUS
// ==========================

export async function updateReadingActivityStatus(
  assignmentId: string,
  status: "in_progress" | "completed"
): Promise<void> {
  const { data: userData, error: userError } =
    await supabase.auth.getUser();

  if (userError) {
    throw userError;
  }

  const user = userData.user;

  if (!user) {
    throw new Error("User not authenticated.");
  }

  const { error } = await supabase
    .from("reading_activity_assignments")
    .update({
      status,
    })
    .eq("id", assignmentId)
    .eq("student_id", user.id);

  if (error) {
    console.error(
      "Error updating reading activity status:",
      error
    );

    throw error;
  }
}
