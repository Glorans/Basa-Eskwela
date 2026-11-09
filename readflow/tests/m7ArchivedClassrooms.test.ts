// M7 Teacher Analytics shows active classrooms only. Saved-response fixtures; no database or network.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { after, test } from 'node:test';
import { activeCompletion, activeRecords } from '../src/modules/module7/services/activeClassrooms.ts';
import type { TeacherCompletionAnalytics } from '../src/modules/module7/services/teacherAnalyticsService.ts';

// Ana is in active room "a" and archived room "b"; Ben is only in archived room "b".
const counts = (total: number, completed: number) => ({ totalAssignments: total, completedAssignments: completed, inProgressAssignments: 0,
  notStartedAssignments: total - completed, incompleteAssignments: total - completed, completionRate: total ? Math.round(completed / total * 10000) / 100 : null });
const room = (roomId: string, total: number, completed: number) => ({ roomId, roomName: roomId.toUpperCase(), ...counts(total, completed) });
const completion: TeacherCompletionAnalytics = {
  ...counts(10, 5), totalClassrooms: 2, classrooms: [room('a', 4, 3), room('b', 6, 2)],
  students: [
    { studentId: 'ana', ...counts(5, 3), classrooms: [room('a', 4, 3), room('b', 1, 0)] },
    { studentId: 'ben', ...counts(5, 2), classrooms: [room('b', 5, 2)] },
  ],
};
const reading = (id: string, learnerId: string, roomId: string | null, accuracy: number) => ({
  id, learnerId, learnerName: learnerId, roomId, pronunciationAccuracy: accuracy, readingSpeedWpm: accuracy,
  completedAt: '2026-11-03T02:00:00Z', comprehension: { status: 'not_applicable' },
});
const quiz = (attemptId: string, studentId: string, roomId: string | null, scorePercentage: number) => ({
  attemptId, studentId, studentName: studentId, roomId, moduleTitle: 'Story', completedAt: '2026-11-03T02:00:00Z',
  correctAnswers: scorePercentage / 50, totalQuestions: 2, scorePercentage, hintsUsed: 0,
});
const readings = [reading('r1','ana','a',90), reading('r2','ana','b',10), reading('r3','ana',null,70), reading('r4','ben',null,20), reading('r5','ben','b',30)];
const quizzes = [quiz('q1','ana','a',100), quiz('q2','ana','b',0), quiz('q3','ana',null,50), quiz('q4','ben',null,0), quiz('q5','ben','b',0)];
const fixture = {
  supabase: { auth: { getUser: async () => ({ data: { user: { id: 'teacher' } }, error: null }) } },
  getTeacherClassrooms: async () => [
    { id: 'a', room_name: 'A', section: null, archived_at: null },
    { id: 'b', room_name: 'B', section: null, archived_at: '2026-11-05T00:00:00Z' },
  ],
  getRoomEnrollments: async (id: string) => (id === 'a' ? ['ana'] : ['ana', 'ben']).map(student_id => ({ student_id, display_name: student_id })),
  getClassroomReadingActivities: async () => [],
  getTeacherOralReadingAttempts: async () => readings,
  m7Request: async () => quizzes,
};
const globals = globalThis as typeof globalThis & { __m7ArchivedFixture?: typeof fixture };
globals.__m7ArchivedFixture = fixture;
const base = new URL('../src/modules/module7/services/', import.meta.url);
const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  if (context.parentURL?.startsWith(base.href)) {
    const mocks: Record<string, string> = {
      '/supabaseClient': 'supabase', '/oralReadingService': 'getTeacherOralReadingAttempts',
      '/classroomService': 'getTeacherClassrooms,getRoomEnrollments,getClassroomReadingActivities', './m7Service': 'm7Request',
    };
    for (const [suffix, names] of Object.entries(mocks)) {
      if (specifier.endsWith(suffix)) return { url: `data:text/javascript,${names.split(',').map(name => `export const ${name} = ${name === 'supabase' ? 'globalThis.__m7ArchivedFixture.supabase' : `(...args) => globalThis.__m7ArchivedFixture.${name}(...args)`};`).join('')}`, shortCircuit: true };
    }
    if (specifier.endsWith('/apiUrl')) return { url: 'data:text/javascript,export const getApiUrl = () => "https://api.example.org";', shortCircuit: true };
    if (specifier.startsWith('./')) return nextResolve(new URL(`${specifier}${specifier.endsWith('.ts') ? '' : '.ts'}`, context.parentURL).href, context);
  }
  return nextResolve(specifier, context);
} });
after(() => hooks.deregister());
const service = (file: string) => import(new URL(file, base).href);
const { getActiveClassroomScope, getTeacherAnalytics } = await service('teacherAnalyticsService.ts') as typeof import('../src/modules/module7/services/teacherAnalyticsService.ts');
const { getClassPerformance } = await service('classPerformanceService.ts') as typeof import('../src/modules/module7/services/classPerformanceService.ts');
const { getStudentPerformance } = await service('studentPerformanceService.ts') as typeof import('../src/modules/module7/services/studentPerformanceService.ts');
const { getQuizScores } = await service('quizScoreService.ts') as typeof import('../src/modules/module7/services/quizScoreService.ts');
const { allTime } = await service('analyticsFilters.ts') as typeof import('../src/modules/module7/services/analyticsFilters.ts');

test('active scope lists unarchived rooms and the learners enrolled in them', async () => {
  const active = await getActiveClassroomScope();
  assert.deepEqual(active.rooms, [{ id: 'a', name: 'A' }]);
  assert.deepEqual([...active.roomIds], ['a']);
  assert.deepEqual([...active.studentIds], ['ana']);
});

test('records saved to archived rooms, and unattributed work of archived-only learners, are excluded', async () => {
  const active = await getActiveClassroomScope();
  assert.deepEqual(activeRecords(quizzes, active, q => q.studentId).map(q => q.attemptId), ['q1', 'q3']);
  assert.deepEqual(activeRecords(readings, active, r => r.learnerId).map(r => r.id), ['r1', 'r3']);
  // The source arrays are not modified; archived results remain intact.
  assert.equal(quizzes.length, 5); assert.equal(readings.length, 5);
});

test('completion keeps active rooms only and recomputes totals the same way as the backend', async () => {
  const value = activeCompletion(completion, await getActiveClassroomScope());
  assert.deepEqual(value.classrooms.map(r => r.roomId), ['a']);
  assert.deepEqual([value.totalClassrooms, value.totalAssignments, value.completedAssignments, value.incompleteAssignments, value.notStartedAssignments, value.completionRate], [1, 4, 3, 1, 1, 75]);
  assert.deepEqual(value.students.map(s => [s.studentId, s.totalAssignments, s.completedAssignments, s.completionRate, s.classrooms.map(r => r.roomId)]), [['ana', 4, 3, 75, ['a']]]);
  const none = activeCompletion(completion, { rooms: [], roomIds: new Set(), studentIds: new Set() });
  assert.deepEqual([none.totalClassrooms, none.totalAssignments, none.completionRate, none.students.length], [0, 0, null, 0]);
  assert.equal(completion.classrooms.length, 2, 'input snapshot unchanged');
});

test('F3 and F5 summaries exclude archived classroom data', async () => {
  const summary = await getTeacherAnalytics(async () => quizzes, allTime);
  assert.equal(summary.totalReadingAttempts, 2);
  assert.equal(summary.studentsWithResults, 1);
  assert.equal(summary.averagePronunciationAccuracy, 80);
  assert.equal(summary.averageReadingSpeedWpm, 80);
  assert.equal(summary.completedComprehensionAttempts, 2);
  assert.equal(summary.averageComprehensionScore, 75);
  assert.equal(summary.independentComprehensionAttempts, 1);

  const classes = await getClassPerformance(async () => quizzes, async () => completion, allTime);
  assert.deepEqual(classes.classrooms.map(r => r.roomId), ['a']);
  assert.equal(classes.totalEnrolledStudents, 1);
  assert.deepEqual([classes.classrooms[0].readingAttempts, classes.classrooms[0].averagePronunciationAccuracy, classes.classrooms[0].averageComprehensionScore], [1, 90, 100]);
  const archivedSelected = await getClassPerformance(async () => quizzes, async () => completion, { ...allTime, roomId: 'b' });
  assert.equal(archivedSelected.totalClassrooms, 0);
});

test('F4 student performance lists only learners in active rooms, without archived-room results', async () => {
  const result = await getStudentPerformance(async () => quizzes, async () => completion, allTime);
  assert.deepEqual(result.students.map(s => s.studentId), ['ana']);
  const [ana] = result.students;
  assert.deepEqual(ana.classrooms.map(r => r.roomId), ['a']);
  assert.deepEqual([ana.totalAssignments, ana.completedAssignments], [4, 3]);
  assert.deepEqual([ana.readingAttempts, ana.averagePronunciationAccuracy], [2, 80]);
  assert.deepEqual([ana.completedComprehensionAttempts, ana.averageComprehensionScore], [2, 75]);

  const active = await getActiveClassroomScope();
  const history = await getQuizScores(async () => activeRecords(quizzes, active, q => q.studentId), allTime);
  assert.deepEqual(history.students.map(s => [s.studentId, s.scores.map(q => q.attemptId)]), [['ana', ['q1', 'q3']]]);
});
