import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { getActivityText } from '../src/pages/reading-activity/activityLanguage.ts';
import { createSegmentPlaybackQueue } from '../src/modules/module5/services/recordingPlaybackQueue.ts';

const require = createRequire(import.meta.url);
const tick = () => new Promise(resolve => setImmediate(resolve));
function find(tree: any, predicate: (node: any) => boolean): any {
  if (!tree || typeof tree !== 'object') return;
  if (predicate(tree)) return tree;
  for (const child of [tree.props?.children].flat(Infinity)) {
    const result = find(child, predicate); if (result) return result;
  }
}
function text(tree: any): string {
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree);
  if (!tree || typeof tree !== 'object') return '';
  return [tree.props?.children].flat(Infinity).map(text).join('');
}

function playback(language: 'en' | 'fil') {
  let cursor = 0;
  const slots: any[] = [], effects: (() => void)[] = [], calls: any[] = [];
  let resolve!: (result: any) => void;
  let reject!: (error: Error) => void;
  const react = { ...require('react'),
    useState(initial: any) {
      const i = cursor++; if (!(i in slots)) slots[i] = initial;
      return [slots[i], (v: any) => { slots[i] = v; }];
    },
    useRef(initial: any) { return slots[cursor++] ??= { current: initial }; },
    useMemo(callback: () => any) { return slots[cursor++] ??= callback(); },
    useEffect(callback: () => void, deps: any[]) {
      const i = cursor++;
      if (!slots[i] || deps.some((v, j) => v !== slots[i][j])) { slots[i] = deps; effects.push(callback); }
    },
  };
  const module = { exports: {} as any };
  const source = readFileSync(new URL('../src/modules/module5/components/RecordingPlayback.tsx', import.meta.url), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
  } }).outputText, { module, exports: module.exports,
    require: (id: string) => id === 'react' ? react
      : id.includes('activityLanguage') ? { getActivityText }
      : id.includes('oralReadingService') ? { getOralReadingRecording: (...args: any[]) => {
        calls.push(args); return new Promise((yes, no) => { resolve = yes; reject = no; });
      } }
      : id.includes('recordingPlaybackQueue') ? { createSegmentPlaybackQueue }
      : id.includes('recordingDuration') ? { resolveRecordingDuration() {} } : require(id),
  });
  function render() {
    cursor = 0; const tree = module.exports.default({ attemptId: 'saved', language });
    effects.splice(0).forEach(fn => fn()); return tree;
  }
  return { render, calls, resolve: (value: any) => resolve(value), reject: () => reject(Error('provider detail')) };
}

for (const language of ['en', 'fil'] as const) {
  test(`${language} playback localizes loading, segments and retry without changing audio controls`, async () => {
    const f = playback(language), ui = getActivityText(language);
    assert.ok(text(f.render()).includes(ui.t('Loading recording…')));
    f.resolve({ available: true, segments: ['/part-one.wav', '/part-two.wav'] }); await tick();
    const tree = f.render();
    assert.ok(text(tree).includes(ui.t('Listen to your recording')));
    assert.ok(text(tree).includes(ui.t('Part {index} of {total}', { index: 1, total: 2 })));
    const audio = find(tree, n => n.type === 'audio');
    assert.equal(audio.props.controls, true);
    assert.equal(audio.props.src, '/part-one.wav');
    assert.equal(audio.props['aria-label'], ui.t('Read-aloud recording part {index}', { index: 1 }));
    audio.props.onError();
    assert.ok(text(f.render()).includes(ui.t('Audio could not load or its link expired. Reload the recording to try again.')));
    find(f.render(), n => n.type === 'button').props.onClick(); f.render();
    assert.deepEqual(f.calls, [['saved', false], ['saved', false]]);
    f.resolve({ available: false }); await tick();
    assert.ok(text(f.render()).includes(ui.t('Recording unavailable for this activity. Older results may not have saved audio.')));
    const failed = playback(language); failed.render(); failed.reject(); await tick();
    assert.ok(text(failed.render()).includes(ui.t('Unable to load recording. Please retry.')));
  });
}

test('M6 explanation distinguishes revealed correct answers from generic feedback; English remains unchanged', () => {
  const source = readFileSync(new URL('../src/modules/module6/pages/ComprehensionPage.tsx', import.meta.url), 'utf8') + '\nexport { AnswerFeedback };';
  const module = { exports: {} as any };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
  } }).outputText, { module, exports: module.exports,
    require: (id: string) => id === 'react' || id === 'react/jsx-runtime' ? require(id) : {},
  });
  for (const language of ['en', 'fil']) for (const correctOptionIndex of [0, null]) {
    const question = { resolved: true, firstAnswerCorrect: false, options: ['Correct saved answer'], correctOptionIndex,
      answerExplanation: 'Approved explanation unchanged', supportingEvidence: 'Approved evidence unchanged' };
    const tree = module.exports.AnswerFeedback({ question, ui: getActivityText(language) });
    const expected = language === 'en' ? 'Why this answer fits: ' : correctOptionIndex === 0 ? 'Bakit ito ang tamang sagot: ' : 'Paliwanag sa sagot: ';
    assert.ok(text(tree).includes(expected + question.answerExplanation));
    assert.ok(text(tree).includes(question.supportingEvidence));
    // M6 is text only: no listen control carries the explanation.
    assert.equal(find(tree, n => typeof n.props?.text === 'string'), undefined);
  }
});
