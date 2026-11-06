// Saved-response fixtures only. No database or network access.
export const rooms = [{ id: 'room-a', name: 'Grade 5' }, { id: 'room-b', name: 'Grade 5' }, { id: 'room-empty', name: 'Empty classroom' }];
const completionCounts = { totalAssignments: 4, completedAssignments: 2, incompleteAssignments: 2, inProgressAssignments: 1, notStartedAssignments: 1, completionRate: 50 };
const reading = { readingAttempts: 3, averagePronunciationAccuracy: 86.49, averageReadingSpeedWpm: 100.4, averageComprehensionScore: 75, completedComprehensionAttempts: 2 };
const noReading = { readingAttempts: 0, averagePronunciationAccuracy: null, averageReadingSpeedWpm: null, averageComprehensionScore: null, completedComprehensionAttempts: 0 };
export const classes = rooms.map((room, index) => ({ roomId: room.id, roomName: room.name, section: null,
  ...completionCounts, ...(index ? noReading : reading), enrolledStudents: index === 2 ? 0 : index + 1, studentsWithResults: index ? 0 : 1, attributionLimited: false }));
export const students = [
  { studentId: 'ana', studentName: 'Ana', classrooms: classes.slice(0, 2), ...completionCounts, ...reading },
  { studentId: 'ben', studentName: 'Ben', classrooms: classes.slice(1, 2), ...completionCounts, ...noReading },
];
export const teacherCompletion = { ...completionCounts, totalClassrooms: 3, classrooms: classes, students };
export const teacherAnalytics = { ...reading, totalReadingAttempts: 3, studentsWithResults: 1, independentComprehensionAttempts: 0 };
export const classPerformance = { totalClassrooms: 3, totalEnrolledStudents: 2, unattributedReadingAttempts: 0, classrooms: classes };
export const studentPerformance = { totalStudents: 2, students };
export const quizzes = { totalCompletedQuizzes: 0, studentsWithScores: 0, averageQuizScore: null, highestQuizScore: null, lowestQuizScore: null, independentQuizzes: 0, students: [] };
export const metrics = { readingAttempts: 3, completedQuizzes: 2, pronunciationAccuracy: 86.49, readingSpeedWpm: 100.4, comprehensionScore: 75 };
const adminCompletion = { assigned: 4, completed: 2, incomplete: 2, completionRate: 50 };
export const adminStudents = [
  { id: 'ana', name: 'Ana', classrooms: ['Grade 5', 'Grade 5'], classification: 'Early Warning', ...metrics, completion: adminCompletion },
  { id: 'ben', name: 'Ben', classrooms: ['Grade 5'], classification: 'No assessment data', ...metrics, readingAttempts: 0, completedQuizzes: 0, pronunciationAccuracy: null, readingSpeedWpm: null, comprehensionScore: null, completion: { assigned: 0, completed: 0, completionRate: null } },
  { id: 'not-enrolled', name: 'Not enrolled student', classrooms: [], classification: 'No assessment data', ...metrics, completion: adminCompletion },
];
export const memberships: Record<string, string[]> = { 'room-a': ['ana'], 'room-b': ['ana', 'ben', 'independent-account'], 'room-empty': [] };
export const adminSystem = { ...metrics, students: 3, teachers: 1, classrooms: 3, assignedActivities: 4, details: {
  filters: { roomId: null, startDate: null, endDate: null }, generatedAt: '2026-11-06T01:00:00Z', classroomOptions: rooms,
  performance: metrics, trends: [], independentPerformance: { ...metrics, readingAttempts: 0, completedQuizzes: 0 }, unassignedClassroomReadings: 0,
  classroomComparisons: rooms.map((room, index) => ({ ...room, teacherName: 'Teacher T', ...metrics, ...adminCompletion, readingAttempts: index + 1, enrolledStudents: index === 2 ? 0 : index + 1, participatingStudents: 1 })),
  participation: { students: 3, participatingStudents: 1, withoutRecordedActivity: 2, participationRate: 33.33 },
  completion: adminCompletion, riskCounts: { 'Early Warning': 1, 'No assessment data': 2 }, supportStudents: [],
} };
export function adminDetail(id: string) {
  const student = adminStudents.find(student => student.id === id);
  if (!student) throw Error('Student not authorized');
  return { ...student, competency: { literal: { total: 2, correct: 1, score: 50 }, inferential: { total: 0, correct: 0, score: null } },
    contexts: [], activities: [], quizzes: [], readings: [], historicalQuizzes: [], interventions: { own: [], others: { total: 0, planned: 0, inProgress: 0, completed: 0 } } };
}
