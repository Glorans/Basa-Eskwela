// A learning room card for the Teacher (active list and Archived Classrooms). Optional extra actions go under "View Classroom".
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { isRoomArchived, type Classroom } from "../services/classroomService";

export default function RoomCard({ room, children }: { room: Classroom; children?: ReactNode }) {
  return (
    <article
      className="flex min-h-[260px] flex-col rounded-3xl bg-[#dce8e7] p-6 shadow-md transition duration-200 hover:-translate-y-1 hover:shadow-lg"
    >
      {/* Card Top */}
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#f7cf4a] text-2xl">
          📖
        </div>

        {isRoomArchived(room) && (
          <span className="rounded-full bg-[#5c7471] px-3 py-1 text-xs font-bold text-white">Archived</span>
        )}
        {room.section && (
          <span className="rounded-full bg-[#ef7468] px-3 py-1 text-xs font-bold text-white">
            {room.section}
          </span>
        )}
      </div>

      {/* Room Information */}
      <h3 className="text-xl font-extrabold text-[#173f3b]">
        {room.room_name}
      </h3>

      {room.description?.trim() && room.description.trim().toLowerCase() !== "none" && (
        <p className="mt-2 line-clamp-2 text-sm leading-6 text-[#5c7471]">
          {room.description}
        </p>
      )}

      {/* Room Code */}
      <div className="mt-5 rounded-2xl bg-white/70 px-4 py-3">
        <p className="text-xs font-bold uppercase tracking-wide text-[#6d8582]">
          Room Code
        </p>

        <p className="mt-1 text-xl font-black tracking-[0.15em] text-[#173f3b]">
          {room.room_code}
        </p>
      </div>

      {/* View Button */}
      <div className="mt-auto pt-5">
        <Link
          to={`/m3/teacher/learning-rooms/${room.id}`}
          className="block w-full rounded-xl bg-[#f7cf4a] px-4 py-3 text-center text-sm font-extrabold text-[#173f3b] transition hover:bg-[#f2c83a]"
        >
          View Classroom
        </Link>
        {children}
      </div>
    </article>
  );
}
