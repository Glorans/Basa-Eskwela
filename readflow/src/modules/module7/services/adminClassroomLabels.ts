import type { AdminSystemData } from './m7Service';

export interface AdminRoomLabel {
  id: string; name: string; teacherName: string; roomCode?: string; label: string;
}
type RoomDetail = { id: string; room_code: string };
/** Only enrich IDs already returned by the authorized analytics response. No metric mutation. */
export async function loadAdminClassroomLabels(
  details: AdminSystemData['details'],
  loadRoom: (id: string) => Promise<RoomDetail>,
  previous: AdminRoomLabel[] = [],
): Promise<AdminRoomLabel[]> {
  const rooms = details.classroomOptions.map(option => {
    const comparison = details.classroomComparisons.find(room => room.id === option.id);
    const cached = previous.find(room => room.id === option.id);
    return { id: option.id, name: option.name, teacherName: comparison?.teacherName ?? cached?.teacherName ?? 'Teacher unavailable', roomCode: cached?.roomCode, label: '' };
  });
  const base = (room: typeof rooms[number]) => `${room.name} \u2014 ${room.teacherName}`;
  const duplicates = rooms.filter(room => rooms.some(other => other.id !== room.id && base(other) === base(room)));
  await Promise.all(duplicates.map(async room => {
    if (room.roomCode) return;
    try {
      const detail = await loadRoom(room.id);
      // Ignore mismatched responses and database identifiers masquerading as codes.
      if (detail.id === room.id && /^[a-z0-9]{4,12}$/i.test(detail.room_code)) room.roomCode = detail.room_code;
    } catch { /* Analytics remain usable when optional room metadata is unavailable. */ }
  }));
  return rooms.map(room => {
    const peers = rooms.filter(other => base(other) === base(room));
    let label = base(room);
    if (peers.length > 1) {
      if (room.roomCode && peers.filter(other => other.roomCode === room.roomCode).length === 1) label += ` \u00b7 Room ${room.roomCode}`;
      else label += ` \u00b7 Classroom ${peers.findIndex(other => other.id === room.id) + 1} (room code unavailable)`;
    }
    return { ...room, label };
  });
}
