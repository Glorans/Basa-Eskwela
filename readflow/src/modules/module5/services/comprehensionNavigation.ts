import type { LearnerM5Role, OralReadingAttempt } from "../types/oralReading.ts";
import { PRACTICE_PATHS, isPracticeRole } from "./oralReadingNavigation.ts";

// Re-exported so the shared M5/M6 pages reach the practice helpers through the module they already use.
export { PRACTICE_PATHS, isPracticeRole };

export function comprehensionTargetForReading(role: LearnerM5Role, attempt: Pick<OralReadingAttempt,
  "id" | "moduleId" | "materialId" | "passageId" | "roomId" | "assignmentId" | "activityAssignmentId" | "readAloudOnly">) {
  // Admin and approved-Teacher self-practice: module readings outside any classroom only.
  // The server also requires the module to be published (and, for an Admin, created by this Admin).
  if (isPracticeRole(role)) {
    if (attempt.materialId || attempt.roomId || attempt.assignmentId || attempt.activityAssignmentId || !attempt.moduleId || !attempt.passageId) return null;
    return `${PRACTICE_PATHS[role].modules}/${encodeURIComponent(attempt.moduleId)}/comprehension?${new URLSearchParams({
      passageId: attempt.passageId, oralReadingAttemptId: attempt.id,
    })}`;
  }
  if (attempt.materialId && attempt.readAloudOnly === true) return null;
  if (attempt.materialId && role === "general_user" && !attempt.roomId && !attempt.activityAssignmentId) {
    return `/m3/general/materials/${encodeURIComponent(attempt.materialId)}/comprehension?${new URLSearchParams({ oralReadingAttemptId: attempt.id })}`;
  }
  if (attempt.materialId) {
    if (role !== "student" || !attempt.roomId || !attempt.activityAssignmentId || attempt.moduleId) return null;
    return `/dashboard/reading-materials/${encodeURIComponent(attempt.materialId)}/comprehension?${new URLSearchParams({
      roomId: attempt.roomId, activityAssignmentId: attempt.activityAssignmentId, oralReadingAttemptId: attempt.id,
    })}`;
  }
  if (!attempt.moduleId || !attempt.passageId) return null;
  const root = role === "student" ? "/dashboard/materials" : "/m3/general/modules";
  return `${root}/${encodeURIComponent(attempt.moduleId)}/comprehension?${new URLSearchParams({
    passageId: attempt.passageId, oralReadingAttemptId: attempt.id,
    ...(attempt.roomId ? { roomId: attempt.roomId } : {}),
    ...(attempt.assignmentId ? { assignmentId: attempt.assignmentId } : {}),
  })}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The saved M5 reading result. Null unless the saved link is a valid ID, so a broken link is never followed. */
export function readingResultTarget(role: LearnerM5Role, oralReadingAttemptId: string | null | undefined) {
  if (!oralReadingAttemptId || !UUID.test(oralReadingAttemptId)) return null;
  const root = isPracticeRole(role) ? PRACTICE_PATHS[role].root : role === "student" ? "/dashboard" : "/m3/general";
  return `${root}/read-aloud/results/${encodeURIComponent(oralReadingAttemptId)}`;
}

/**
 * A saved M6 activity: Students have a results route; Independent Learners and Admin/Teacher
 * practice see results on the activity page.
 */
export function comprehensionResultTarget(role: LearnerM5Role, comprehensionAttemptId: string) {
  const id = encodeURIComponent(comprehensionAttemptId);
  return role === "student" ? `/dashboard/comprehension/${id}/results`
    : isPracticeRole(role) ? `${PRACTICE_PATHS[role].root}/comprehension/${id}`
      : `/m3/general/comprehension/${id}`;
}

/**
 * Where a reading came from, for the M5 result's back link and the M6 results'
 * "Back to Learning Room": its Learning Room when it has one, otherwise its
 * Reading Module (Students' My Materials or the Independent Learner catalog).
 */
export function learningAreaTarget(role: LearnerM5Role, source?: {
  moduleId?: string | null; materialId?: string | null; passageId?: string | null; roomId?: string | null;
} | null): { to: string; kind: "room" | "module" | "material" } {
  const moduleRoot = role === "student" ? "/dashboard/materials" : "/m3/general/modules";
  // Admin and Teacher practice have no module-detail page; return to the practice passage list.
  if (isPracticeRole(role)) return { to: PRACTICE_PATHS[role].list, kind: "module" };
  if (source?.roomId && (source.materialId || role === "student")) return { to: `/dashboard/learning-rooms/${source.roomId}`, kind: "room" };
  if (role === "general_user" && source?.materialId && !source.roomId) return { to: `/m3/general/materials/${encodeURIComponent(source.materialId)}`, kind: "material" };
  if (!source) return { to: moduleRoot, kind: "module" };
  return {
    to: `${moduleRoot}/${source.moduleId}?${new URLSearchParams(source.passageId ? { passageId: source.passageId } : {}).toString()}`,
    kind: "module",
  };
}
