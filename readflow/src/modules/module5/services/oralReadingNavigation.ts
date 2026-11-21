import type { LearnerM5Role, OralReadingContext, PracticeRole } from "../types/oralReading.ts";

/** System Admin, School Admin and approved-Teacher self-practice: published modules outside any classroom, own results only. */
export function isPracticeRole(role: LearnerM5Role): role is PracticeRole {
  return role === "admin" || role === "teacher" || role === "system_admin";
}

/** Admin workspaces (System Admin, School Admin) keep their M5/M6 screens in English. */
export function isAdminPracticeRole(role: LearnerM5Role) {
  return role === "admin" || role === "system_admin";
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
  system_admin: {
    list: "/system-admin/practice",
    modules: "/system-admin/practice/modules",
    root: "/system-admin/practice",
    history: "/system-admin/practice/history",
  },
};

/** M6 F5: the read-only assessment preview of one module passage (same context the reading would use). */
export function comprehensionPreviewTarget(role: LearnerM5Role, moduleId: string, context: OralReadingContext) {
  const params = new URLSearchParams();
  if (context.passageId) params.set("passageId", context.passageId);
  if (context.roomId) params.set("roomId", context.roomId);
  if (context.assignmentId) params.set("assignmentId", context.assignmentId);
  const root = isPracticeRole(role) ? PRACTICE_PATHS[role].modules
    : role === "student" ? "/dashboard/materials" : "/m3/general/modules";
  return `${root}/${encodeURIComponent(moduleId)}/preview?${params}`;
}

export function readAloudTarget(role: LearnerM5Role, moduleId: string, context: OralReadingContext) {
  const params = new URLSearchParams();
  if (context.passageId) params.set("passageId", context.passageId);
  if (context.roomId) params.set("roomId", context.roomId);
  if (context.assignmentId) params.set("assignmentId", context.assignmentId);
  const root = isPracticeRole(role) ? PRACTICE_PATHS[role].modules
    : role === "student" ? "/dashboard/materials" : "/m3/general/modules";
  return `${root}/${encodeURIComponent(moduleId)}/read-aloud?${params}`;
}
