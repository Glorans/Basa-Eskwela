import api from "../../../services/api";
import { getSessionAuthHeaders } from "../../../services/authHeaders";

/** Room id -> assigned Teacher's full name, or null when the name is unavailable. */
export type RoomTeacherNames = Record<string, string | null>;

/**
 * The full name of the Teacher assigned to each Learning Room the signed-in Student is enrolled in.
 * Students cannot read Teacher profiles directly (RLS), so the backend answers for the Student's own
 * enrolled rooms only and returns just the display name.
 */
export async function getStudentRoomTeacherNames(): Promise<RoomTeacherNames> {
  const headers = await getSessionAuthHeaders("Your session could not be verified. Please sign in again and retry.");
  const { data } = await api.get<{ rooms?: { roomId: string; teacherName: string | null }[] }>("/api/classrooms/teachers", { headers });
  return Object.fromEntries((data.rooms ?? []).map((room) => [room.roomId, room.teacherName?.trim() || null]));
}
