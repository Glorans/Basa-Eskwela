import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { after, test } from 'node:test';
import type { TeacherQuizAttempt } from '../src/modules/module7/services/teacherQuizService.ts';
const quiz = (attemptId: string, roomId: string | null, scorePercentage: number): TeacherQuizAttempt => ({
  attemptId, roomId, studentId: 'student', studentName: 'Learner', moduleTitle: 'Story',
  completedAt: '2026-10-02T00:00:00Z', correctAnswers: scorePercentage / 100,
  totalQuestions: 1, scorePercentage, hintsUsed: 0,
});
const quizzes = [quiz('q1','a',100),quiz('q2','a',0),quiz('q3','b',100),quiz('q4',null,0)];
let quizRequests = 0;
const fixture = {
  supabase: { auth: {
    getUser: async () => ({data:{user:{id:'teacher'}},error:null}),
    getSession: async () => ({data:{session:{access_token:'token'}},error:null}),
  } },
  getTeacherClassrooms: async () => [{id:'a',room_name:'A',section:null},{id:'b',room_name:'B',section:null},{id:'empty',room_name:'Empty',section:null}],
  getRoomEnrollments: async () => [{student_id:'student',display_name:'Learner'}],
  getClassroomReadingActivities: async () => [],
  getTeacherOralReadingAttempts: async () => [{
    id:'one-reading',learnerId:'student',roomId:'a',pronunciationAccuracy:90,readingSpeedWpm:80,
    comprehension:{status:'completed',firstAttemptPercentage:100},
  }],
  m7Request: async (path: string) => { assert.equal(path,'/teacher/quizzes'); quizRequests++; return quizzes; },
};
const globals = globalThis as typeof globalThis & { __m7QuizFixture?: typeof fixture };
globals.__m7QuizFixture = fixture;
const base = new URL('../src/modules/module7/services/',import.meta.url);
const hooks = registerHooks({resolve(specifier,context,nextResolve) {
  if (context.parentURL?.startsWith(base.href)) {
    const mocks: Record<string,string> = {
      '/supabaseClient':'supabase', '/oralReadingService':'getTeacherOralReadingAttempts',
      '/classroomService':'getTeacherClassrooms,getRoomEnrollments,getClassroomReadingActivities', './m7Service':'m7Request',
    };
    for(const [suffix,names] of Object.entries(mocks)) {
      if(specifier.endsWith(suffix)) return {url:`data:text/javascript,${names.split(',').map(name=>`export const ${name} = ${name === "supabase" ? "globalThis.__m7QuizFixture.supabase" : `(...args) => globalThis.__m7QuizFixture.${name}(...args)`};`).join('')}`,shortCircuit:true};
    }
    if(specifier.endsWith('/apiUrl')) return {url:'data:text/javascript,export const getApiUrl = () => "https://api.example.org";',shortCircuit:true};
    if(specifier.startsWith('./')) return nextResolve(new URL(`${specifier}${specifier.endsWith(".ts") ? "" : ".ts"}`,context.parentURL).href,context);
  }
  return nextResolve(specifier,context);
}});
const { getTeacherQuizAttempts } = await import(new URL('teacherQuizService.ts',base).href) as typeof import('../src/modules/module7/services/teacherQuizService.ts');
const { getTeacherAnalytics } = await import(new URL('teacherAnalyticsService.ts',base).href) as typeof import('../src/modules/module7/services/teacherAnalyticsService.ts');
const { getStudentPerformance } = await import(new URL('studentPerformanceService.ts',base).href) as typeof import('../src/modules/module7/services/studentPerformanceService.ts');
const { getClassPerformance } = await import(new URL('classPerformanceService.ts',base).href) as typeof import('../src/modules/module7/services/classPerformanceService.ts');
const { getQuizScores } = await import(new URL('quizScoreService.ts',base).href) as typeof import('../src/modules/module7/services/quizScoreService.ts');
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => new Response(JSON.stringify({success:true,analytics:{students:[],classrooms:[]}}));
after(()=>{globalThis.fetch=originalFetch;hooks.deregister();delete globals.__m7QuizFixture;});

test('all dashboard summaries share M7 quiz IDs and stored classroom attribution, independently of M5 review',async()=>{
  quizRequests=0;
  const snapshot=getTeacherQuizAttempts();const load=()=>snapshot;
  const [overview,students,classes,scores]=await Promise.all([
    getTeacherAnalytics(load),getStudentPerformance(load),getClassPerformance(load),getQuizScores(load),
  ]);
  assert.equal(quizRequests,1);
  assert.equal(overview.totalReadingAttempts,1);
  assert.equal(overview.averagePronunciationAccuracy,90);
  assert.equal(overview.completedComprehensionAttempts,4);
  assert.equal(overview.averageComprehensionScore,50);
  assert.equal(students.students[0].completedComprehensionAttempts,4);
  assert.equal(students.students[0].averageComprehensionScore,50);
  assert.equal(scores.totalCompletedQuizzes,4);
  assert.equal(scores.averageQuizScore,50);
  assert.deepEqual(scores.students[0].scores.map(q=>q.attemptId),['q1','q2','q3','q4']);
  assert.deepEqual(classes.classrooms.map(c=>c.averageComprehensionScore),[50,100,null]);
  // All Classrooms keeps eligible independent work, and identifies it without changing scores.
  assert.equal(overview.independentComprehensionAttempts,1);
  assert.equal(scores.independentQuizzes,1);
  assert.deepEqual(scores.students[0].scores.map(q=>q.roomId),['a','a','b',null]);
});

test('a classroom filter excludes independent quizzes from every quiz-derived section',async()=>{
  const load=async()=>quizzes;
  const scope={roomId:'a',startDate:'',endDate:''};
  const [overview,students,classes,scores]=await Promise.all([getTeacherAnalytics(load,scope),getStudentPerformance(load,undefined,scope),getClassPerformance(load,undefined,scope),getQuizScores(load,scope)]);
  assert.equal(overview.independentComprehensionAttempts,0);
  assert.equal(overview.completedComprehensionAttempts,2);
  assert.equal(overview.averageComprehensionScore,50);
  assert.equal(students.students[0].completedComprehensionAttempts,2);
  assert.deepEqual(classes.classrooms.map(c=>c.roomId),['a']);
  assert.equal(scores.independentQuizzes,0);
  assert.deepEqual(scores.students[0].scores.map(q=>q.roomId),['a','a']);
});

test('no quizzes means null averages and zero counts without borrowing M5 scores',async()=>{
  const load=async()=>[];
  const [overview,students,classes,scores]=await Promise.all([
    getTeacherAnalytics(load),getStudentPerformance(load),getClassPerformance(load),getQuizScores(load),
  ]);
  assert.equal(overview.averageComprehensionScore,null);
  assert.equal(overview.completedComprehensionAttempts,0);
  assert.equal(students.students[0].averageComprehensionScore,null);
  assert.ok(classes.classrooms.every(c=>c.averageComprehensionScore===null));
  assert.equal(scores.averageQuizScore,null);assert.equal(scores.totalCompletedQuizzes,0);
});

test('invalid evidence errors propagate to every quiz-derived dashboard section',async()=>{
  const load=async():Promise<TeacherQuizAttempt[]>=>{throw Error('Completed quiz evidence is incomplete or invalid.');};
  await Promise.all([
    assert.rejects(getTeacherAnalytics(load),/evidence is incomplete or invalid/),
    assert.rejects(getStudentPerformance(load),/evidence is incomplete or invalid/),
    assert.rejects(getClassPerformance(load),/evidence is incomplete or invalid/),
    assert.rejects(getQuizScores(load),/evidence is incomplete or invalid/),
  ]);
});

test('student progress uses backend stages, deduplicates enrollment and matches class completion', async () => {
  const originalEnrollments = fixture.getRoomEnrollments;
  fixture.getRoomEnrollments = async () => [
    {student_id:'student',display_name:'Learner'},
    {student_id:'student',display_name:'Learner'},
  ];
  const classroom = (roomId: string, completed: number, inProgress: number, notStarted: number) => ({
    roomId, roomName: roomId, totalAssignments: completed + inProgress + notStarted,
    completedAssignments: completed, inProgressAssignments: inProgress, notStartedAssignments: notStarted,
    incompleteAssignments: inProgress + notStarted,
    completionRate: Math.round(completed / (completed + inProgress + notStarted) * 10000) / 100,
  });
  const classrooms = [classroom('a',1,2,1),classroom('b',0,1,1)];
  const completion = {
    totalClassrooms: 3, totalAssignments: 6, completedAssignments: 1, inProgressAssignments: 3,
    notStartedAssignments: 2, incompleteAssignments: 5, completionRate: 16.67, classrooms,
    students: [{studentId:'student',totalAssignments:6,completedAssignments:1,inProgressAssignments:3,
      notStartedAssignments:2,incompleteAssignments:5,completionRate:16.67,classrooms}],
  };
  try {
    const snapshot = Promise.resolve(completion);
    const [students, classes] = await Promise.all([
      getStudentPerformance(async()=>[],()=>snapshot),getClassPerformance(async()=>[],()=>snapshot),
    ]);
    const student = students.students[0];
    assert.equal(student.totalAssignments,6);
    assert.equal(student.completedAssignments,1);
    assert.equal(student.inProgressAssignments,3);
    assert.equal(student.notStartedAssignments,2);
    assert.equal(student.completionRate,16.67);
    assert.equal(student.classrooms.length,3);
    assert.deepEqual(student.classrooms.map(c=>c.completionRate),classes.classrooms.map(c=>c.completionRate));
    assert.equal(student.classrooms[2].totalAssignments,0);
    assert.equal(student.classrooms[2].completionRate,null);
    for(const row of [student,...student.classrooms]) {
      assert.equal(row.totalAssignments,row.completedAssignments+row.inProgressAssignments+row.notStartedAssignments);
    }
  } finally { fixture.getRoomEnrollments = originalEnrollments; }
});

test('completion retrieval failure cannot become a zero-progress dashboard',async()=>{
  const unavailable = async (): Promise<never> => {throw Error('Progress unavailable');};
  await assert.rejects(getStudentPerformance(async()=>[],unavailable),/Progress unavailable/);
  await assert.rejects(getClassPerformance(async()=>[],unavailable),/Progress unavailable/);
});

test('malformed teacher quiz API responses fail closed before aggregation, while zero remains valid',async()=>{
  const original = fixture.m7Request;
  try {
    for(const scorePercentage of [null,undefined,NaN,Infinity,'0',-1,101]) {
      fixture.m7Request=async()=>[{...quizzes[0],scorePercentage}] as unknown as TeacherQuizAttempt[];
      await assert.rejects(getTeacherQuizAttempts(),/Invalid assessment evidence/);
    }
    fixture.m7Request=async()=>[{...quizzes[0],correctAnswers:undefined}] as unknown as TeacherQuizAttempt[];
    await assert.rejects(getTeacherQuizAttempts(),/Invalid assessment evidence/);
    fixture.m7Request=async()=>[quiz('zero','a',0)];
    assert.equal((await getTeacherQuizAttempts())[0].scorePercentage,0);
  } finally {fixture.m7Request=original;}
});

test('global scope filters quiz records before every aggregation and keeps current enrollment',async()=>{
 const load=async()=>quizzes;
 const scope={roomId:'b',startDate:'2026-10-02',endDate:'2026-10-02'};
 const [overview,students,classes,scores]=await Promise.all([getTeacherAnalytics(load,scope),getStudentPerformance(load,undefined,scope),getClassPerformance(load,undefined,scope),getQuizScores(load,scope)]);
 assert.equal(overview.completedComprehensionAttempts,1);
 assert.equal(overview.averageComprehensionScore,100);
 assert.equal(overview.totalReadingAttempts,0);
 assert.equal(students.totalStudents,1);
 assert.equal(students.students[0].completedComprehensionAttempts,1);
 assert.equal(classes.totalClassrooms,1);
 assert.equal(classes.classrooms[0].roomId,'b');
 assert.equal(scores.totalCompletedQuizzes,1);
 const empty=await getTeacherAnalytics(load,{...scope,startDate:'2026-10-03',endDate:'2026-10-03'});
 assert.equal(empty.completedComprehensionAttempts,0);
 assert.equal(empty.averageComprehensionScore,null);
});
