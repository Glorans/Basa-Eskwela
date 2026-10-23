export interface AssessmentRoom { id: string; name: string }

// The backend attributes a quiz only by its saved room; no room means independent work.
export function isIndependentAssessment(record: { roomId?: string | null }): boolean {
  return record.roomId == null;
}

export function countIndependentAssessments(records: { roomId?: string | null }[]): number {
  return records.filter(isIndependentAssessment).length;
}

export function assessmentSourceNote(classroomFiltered: boolean, independentCount: number): string {
  if (classroomFiltered) return 'Classroom filter applied: independent comprehension assessments are excluded.';
  if (independentCount > 0) {
    return `Comprehension results include ${independentCount} independent ${independentCount === 1 ? 'assessment' : 'assessments'} completed outside a classroom by students currently enrolled in your classrooms. Select a classroom to exclude independent work.`;
  }
  return 'No independent comprehension assessments are included; all comprehension results come from your classrooms.';
}

// Names come only from the Teacher's own classrooms; an unmatched room keeps a generic label.
export function assessmentSourceLabel(record: { roomId?: string | null }, rooms: AssessmentRoom[]): string {
  if (isIndependentAssessment(record)) return 'Independent';
  const name = rooms.find(room => room.id === record.roomId)?.name;
  return name ? `Classroom: ${name}` : 'Classroom';
}
