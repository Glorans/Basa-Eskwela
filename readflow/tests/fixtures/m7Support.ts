import type { TeacherData } from '../../src/modules/module7/services/m7Service';
// Local response fixtures only. Never written to a live learner account.
export const teacherSupport: TeacherData = {
  notifications: [], notificationsActive:false,
  students:[{
    id:'ana', full_name:'Ana', nickname:'', classification:'At Risk', recoveryCount:1,
    readingAttempts:3, completedQuizzes:2, comprehensionScore:75, pronunciationAccuracy:86.49, readingSpeedWpm:100.4,
    competency:{literal:{total:4,score:100},inferential:{total:2,score:50},critical:{total:0,score:null}},
    quizzes:[{id:'counted-one',title:'The Seed',completedAt:'2026-11-02T01:00:00Z',score:50,firstCorrect:1,totalQuestions:2},{id:'counted-two',title:'The Tree',completedAt:'2026-11-03T01:00:00Z',score:100,firstCorrect:2,totalQuestions:2}],
    historicalQuizzes:[{id:'extra',title:'Extra saved attempt',completedAt:'2026-11-02T02:00:00Z',score:100,firstCorrect:2,totalQuestions:2,notCounted:true}],
    activities:[{id:'module',kind:'module',roomId:'room-a',title:'Reading Module',status:'In progress',passagesCompleted:1,passagesTotal:3}],
    history:[{id:'alert',attempt_id:'counted-one',student_id:'ana',classification:'At Risk',previous_classification:'On Track',occurred_at:'2026-11-02T01:00:00Z',read_at:null,superseded_at:null,evidence:[{id:'counted-one',score:50,completedAt:'2026-11-02T01:00:00Z'}]}],
    interventions:[{id:'existing',notes:'Review the story together.',intervention_date:'2026-11-03',status:'planned',follow_up_date:'2026-11-10',follow_up_notes:'Check comprehension.'}],
  },{
    id:'ben',full_name:'Ben',nickname:'',classification:'No assessment data',readingAttempts:0,completedQuizzes:0,comprehensionScore:null,pronunciationAccuracy:null,readingSpeedWpm:null,
    competency:{literal:{total:0,score:null},inferential:{total:0,score:null},critical:{total:0,score:null}},quizzes:[],historicalQuizzes:[],activities:[],history:[],interventions:[],
  }],
};
