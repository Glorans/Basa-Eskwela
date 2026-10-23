import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  assessmentSourceLabel, assessmentSourceNote, countIndependentAssessments, isIndependentAssessment,
} from '../src/modules/module7/services/assessmentSource.ts';

const rooms = [{ id: 'room-a', name: 'Grade 4 Mabini' }, { id: 'room-b', name: 'Grade 4 Rizal' }];

test('assessments without a saved room are Independent; saved rooms show the Teacher-owned classroom name', () => {
  assert.equal(assessmentSourceLabel({ roomId: null }, rooms), 'Independent');
  assert.equal(assessmentSourceLabel({}, rooms), 'Independent');
  assert.equal(assessmentSourceLabel({ roomId: 'room-b' }, rooms), 'Classroom: Grade 4 Rizal');
  assert.equal(isIndependentAssessment({ roomId: 'room-a' }), false);
  assert.equal(countIndependentAssessments([{ roomId: 'room-a' }, { roomId: null }, { roomId: null }]), 2);
});

test('an unmatched room stays a classroom assessment and never borrows another name', () => {
  assert.equal(assessmentSourceLabel({ roomId: 'room-unknown' }, rooms), 'Classroom');
  assert.equal(assessmentSourceLabel({ roomId: 'room-a' }, []), 'Classroom');
});

test('the source note distinguishes All Classrooms with independent work, without it, and classroom filters', () => {
  assert.match(assessmentSourceNote(false, 1), /include 1 independent assessment completed outside a classroom/);
  assert.match(assessmentSourceNote(false, 3), /include 3 independent assessments/);
  assert.match(assessmentSourceNote(false, 3), /Select a classroom to exclude independent work/);
  assert.match(assessmentSourceNote(false, 0), /No independent comprehension assessments are included/);
  // A classroom filter excludes independent work regardless of the unfiltered count.
  assert.match(assessmentSourceNote(true, 5), /independent comprehension assessments are excluded/);
});

test('Teacher Analytics shows the source note in Overview and Assessments and a Source column per quiz', async () => {
  const page = await readFile(new URL('../src/modules/module7/TeacherAnalyticsPage.tsx', import.meta.url), 'utf8');
  const assessments = page.indexOf('id="analytics-panel-2"');
  assert.ok(assessments > 0);
  const overview = page.slice(page.indexOf('id="analytics-panel-0"'), page.indexOf('id="analytics-panel-1"'));
  assert.match(overview, /<AssessmentSourceNote[\s\S]*?independentCount=\{analytics\.independentComprehensionAttempts\}/);
  const quizPanel = page.slice(assessments);
  assert.match(quizPanel, /<AssessmentSourceNote[\s\S]*?independentCount=\{quizScores\.independentQuizzes\}/);
  assert.match(quizPanel, /"Reading Module",\s*"Source",/);
  // Names come only from the rooms loaded from the Teacher's own completion analytics.
  assert.match(quizPanel, /assessmentSourceLabel\(\s*score,\s*rooms\s*\)/);
  assert.match(page, /classroomFiltered=\{Boolean\(scope\.roomId\)\}/);
});
