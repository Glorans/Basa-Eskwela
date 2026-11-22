// Isolated browser/test responses only. Never loaded by application code or saved to Supabase.
import type { AdminStudentDetail, SuggestionsData } from '../../src/modules/module7/services/m7Service';
import { adminDetail } from './m7Performance.ts';
export const studentDetail: AdminStudentDetail = {
  ...adminDetail('ana') as AdminStudentDetail,
  competency: { literal: { total: 4, correct: 3, score: 75 }, inferential: { total: 2, correct: 1, score: 50 }, critical: { total: 0, correct: 0, score: null } },
  contexts: [{ teacherId: 't', teacherName: 'Teacher T', classrooms: ['Grade 5'], classification: 'Needs Support', recoveryCount: 1, completedQuizzes: 2,
    latestScores: [{ score: 55, completedAt: '2026-11-02T01:00:00Z' }, { score: 75, completedAt: '2026-11-03T01:00:00Z' }] }],
  readings: [
    { id: 'r2', title: 'The Seed', completedAt: '2026-11-03T01:00:00Z', readingAccuracy: 86.49, readingSpeedWpm: 100.4 },
    { id: 'r1', title: 'The Seed', completedAt: '2026-11-02T01:00:00Z', readingAccuracy: 78, readingSpeedWpm: 85 },
  ],
  quizzes: [{ id: 'q', title: 'The Seed', completedAt: '2026-11-03T01:00:00Z', score: 75, firstCorrect: 3, totalQuestions: 4 }],
  historicalQuizzes: [{ id: 'extra', title: 'Earlier extra attempt', completedAt: '2026-11-02T01:00:00Z', score: 50, firstCorrect: 2, totalQuestions: 4, notCounted: true }],
  activities: [{ id: 'module', kind: 'module', title: 'Reading Module', roomName: 'Grade 5', status: 'In progress', passagesCompleted: 1, passagesTotal: 3 }],
  interventions: { own: [], others: { total: 1, planned: 1, inProgress: 0, completed: 0 }, history: [{ id: 'i', intervention_date: '2026-11-03', status: 'planned', competency: 'word_recognition', language: 'en', suggestion_title: 'Guided word practice', notes: 'Read together in class.', follow_up_date: '2026-11-10', follow_up_outcome: 'too_early', follow_up_notes: 'Review the next reading.', created_at: '2026-11-03T01:00:00Z', updated_at: '2026-11-03T01:00:00Z', author: { name: 'Teacher T', role: 'Teacher' } }] },
};
export const studentSuggestions: SuggestionsData = {
  generatedAt: '2026-11-04T01:00:00Z', rules: { comprehensionBenchmark: 75, recentAssessments: 3, patternMinQuestions: 4, patternMinAssessmentsBelow: 2, minQuestionsToObserve: 2, wordRecognitionMinAccuracy: 90, recentReadings: 3, patternMinReadingsBelow: 2, fluencyMinWpm: null, maxSuggestions: 3 },
  languages: [], additionalNeeds: [], improving: [], moreDataNeeded: false, hasAnyData: true, notes: ['Test response: saved evidence is retained.'],
  suggestions: [{ id: 'word-en', competency: 'word_recognition', competencyName: 'Word Recognition', language: 'en', languageName: 'English', status: 'needs_practice', level: 'pattern', trend: null, moreEvidenceNeeded: false,
    evidence: { readings: studentDetail.readings.map(r => ({ id: r.id, title: r.title, completedAt: r.completedAt, accuracy: r.readingAccuracy!, wpm: r.readingSpeedWpm })), wordsReadDifferently: [{ word: 'seed', times: 2 }, { word: 'garden', times: 1 }], pronunciationPracticeWords: ['growing'] },
    evidenceText: 'Two saved readings below the word-recognition benchmark.', reason: 'Word differences recur across the saved readings.', period: { from: '2026-11-02', to: '2026-11-03' }, priority: 1,
    suggestion: { key: 'guided', title: 'Guided word practice', approach: 'Read the words with support.', activity: 'Read the sentence together, then independently.' }, sinceIntervention: null }],
};
