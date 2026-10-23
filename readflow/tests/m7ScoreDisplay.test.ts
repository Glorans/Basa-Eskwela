import assert from 'node:assert/strict';
import test from 'node:test';
import { formatScore, formatQuizScore, formatComprehension, formatAnswerCounts, formatCount } from '../src/modules/module7/services/scoreDisplay.ts';

test('valid scores and genuine zero scores retain their meaning', () => {
  assert.equal(formatScore(75),'75%');
  assert.equal(formatScore(0),'0%');
  assert.equal(formatScore(0,2),'0.00%');
  assert.equal(formatQuizScore({score:0,firstCorrect:0,totalQuestions:3}),'0/3 (0%)');
  assert.equal(formatQuizScore({score:100,firstCorrect:3,totalQuestions:3}),'3/3 (100%)');
  assert.equal(formatCount(0),'0');
});

test('null, missing, nonnumeric, nonfinite and out-of-range scores are unavailable, never zero', () => {
  for(const score of [null,undefined,NaN,Infinity,-Infinity,-1,101,'0',{},false]) {
    assert.equal(formatScore(score),'Evaluation unavailable');
    assert.equal(formatQuizScore({score,firstCorrect:0,totalQuestions:3}),'Evaluation unavailable');
  }
});

test('malformed evidence is labeled even if a score is present; incomplete counts are not rendered', () => {
  assert.equal(formatQuizScore({score:75,dataQuality:'Invalid completed assessment evidence'}),'Invalid assessment evidence');
  assert.equal(formatQuizScore({score:null,dataQuality:'Invalid completed assessment evidence'}),'Invalid assessment evidence');
  for(const [correct,total] of [[undefined,3],[0,undefined],[0,0],[4,3],[-1,3],[0.5,3],[NaN,3]]) {
    assert.equal(formatAnswerCounts(correct,total),'Evaluation unavailable');
    assert.equal(formatQuizScore({score:0,firstCorrect:correct,totalQuestions:total}),'Evaluation unavailable');
  }
  assert.equal(formatCount(undefined),'Evaluation unavailable');
});

test('aggregate display distinguishes no activity, invalid evidence, missing evaluation and legitimate zero', () => {
  assert.equal(formatComprehension({comprehensionScore:null,completedQuizzes:0}),'No data');
  assert.equal(formatComprehension({comprehensionScore:null,completedQuizzes:2,invalidCompletedQuizzes:1}),'Invalid assessment evidence');
  assert.equal(formatComprehension({completedQuizzes:2}),'Evaluation unavailable');
  assert.equal(formatComprehension({comprehensionScore:0,completedQuizzes:2}),'0%');
});
