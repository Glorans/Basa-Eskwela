import type { LearnerM5Role, OralReadingAttempt } from "../types/oralReading.ts";

export function comprehensionTargetForReading(role: LearnerM5Role, attempt: Pick<OralReadingAttempt,
  "id" | "moduleId" | "materialId" | "passageId" | "roomId" | "assignmentId" | "activityAssignmentId" | "readAloudOnly">) {
  // Admin self-practice is read-aloud only; M6 comprehension stays learner-only.
  if (role === "admin") return null;
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
