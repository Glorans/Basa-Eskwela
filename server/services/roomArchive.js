// Archived learning rooms are read-only (M4). Saving a reading, a recording, a pronunciation check or an
// answer for an archived room's activity is refused here, before any scoring work, with a clear message.
// The database enforces the same rule for every writer (m4_room_archive and
// m4_archived_room_readonly_v1 triggers, code 55000); this is the early, friendly check, and it is
// repeated on every request, so a tab opened before the room was archived cannot submit afterwards.
// Reading a story or a saved result is never blocked.

const ARCHIVED_CLASSROOM_MESSAGE =
  "This classroom is archived. You can still read the story and see your saved results, but new readings and answers cannot be submitted.";
const ARCHIVED_CLASSROOM_CODE = "CLASSROOM_ARCHIVED";
// Before m4_room_archive the column does not exist: no room can be archived.
const COLUMN_MISSING = new Set(["42703", "PGRST204"]);

/** True when the activity belongs to an archived room. Independent Learner and Admin practice have no room. */
async function isRoomArchived(db, roomId) {
  if (!roomId) return false;
  const { data, error } = await db.from("rooms").select("archived_at").eq("id", roomId).maybeSingle();
  if (error) {
    if (COLUMN_MISSING.has(error.code)) return false;
    const failure = new Error("Unable to check the classroom.");
    failure.statusCode = 503;
    throw failure;
  }
  return Boolean(data?.archived_at);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * True when a reading's classroom context points to an archived room. The room comes from the trusted
 * assignment rows (activityAssignmentId, assignmentId) as well as roomId, so a page cannot pick another room.
 * Used before costly work such as speech-to-text; without a classroom context nothing is blocked (Independent
 * Learner and Admin practice), and saving is checked again on the server anyway.
 */
async function isArchivedReadingContext(db, context = {}) {
  const rooms = new Set();
  if (UUID.test(context.roomId ?? "")) rooms.add(context.roomId);
  for (const [table, id] of [["reading_activity_assignments", context.activityAssignmentId], ["room_modules", context.assignmentId]]) {
    if (!UUID.test(id ?? "")) continue;
    const { data, error } = await db.from(table).select("room_id").eq("id", id).maybeSingle();
    if (error && !COLUMN_MISSING.has(error.code)) {
      const failure = new Error("Unable to check the classroom.");
      failure.statusCode = 503;
      throw failure;
    }
    if (data?.room_id) rooms.add(data.room_id);
  }
  for (const room of rooms) if (await isRoomArchived(db, room)) return true;
  return false;
}

/** The database refused a write because the room is archived (a request that raced the Archive). */
function isArchivedRoomDatabaseError(error) {
  return error?.code === "55000" && /archived/i.test(String(error?.message ?? ""));
}

module.exports = { ARCHIVED_CLASSROOM_CODE, ARCHIVED_CLASSROOM_MESSAGE, isArchivedReadingContext, isArchivedRoomDatabaseError, isRoomArchived };
