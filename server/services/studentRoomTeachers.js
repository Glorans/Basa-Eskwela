// M4 Student Learning Rooms: the full name of the Teacher assigned to each room the signed-in
// Student is enrolled in. Students cannot read Teacher profiles through RLS, so the server answers
// for exactly their own enrolled rooms and returns only a display name (no ids, e-mail or other
// profile fields). rooms.teacher_id is the assigned Teacher, also for Admin-created rooms.
const { getAuthenticatedSupabaseUser, getSupabaseAdmin } = require("./supabaseAdmin");

class StudentRoomTeachersError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.statusCode = statusCode;
  }
}

// A usable full name, or null for a missing/placeholder value (never invented).
function teacherDisplayName(fullName) {
  const name = typeof fullName === "string" ? fullName.replace(/\s+/g, " ").trim() : "";
  if (!name || name.toLowerCase() === "new user") return null;
  return name;
}

async function listEnrolledRoomTeachers(req, dependencies = {}) {
  const user = await (dependencies.getAuthenticatedSupabaseUser ?? getAuthenticatedSupabaseUser)(req);
  const db = (dependencies.getSupabaseAdmin ?? getSupabaseAdmin)();

  const { data: profile, error: profileError } = await db.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profileError) throw new StudentRoomTeachersError("Unable to verify your account.");
  if (profile?.role !== "student") throw new StudentRoomTeachersError("Student access is required.", 403);

  const { data: enrollments, error: enrollmentError } = await db.from("enrollments").select("room_id").eq("student_id", user.id);
  if (enrollmentError) throw new StudentRoomTeachersError("Unable to load your learning rooms.");
  const roomIds = [...new Set((enrollments ?? []).map((row) => row.room_id).filter(Boolean))];
  if (!roomIds.length) return [];

  const { data: rooms, error: roomError } = await db.from("rooms").select("id, teacher_id").in("id", roomIds);
  if (roomError) throw new StudentRoomTeachersError("Unable to load your learning rooms.");
  const teacherIds = [...new Set((rooms ?? []).map((room) => room.teacher_id).filter(Boolean))];

  const names = new Map();
  if (teacherIds.length) {
    const { data: teachers, error: teacherError } = await db.from("profiles").select("id, full_name").in("id", teacherIds).eq("role", "teacher");
    if (teacherError) throw new StudentRoomTeachersError("Unable to load teacher names.");
    for (const teacher of teachers ?? []) names.set(teacher.id, teacherDisplayName(teacher.full_name));
  }

  // Only rooms the Student is enrolled in; only the name of that room's assigned Teacher.
  return (rooms ?? []).filter((room) => roomIds.includes(room.id))
    .map((room) => ({ roomId: room.id, teacherName: names.get(room.teacher_id) ?? null }));
}

module.exports = { StudentRoomTeachersError, listEnrolledRoomTeachers, teacherDisplayName };
