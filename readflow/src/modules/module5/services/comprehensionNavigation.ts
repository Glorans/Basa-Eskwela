import type { LearnerM5Role, OralReadingAttempt } from "../types/oralReading.ts";

export function comprehensionTargetForReading(role: LearnerM5Role, attempt: Pick<OralReadingAttempt,
  "id" | "moduleId" | "materialId" | "passageId" | "roomId" | "assignmentId" | "activityAssignmentId" | "readAloudOnly">) {
  // Admin self-practice (Appendix N M6 for Admin): module readings outside any classroom only.
  // The server also requires the module to be published and created by this Admin.
  if (role === "admin") {
    if (attempt.materialId || attempt.roomId || attempt.assignmentId || attempt.activityAssignmentId || !attempt.moduleId || !attempt.passageId) return null;
    return `/admin/oral-reading/modules/${encodeURIComponent(attempt.moduleId)}/comprehension?${new URLSearchParams({
      passageId: attempt.passageId, oralReadingAttemptId: attempt.id,
    })}`;
  }
  if (attempt.materialId && attempt.readAloudOnly === true) return null;
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
  const root = role === "admin" ? "/admin" : role === "student" ? "/dashboard" : "/m3/general";
  return `${root}/read-aloud/results/${encodeURIComponent(oralReadingAttemptId)}`;
}

/**
 * A saved M6 activity: Students have a results route; Independent Learners and Admin
 * practice see results on the activity page.
 */
export function comprehensionResultTarget(role: LearnerM5Role, comprehensionAttemptId: string) {
  const id = encodeURIComponent(comprehensionAttemptId);
  return role === "student" ? `/dashboard/comprehension/${id}/results`
    : role === "admin" ? `/admin/comprehension/${id}`
      : `/m3/general/comprehension/${id}`;
}

/**
 * Where a reading came from, for the M5 result's back link and the M6 results'
 * "Back to Learning Room": its Learning Room when it has one, otherwise its
 * Reading Module (Students' My Materials or the Independent Learner catalog).
 */
export function learningAreaTarget(role: LearnerM5Role, source?: {
  moduleId?: string | null; materialId?: string | null; passageId?: string | null; roomId?: string | null;
} | null): { to: string; kind: "room" | "module" } {
  const moduleRoot = role === "admin" ? "/admin/oral-reading/modules" : role === "student" ? "/dashboard/materials" : "/m3/general/modules";
  // Admin practice has no module-detail page; return to the passage list.
  if (role === "admin") return { to: "/admin/oral-reading", kind: "module" };
  if (source?.roomId && (source.materialId || role === "student")) return { to: `/dashboard/learning-rooms/${source.roomId}`, kind: "room" };
  if (!source) return { to: moduleRoot, kind: "module" };
  return {
    to: `${moduleRoot}/${source.moduleId}?${new URLSearchParams(source.passageId ? { passageId: source.passageId } : {}).toString()}`,
    kind: "module",
  };
}
