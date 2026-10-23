import assert from 'node:assert/strict';
import test from 'node:test';
import { isActiveWarning, matchesSupportFilter } from '../src/modules/module7/services/studentSupportClassification.ts';

test('only the three warning/risk states contribute to active counts and filtering', () => {
  const states = ['No assessment data', 'Evaluation unavailable', 'On Track', 'Early Warning', 'At Risk', 'Needs Support'];
  const students = states.map(classification => ({classification, history: []}));
  assert.deepEqual(students.filter(s => isActiveWarning(s.classification)).map(s => s.classification), states.slice(3));
  assert.deepEqual(students.filter(s => matchesSupportFilter(s, 'active')).map(s => s.classification), states.slice(3));
  assert.equal(isActiveWarning('Unknown state'), false);
});

test('all students includes unevaluated, unavailable and evaluated On Track students', () => {
  for (const classification of ['No assessment data', 'Evaluation unavailable', 'On Track']) {
    assert.equal(matchesSupportFilter({classification, history: []}, 'all'), true);
    assert.equal(matchesSupportFilter({classification, history: []}, 'active'), false);
  }
});

test('historical alert visibility is independent of current classification', () => {
  for (const classification of ['No assessment data', 'Evaluation unavailable', 'On Track', 'At Risk']) {
    assert.equal(matchesSupportFilter({classification, history: [{}]}, 'history'), true);
    assert.equal(matchesSupportFilter({classification, history: []}, 'history'), false);
  }
});
