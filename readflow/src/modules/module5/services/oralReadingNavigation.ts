import type { LearnerM5Role, OralReadingContext } from "../types/oralReading.ts";

export function readAloudTarget(role: LearnerM5Role, moduleId: string, context: OralReadingContext) {
  const params = new URLSearchParams();
  if (context.passageId) params.set("passageId", context.passageId);
  if (context.roomId) params.set("roomId", context.roomId);
  if (context.assignmentId) params.set("assignmentId", context.assignmentId);
  const root = role === "admin" ? "/admin/oral-reading/modules"
    : role === "student" ? "/dashboard/materials" : "/m3/general/modules";
  return `${root}/${encodeURIComponent(moduleId)}/read-aloud?${params}`;
}
