import { activityLanguageState, getActivityText } from "../src/pages/reading-activity/activityLanguage.ts";
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { comprehensionTargetForReading } from "../src/modules/module5/services/comprehensionNavigation.ts";

const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../src/modules/module5/pages/ReadingHistoryPage.tsx', import.meta.url), 'utf8');
function fixture(role: string, language?: "en" | "fil") {
  const slots: any[] = [];
  let cursor = 0;
  let effects: (() => void)[] = [];
  let requestCount = 0;
  let replay: (() => void) | undefined;
  let resolve!: (rows: unknown[]) => void;
  let reject!: (error: Error) => void;
  const react = {
    ...require('react'),
    useState(initial: unknown) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = initial;
      return [slots[i], (v: any) => { slots[i] = typeof v === 'function' ? v(slots[i]) : v; }];
    },
    useRef(initial: unknown) { return slots[cursor++] ??= { current: initial }; },
    useEffect(callback: () => void, deps: unknown[]) {
      const i = cursor++;
      if (!slots[i] || deps.some((v,j) => v !== slots[i][j])) {
        slots[i] = deps;
        effects.push(() => {
          let cleanup = callback() as unknown as (() => void);
          replay = () => { cleanup(); cleanup = callback() as unknown as (() => void); };
        });
      }
    },
  };
  const module = { exports: {} as any };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, { module, exports: module.exports, Error,
    require: (id: string) => id === 'react' ? react : id === 'react-router-dom' ? { Link: 'a' }
      : id.includes('oralReadingService') ? { getOwnOralReadingAttempts: () => { requestCount++; return new Promise((yes,no) => { resolve = yes; reject = no; }); } }
      : id.includes('activityLanguage') ? { activityLanguageState, getActivityText }
      : id.includes('comprehensionNavigation') ? { comprehensionTargetForReading } : require(id),
  });
  function render(embedded = false) {
    cursor=0;
    const tree=module.exports.default({role, embedded, language});
    const pending=effects; effects=[]; pending.forEach(fn=>fn());
    return tree;
  }
  return { render, replay: () => replay!(), requests: () => requestCount, resolve: (rows: unknown[]) => resolve(rows), reject: () => reject(new Error('History is offline')) };
}
function find(tree: any, predicate: (node: any) => boolean): any {
  if (!tree || typeof tree !== 'object') return;
  if (predicate(tree)) return tree;
  for (const child of [tree.props?.children].flat(Infinity)) {
    const found = find(child, predicate); if (found) return found;
  }
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
for (const role of ['student','general_user','admin']) {
  test(`${role} history renders only saved results and reopens the correct role route`, async () => {
    const f=fixture(role);
    assert.match(JSON.stringify(f.render()), /Loading reading history/);
    f.resolve([{ id:'saved', moduleTitle:'Seeds', passageTitle:'Growing', language:'fil', completedAt:'2026-10-08T10:00:00Z', pronunciationAccuracy:91.5, readingSpeedWpm:75, detectedErrorCount:2 }]);
    await tick();
    const tree=f.render();
    const text=JSON.stringify(tree);
    assert.match(text, /Seeds/);
    assert.match(text, /Filipino/);
    assert.match(text, role === "admin" ? /"Reading accuracy: ","91.5"/ : /"Katumpakan ng pagbasa: ","91.5"/);
    // The saved score is reading accuracy; the only pronunciation text says its check results are not saved.
    assert.doesNotMatch(text, /Pronunciation accuracy|Pronunciation Accuracy|Katumpakan ng Pagbigkas/i);
    assert.match(text, /Pronunciation check results for English readings are not saved/);
    const result=`${role==='admin'?'/admin':role==='student'?'/dashboard':'/m3/general'}/read-aloud/results/saved`;
    const links=[] as any[];
    (function walk(node:any){ if(!node||typeof node!=='object')return; if(node.type==='a')links.push(node); [node.props?.children].flat(Infinity).forEach(walk); })(tree);
    // F7 reopens a saved attempt straight at its result (F6), transcript (F5), or feedback and recording (F2).
    assert.deepEqual(links.map(link=>link.props.to), [`${result}?view=result`, `${result}?view=transcript`, `${result}?view=feedback`]);
  });
}
test('history handles empty records and retry after failure', async () => {
  const f=fixture('student'); f.render(); f.reject(); await tick();
  const tree=f.render();
  assert.match(JSON.stringify(tree), /History is offline/);
  find(tree,node=>node.type==='button').props.onClick(); f.render();
  assert.equal(f.requests(), 2, 'Retry makes a fresh request after failure');
  assert.match(JSON.stringify(f.render()), /Loading reading history/);
  f.resolve([]); await tick();
  assert.match(JSON.stringify(f.render()), /No saved reading attempts yet/);
});

test('embedded history reuses pending and completed requests, including empty results', async () => {
  const f = fixture('student');
  assert.match(JSON.stringify(f.render(true)), /Loading saved assessments/);
  f.replay(); // React StrictMode setup / cleanup / setup must share the request.
  f.render(true);
  assert.equal(f.requests(), 1);
  f.resolve([]);
  await tick();
  assert.match(JSON.stringify(f.render(true)), /No saved reading attempts yet/);
  assert.doesNotMatch(JSON.stringify(f.render(true)), /Loading saved assessments/);
  assert.equal(f.requests(), 1);
  const otherInstance = fixture('student');
  otherInstance.render(true);
  assert.equal(otherInstance.requests(), 1, 'a new user/result instance fetches its own records');
});
test('application source has no native browser popup calls', () => {
  function scan(dir: URL) {
    for (const entry of readdirSync(dir, {withFileTypes:true})) {
      const url=new URL(entry.name + (entry.isDirectory()?'/':''),dir);
      if(entry.isDirectory()) scan(url);
      else if(/\.[jt]sx?$/.test(entry.name)) assert.doesNotMatch(readFileSync(url,'utf8'), /\b(?:window\.)?(?:alert|confirm|prompt)\s*\(/, url.pathname);
    }
  }
  scan(new URL('../src/',import.meta.url));
});

for (const language of ['en', 'fil'] as const) {
  test(`embedded ${language} history localizes loading, errors and empty state without changing retries`, async () => {
    const f = fixture('student', language);
    const ui = getActivityText(language);
    assert.ok(JSON.stringify(f.render(true)).includes(ui.t('Loading saved assessments…')));
    f.reject(); await tick();
    const tree = f.render(true);
    assert.ok(JSON.stringify(tree).includes(language === 'fil' ? ui.t('Unable to load reading history.') : 'History is offline'));
    assert.equal(find(tree, n => n.type === 'button').props.children, ui.t('Retry'));
    find(tree, n => n.type === 'button').props.onClick(); f.render(true);
    f.resolve([]); await tick();
    assert.ok(JSON.stringify(f.render(true)).includes(ui.t('No saved reading attempts yet. Complete a read-aloud activity to see it here.')));
    assert.equal(f.requests(), 2);
  });
}

test('mixed history uses each saved language, never titles or the parent activity language', async () => {
  const f = fixture('general_user', 'fil'); f.render(true);
  f.resolve(['en', 'fil', undefined].map((language, index) => ({
    id: String(index), moduleId: 'module', passageId: 'passage',
    moduleTitle: language === 'en' ? 'Ang Kuwento' : 'An English Title',
    passageTitle: 'Saved title unchanged', language, completedAt: '2026-10-08T10:00:00Z',
    pronunciationAccuracy: 91.5, readingSpeedWpm: 75, detectedErrorCount: 2,
  })));
  await tick();
  const rows = find(f.render(true), n => n.type === 'ul').props.children;
  for (const [index, row] of rows.entries()) {
    const expected = index === 1 ? 'fil' : 'en';
    assert.equal(row.props.lang, expected);
    assert.ok(JSON.stringify(row).includes(getActivityText(expected).t('Reading accuracy: ')));
    assert.ok(JSON.stringify(row).includes('Saved title unchanged'));
    const links = find(row, n => n.type === 'div').props.children.flat(Infinity).filter(Boolean);
    assert.equal(links.length, 4); // result, transcript, feedback and recording, comprehension
    assert.ok(links.every((link: any) => link.props.state.readingActivityLanguage === expected));
  }
});
