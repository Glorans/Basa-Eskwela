import type { AssignedReadingProgress } from "./oralReadingService.ts";

export function assignedReadingTarget(activity: Pick<AssignedReadingProgress,
  "roomId" | "materialId" | "activityAssignmentId"> & Partial<AssignedReadingProgress>) {
  if (activity.readAloudOnly === true && activity.oralReadingAttemptId) {
    return `/dashboard/read-aloud/results/${encodeURIComponent(activity.oralReadingAttemptId)}`;
  }
  if (activity.comprehensionAttemptId) return `/dashboard/comprehension/${encodeURIComponent(activity.comprehensionAttemptId)}`;
  // A saved reading opens its feedback first; that page links on to the questions.
  if (activity.oralReadingAttemptId) return `/dashboard/read-aloud/results/${encodeURIComponent(activity.oralReadingAttemptId)}`;
  const params = new URLSearchParams({ roomId: activity.roomId, activityAssignmentId: activity.activityAssignmentId });
  return `/dashboard/reading-materials/${encodeURIComponent(activity.materialId)}/read-aloud?${params}`;
}
