// M2 F9 — Assign Reassessment (classroom). Approved Teachers and School Admins only. Every rule is checked here AND
// again by the database guard (m2_guard_reassessment_assignment) on insert; frontend checks are only for clarity.
//
//   Teacher       own ACTIVE Learning Rooms; own published PRIVATE packages only (F10: no endorsement needed).
//   School Admin  every ACTIVE Learning Room of their OWN school (M1 multi-tenancy: the room's Teacher belongs to the
//                 school); their school's school-level packages only; assignments of their school's Students only. F10 (2026-11-21): a Teacher's private package is assigned only by that
//                 Teacher (also enforced by the database once m2_f10_direct_publish_PROPOSED.sql is applied).
//   Others        403 (System Admin, Students, Independent Learners, pending Teachers).
//
// School-level packages are NOT offered to Teachers: F10 keeps school packages invisible to Teachers. Whether Teachers
// may assign school packages is an open policy decision (reported), not decided here.
// Nothing here is live while the official reassessment gate is OFF: the database refuses every new assignment.
const { getProfileDisplayName } = require("./profileNames");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BATCH = 200;
const NOT_INSTALLED_CODES = new Set(["42P01", "PGRST205", "PGRST202", "42883"]);

class ReassessmentAssignmentError extends Error {
  constructor(message, statusCode = 500, code = "REASSESSMENT_FAILED", extra = {}) {
    super(message);
    this.name = "ReassessmentAssignmentError";
    this.statusCode = statusCode;
    this.code = code;
    Object.assign(this, extra);
  }
}
const fail = (message, statusCode, code, extra) => { throw new ReassessmentAssignmentError(message, statusCode, code, extra); };

async function run(work, fallback = "Unable to complete the reassessment request.") {
  try {
    return await work();
  } catch (error) {
    if (error instanceof ReassessmentAssignmentError) throw error;
    if (NOT_INSTALLED_CODES.has(error?.code)) {
      fail("Reassessment is not installed in this environment yet.", 503, "REASSESSMENT_NOT_INSTALLED");
    }
    if (error?.code === "23505") {
      fail("Another assignment for one of these Students was created at the same time. Nothing was assigned. Reload and try again.",
        409, "ASSIGNMENT_CONFLICT");
    }
    if (error?.code === "42501" || error?.code === "23502" || error?.code === "23514") {
      const notEnabled = /not enabled/i.test(error.message ?? "");
      fail(notEnabled ? "Official reassessment is not enabled yet. Nothing was assigned."
        : `The assignment was refused: ${error.message}. Nothing was assigned.`, 409, notEnabled ? "REASSESSMENT_NOT_ENABLED" : "ASSIGNMENT_REFUSED");
    }
    fail(fallback, 500);
  }
}

const manilaToday = (date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
const iso = (value) => (value instanceof Date ? value.toISOString() : value ?? null);
const nameOf = (p, fallback) => (p ? getProfileDisplayName({ role: p.role, nickname: p.nickname, fullName: p.full_name }) || fallback : fallback);

// M1 multi-tenancy: the ids among ids that belong to the School Admin's own school (read from the database profile).
const defaultSchoolFilter = async (requester, ids) => {
  const scope = require("./schoolScope");
  return scope.filterSchoolMembers(await scope.requireRequesterSchool(requester), ids);
};

function createReassessmentAssignmentService({ repository, now = () => new Date(), schoolFilter = defaultSchoolFilter } = {}) {
  if (!repository) throw new Error("A reassessment repository is required.");

  function requireAssigner(requester) {
    const profile = requester?.profile;
    const ok = requester?.user?.id && (profile?.role === "admin" || (profile?.role === "teacher" && profile?.teacher_status === "approved"));
    if (!ok) fail("Reassessment assignments are available to School Admins and approved Teachers only.", 403, "ASSIGNMENT_FORBIDDEN");
    return { actor: requester.user.id, role: profile.role };
  }

  const gateEnabled = async () => (await run(() => repository.getSettings()))?.official_reassessment_enabled === true;
  const authorizedRooms = async (actor, role, requester) => {
    const rooms = await run(() => repository.listActiveRooms(role === "teacher" ? { teacherId: actor } : {}));
    if (role === "teacher") return rooms;
    const teachers = await schoolFilter(requester, rooms.map((r) => r.teacher_id));
    return rooms.filter((r) => teachers.has(r.teacher_id));
  };

  async function people(ids) {
    const unique = [...new Set(ids.filter(Boolean))];
    return new Map((await run(() => repository.loadProfiles(unique))).map((p) => [p.id, p]));
  }

  /** Packages this account may assign, each with its published version and an explanation when not assignable. */
  async function assignablePackages(actor, role, room = null, requester = null) {
    const packages = await run(() => repository.listPackages(role === "teacher"
      ? { scopes: ["teacher"], ownerId: actor } : { scopes: ["school"] }));
    // Defense in depth: a Teacher only ever sees their own private packages; a School Admin only school packages of
    // their own school (the package owner belongs to the school).
    const schoolOwners = role === "teacher" ? null : await schoolFilter(requester, packages.map((p) => p.owner_id));
    const visible = packages.filter((p) => (role === "teacher" ? p.scope === "teacher" && p.owner_id === actor
      : p.scope === "school" && schoolOwners.has(p.owner_id)));
    const versions = await run(() => repository.listVersions(visible.map((p) => p.id)));
    const published = new Map(versions.filter((v) => v.status === "published").map((v) => [v.package_id, v]));
    const owners = role === "admin" ? await people(visible.filter((p) => p.scope === "teacher").map((p) => p.owner_id)) : new Map();
    return visible.map((pkg) => {
      const version = published.get(pkg.id) ?? null;
      const ownerName = pkg.scope === "teacher" && role === "admin" ? (pkg.owner_id ? nameOf(owners.get(pkg.owner_id), "Teacher") : "Removed account") : undefined;
      let reason = null;
      if (pkg.archived_at) reason = "Archived";
      else if (!version) reason = "Not published in the library";
      else if (room && pkg.scope === "teacher" && room.teacher_id !== pkg.owner_id) reason = `Only in ${ownerName ?? "the owning Teacher"}'s Learning Rooms`;
      // The package language must match the Learning Room's subject (English room -> English package). A legacy room
      // without a subject keeps the previous behaviour.
      else if (room && room.subject && room.subject !== pkg.language) reason = `For ${pkg.language === "fil" ? "Filipino" : "English"} Learning Rooms only`;
      return {
        packageId: pkg.id,
        versionId: version?.id ?? null,
        versionLabel: version?.version_label ?? null,
        title: pkg.title,
        category: pkg.scope === "teacher" ? "teacher" : "school",
        language: pkg.language,
        ...(ownerName ? { ownerName } : {}),
        eligible: reason === null,
        reason,
      };
    }).sort((a, b) => Number(b.eligible) - Number(a.eligible) || a.title.localeCompare(b.title));
  }

  /** Per-student blockers across ALL rooms (one active per language; never the same version twice). */
  async function studentState(studentIds) {
    const existing = await run(() => repository.listAssignments({ studentIds, statuses: ["active", "completed"] }));
    const state = new Map(studentIds.map((id) => [id, { activeLanguages: new Set(), versionIds: new Set() }]));
    for (const a of existing) {
      const s = state.get(a.student_id);
      if (!s) continue;
      if (a.status === "active") s.activeLanguages.add(a.language);
      s.versionIds.add(a.package_version_id);
    }
    return state;
  }
  const blocker = (s, pkg) => (s.versionIds.has(pkg.versionId) ? "Already assigned this package version"
    : s.activeLanguages.has(pkg.language) ? `Already has an active ${pkg.language === "fil" ? "Filipino" : "English"} reassessment` : null);

  async function roomStudents(room) {
    const enrollments = await run(() => repository.listEnrollments([room.id]));
    const profiles = await people(enrollments.map((e) => e.student_id));
    return enrollments.map((e) => profiles.get(e.student_id)).filter((p) => p?.role === "student")
      .map((p) => ({ id: p.id, name: nameOf(p, "Student") })).sort((a, b) => a.name.localeCompare(b.name));
  }

  async function overview(requester) {
    const { actor, role } = requireAssigner(requester);
    const enabled = await gateEnabled();
    const rooms = await authorizedRooms(actor, role, requester);
    const teachers = role === "admin" ? await people(rooms.map((r) => r.teacher_id)) : new Map();
    return {
      enabled,
      rooms: rooms.map((r) => ({ id: r.id, name: r.room_name, subject: r.subject ?? null,
        ...(role === "admin" ? { teacherName: nameOf(teachers.get(r.teacher_id), "Teacher") } : {}) }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      packages: await assignablePackages(actor, role, null, requester),
    };
  }

  async function loadRoom(actor, role, roomId, requester) {
    if (typeof roomId !== "string" || !UUID.test(roomId)) fail("Learning Room not found.", 404, "ROOM_NOT_FOUND");
    const room = (await authorizedRooms(actor, role, requester)).find((r) => r.id === roomId);
    // Not disclosed: another Teacher's room, an archived room and a missing room all look the same.
    if (!room) fail("Learning Room not found.", 404, "ROOM_NOT_FOUND");
    return room;
  }

  async function assignablePackagesForRoom(requester, roomId) {
    const { actor, role } = requireAssigner(requester);
    const room = roomId ? await loadRoom(actor, role, roomId, requester) : null;
    return { enabled: await gateEnabled(), packages: await assignablePackages(actor, role, room, requester) };
  }

  /** Students currently enrolled in the room, and for the chosen package whether each can receive it (and why not). */
  async function roomRoster(requester, roomId, packageVersionId) {
    const { actor, role } = requireAssigner(requester);
    const room = await loadRoom(actor, role, roomId, requester);
    const students = await roomStudents(room);
    const pkg = packageVersionId ? (await assignablePackages(actor, role, room, requester)).find((p) => p.versionId === packageVersionId) : null;
    if (packageVersionId && !pkg) fail("Package not found.", 404, "PACKAGE_NOT_FOUND");
    const state = await studentState(students.map((s) => s.id));
    return {
      room: { id: room.id, name: room.room_name },
      students: students.map((s) => ({ ...s, reason: pkg ? blocker(state.get(s.id), pkg) : null })),
    };
  }

  async function createAssignments(requester, body = {}) {
    const { actor, role } = requireAssigner(requester);
    if (!(await gateEnabled())) {
      fail("Official reassessment is not enabled yet. Assignments can be created only after it is switched on in a separate, approved step.",
        409, "REASSESSMENT_NOT_ENABLED");
    }
    const room = await loadRoom(actor, role, body.roomId, requester);
    if (typeof body.packageVersionId !== "string" || !UUID.test(body.packageVersionId)) fail("Choose a package.", 400, "PACKAGE_REQUIRED");
    const pkg = (await assignablePackages(actor, role, room, requester)).find((p) => p.versionId === body.packageVersionId);
    if (!pkg) fail("Package not found.", 404, "PACKAGE_NOT_FOUND"); // never reveals another Teacher's package
    if (!pkg.eligible) fail(`This package cannot be assigned here: ${pkg.reason}.`, 409, "PACKAGE_NOT_ELIGIBLE");
    if (!["en", "fil"].includes(pkg.language)) fail("The package language is not supported.", 400, "INVALID_LANGUAGE");

    let dueAt = null;
    if (body.dueDate !== undefined && body.dueDate !== null && body.dueDate !== "") {
      if (typeof body.dueDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.dueDate) || Number.isNaN(Date.parse(`${body.dueDate}T00:00:00Z`))) {
        fail("Use a valid due date.", 400, "INVALID_DUE_DATE");
      }
      if (body.dueDate < manilaToday(now())) fail("The due date cannot be in the past.", 400, "INVALID_DUE_DATE");
      dueAt = `${body.dueDate}T23:59:59+08:00`; // end of that day in the Philippines
    }

    // Snapshot of who is enrolled NOW. Students who enrol later are never added automatically.
    const enrolled = await roomStudents(room);
    const enrolledIds = new Set(enrolled.map((s) => s.id));
    const mode = body.mode === "all_eligible" ? "all_eligible" : "selected";
    let requested;
    if (mode === "all_eligible") {
      requested = enrolled.map((s) => s.id);
      if (!requested.length) fail("No Students are currently enrolled in this Learning Room.", 409, "NO_STUDENTS");
    } else {
      if (!Array.isArray(body.studentIds) || body.studentIds.length === 0) fail("Select at least one Student.", 400, "STUDENTS_REQUIRED");
      if (body.studentIds.some((id) => typeof id !== "string" || !UUID.test(id))) fail("A selected Student is invalid.", 400, "INVALID_STUDENT");
      requested = [...new Set(body.studentIds)];
    }
    if (requested.length > MAX_BATCH) fail(`Assign at most ${MAX_BATCH} Students at a time.`, 400, "BATCH_TOO_LARGE");

    const state = await studentState(requested);
    const names = new Map(enrolled.map((s) => [s.id, s.name]));
    const problems = requested.map((id) => ({
      studentId: id,
      name: names.get(id) ?? null,
      reason: !enrolledIds.has(id) ? "Not currently enrolled in this Learning Room" : blocker(state.get(id), pkg),
    })).filter((p) => p.reason);
    if (mode === "selected" && problems.length) {
      // All-or-nothing: no partial batch is ever created for a hand-picked list.
      fail("Some selected Students cannot receive this package. Nothing was assigned.", 409, "STUDENTS_INELIGIBLE", { ineligible: problems });
    }
    const targets = requested.filter((id) => !problems.some((p) => p.studentId === id));
    if (!targets.length) fail("No enrolled Student can receive this package. Nothing was assigned.", 409, "STUDENTS_INELIGIBLE", { ineligible: problems });

    const created = await run(() => repository.insertAssignments(targets.map((studentId) => ({
      package_version_id: pkg.versionId,
      package_id: pkg.packageId,
      language: pkg.language,
      kind: "classroom",
      room_id: room.id,
      student_id: studentId,
      assigned_by: actor,
      due_at: dueAt,
    }))));
    if (created.length !== targets.length) fail("The assignment could not be confirmed. Reload to check.", 500);
    return {
      created: created.length,
      // In "all eligible" mode the Students left out are reported explicitly, never silently skipped.
      skipped: mode === "all_eligible" ? problems : [],
      assignments: await present(created),
    };
  }

  async function present(list) {
    const [packages, versions, rooms] = await Promise.all([
      run(() => repository.loadPackages([...new Set(list.map((a) => a.package_id))])),
      run(() => repository.loadVersions([...new Set(list.map((a) => a.package_version_id))])),
      run(() => repository.loadRooms([...new Set(list.map((a) => a.room_id).filter(Boolean))])),
    ]);
    const byId = (rows) => new Map(rows.map((r) => [r.id, r]));
    const [pk, vs, rm] = [byId(packages), byId(versions), byId(rooms)];
    const who = await people(list.flatMap((a) => [a.student_id, a.assigned_by, a.cancelled_by]));
    return list.map((a) => ({
      id: a.id,
      status: a.status,
      language: a.language,
      packageTitle: pk.get(a.package_id)?.title ?? "Package",
      versionLabel: vs.get(a.package_version_id)?.version_label ?? null,
      roomId: a.room_id,
      roomName: a.room_id ? rm.get(a.room_id)?.room_name ?? "Learning Room" : "Deleted Learning Room",
      studentId: a.student_id,
      studentName: nameOf(who.get(a.student_id), "Student"),
      assignedBy: a.assigned_by ? nameOf(who.get(a.assigned_by), "Staff member") : "Removed account",
      assignedAt: iso(a.assigned_at),
      dueAt: iso(a.due_at),
      completedAt: iso(a.completed_at),
      cancelledAt: iso(a.cancelled_at),
      cancelledBy: a.cancelled_at ? (a.cancelled_by ? nameOf(who.get(a.cancelled_by), "Staff member") : "Removed account") : null,
      cancelReason: a.cancel_reason ?? null,
    })).sort((x, y) => String(y.assignedAt).localeCompare(String(x.assignedAt)));
  }

  async function listAssignments(requester, { status, roomId } = {}) {
    const { actor, role } = requireAssigner(requester);
    if (status !== undefined && !["active", "completed", "cancelled"].includes(status)) fail("Unknown status.", 400, "INVALID_STATUS");
    let list;
    if (role === "teacher") {
      const rooms = await authorizedRooms(actor, role, requester);
      const ids = roomId ? (rooms.some((r) => r.id === roomId) ? [roomId] : null) : rooms.map((r) => r.id);
      if (!ids) fail("Learning Room not found.", 404, "ROOM_NOT_FOUND");
      list = await run(() => repository.listAssignments({ roomIds: ids, ...(status ? { statuses: [status] } : {}) }));
    } else {
      if (roomId && (typeof roomId !== "string" || !UUID.test(roomId))) fail("Learning Room not found.", 404, "ROOM_NOT_FOUND");
      list = await run(() => repository.listAssignments({ ...(roomId ? { roomIds: [roomId] } : {}), ...(status ? { statuses: [status] } : {}) }));
      // M1 multi-tenancy: only assignments of the School Admin's own Students (each Student has one school).
      const students = await schoolFilter(requester, list.map((a) => a.student_id));
      list = list.filter((a) => students.has(a.student_id));
    }
    return { enabled: await gateEnabled(), assignments: await present(list) };
  }

  async function cancelAssignment(requester, assignmentId, body = {}) {
    const { actor, role } = requireAssigner(requester);
    if (typeof assignmentId !== "string" || !UUID.test(assignmentId)) fail("Assignment not found.", 404, "ASSIGNMENT_NOT_FOUND");
    const assignment = await run(() => repository.getAssignment(assignmentId));
    let allowed = Boolean(assignment && assignment.kind === "classroom");
    if (allowed && role === "teacher") {
      allowed = Boolean(assignment.room_id) && (await authorizedRooms(actor, role, requester)).some((r) => r.id === assignment.room_id);
    } else if (allowed) {
      allowed = (await schoolFilter(requester, [assignment.student_id])).has(assignment.student_id);
    }
    if (!allowed) fail("Assignment not found.", 404, "ASSIGNMENT_NOT_FOUND");
    if (assignment.status !== "active") fail("Only an active assignment can be cancelled.", 409, "ASSIGNMENT_NOT_ACTIVE");
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (!reason) fail("Add a reason for cancelling.", 400, "REASON_REQUIRED");
    if (reason.length > 500) fail("The reason is too long (at most 500 characters).", 400, "REASON_TOO_LONG");
    const updated = await run(() => repository.cancelAssignment(assignment.id, actor, reason));
    // A concurrent completion or cancellation already changed it: nothing is overwritten.
    if (!updated.length) fail("This assignment was already completed or cancelled.", 409, "ASSIGNMENT_NOT_ACTIVE");
    return { assignment: (await present(updated))[0] };
  }

  return { assignablePackagesForRoom, cancelAssignment, createAssignments, listAssignments, overview, roomRoster };
}

module.exports = { ReassessmentAssignmentError, createReassessmentAssignmentService, manilaToday };
