import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveLearningPath, learningPathSelectionIssue } from '../src/modules/module3/utils/learningPathSelection.ts';
import type { LearningPath } from '../src/modules/module3/types/content';

const paths: LearningPath[] = (['en','fil'] as const).flatMap(language =>
  (['Frustration','Instructional','Independent'] as const).map((readingLevel, i) => ({
    id: `${language}-${i}`, name: 'Saved path', language, readingLevel,
    difficultyTier: (['Easy','Medium','Hard'] as const)[i],
  })));
test('all six pairs resolve to the existing IDs and defaults', () => {
  for (const path of paths) {
    assert.equal(resolveLearningPath(paths,path.language,path.readingLevel),path);
    assert.equal(learningPathSelectionIssue(paths,path.language,path.readingLevel),'');
  }
});
test('missing or ambiguous mappings never pick a path silently', () => {
  assert.equal(resolveLearningPath([], 'en','Frustration'),null);
  assert.match(learningPathSelectionIssue([], 'en','Frustration'),/No learning path/);
  const duplicate=[...paths,{...paths[0],id:'other'}];
  assert.equal(resolveLearningPath(duplicate,'en','Frustration'),null);
  assert.match(learningPathSelectionIssue(duplicate,'en','Frustration'),/More than one/);
  assert.equal(resolveLearningPath(paths,'','Instructional'),null);
});
