import type { LearnerM5Role, OralReadingContext, PracticeRole } from "../types/oralReading.ts";

/** Admin and approved-Teacher self-practice: published modules outside any classroom, own results only. */
export function isPracticeRole(role: LearnerM5Role): role is PracticeRole {
  return role === "admin" || role === "teacher";
}

/**
 * Route roots of each practice workspace. Admin keeps its existing routes; Teacher practice lives
 * under /m3/teacher/practice, apart from the Teacher's review of Students' saved assessments.
 */
export const PRACTICE_PATHS: Record<PracticeRole, { list: string; modules: string; root: string; history: string }> = {
  admin: { list: "/admin/oral-reading", modules: "/admin/oral-reading/modules", root: "/admin", history: "/admin/reading-history" },
  teacher: {
    list: "/m3/teacher/practice",
    modules: "/m3/teacher/practice/modules",
    root: "/m3/teacher/practice",
    history: "/m3/teacher/practice/history",
  },
};

export function readAloudTarget(role: LearnerM5Role, moduleId: string, context: OralReadingContext) {
  const params = new URLSearchParams();
  if (context.passageId) params.set("passageId", context.passageId);
  if (context.roomId) params.set("roomId", context.roomId);
  if (context.assignmentId) params.set("assignmentId", context.assignmentId);
  const root = isPracticeRole(role) ? PRACTICE_PATHS[role].modules
    : role === "student" ? "/dashboard/materials" : "/m3/general/modules";
  return `${root}/${encodeURIComponent(moduleId)}/read-aloud?${params}`;
}
