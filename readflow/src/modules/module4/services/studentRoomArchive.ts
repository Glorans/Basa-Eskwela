// Student-controlled ("personal") Learning Room archive: hides a joined room from the Student's own
// active list. Separate from the Teacher/Admin archive (rooms.archived_at): the shared room, the
// Teacher, other Students, assignments, results and XP never change. Backed by the proposed
// m4_student_room_archive migration; until it is installed, `supported` is false and nothing is shown.
import { supabase } from "../../../lib/supabaseClient";

export type StudentRoomArchives = { supported: boolean; roomIds: Set<string> };

/** PostgREST / PostgreSQL codes for "this table or function is not installed yet". */
const NOT_INSTALLED = new Set(["42P01", "42883", "PGRST202", "PGRST205"]);

/** Rooms the signed-in Student archived for themselves. RLS returns only the caller's own rows. */
export async function getMyArchivedRooms(): Promise<StudentRoomArchives> {
  const { data, error } = await supabase.from("m4_student_room_archives").select("room_id");
  if (error) {
    if (NOT_INSTALLED.has(error.code ?? "")) return { supported: false, roomIds: new Set() };
    throw error;
  }
  return { supported: true, roomIds: new Set((data ?? []).map((row) => row.room_id)) };
}

/** Archives (true) or restores (false) a joined room for the signed-in Student only. */
export async function setMyRoomArchived(roomId: string, archive: boolean): Promise<boolean> {
  const { data, error } = await supabase.rpc("m4_set_my_room_archived", { p_room_id: roomId, p_archive: archive });
  if (error) {
    console.error("Error changing the personal Learning Room archive:", error);
    if (error.code === "55000") throw new Error("Your teacher archived this Learning Room, so it can't be restored here.");
    if (error.code === "42501") throw new Error("You can archive or restore only Learning Rooms you have joined.");
    if (NOT_INSTALLED.has(error.code ?? "")) throw new Error("Archiving Learning Rooms isn't available yet.");
    throw new Error(`Unable to ${archive ? "archive" : "restore"} this Learning Room. Nothing was changed.`);
  }
  return data === true;
}
