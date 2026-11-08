import type {
  TeacherComprehensionStatus,
  TeacherOralReadingAttemptSummary,
} from "../types/oralReading.ts";

export interface TeacherOralReadingFilters {
  searchQuery: string;
  learnerId: string;
  moduleId: string;
  comprehensionStatus?: TeacherComprehensionStatus | "";
  /** One classroom only (opened from that classroom's page, e.g. an archived classroom). */
  roomId?: string;
}

export function filterTeacherOralReadingAttempts(
  attempts: readonly TeacherOralReadingAttemptSummary[],
  filters: TeacherOralReadingFilters,
) {
  const query = filters.searchQuery.trim().toLocaleLowerCase();
  return attempts.filter((attempt) => (
    (!query
      || attempt.learnerName.toLocaleLowerCase().includes(query)
      || attempt.moduleTitle.toLocaleLowerCase().includes(query))
    && (!filters.learnerId || attempt.learnerId === filters.learnerId)
    && (!filters.moduleId || attempt.moduleId === filters.moduleId)
    && (!filters.comprehensionStatus || attempt.comprehension.status === filters.comprehensionStatus)
    && (!filters.roomId || attempt.roomId === filters.roomId)
  ));
}
