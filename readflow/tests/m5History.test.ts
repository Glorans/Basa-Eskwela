import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../src/modules/module5/pages/ReadingHistoryPage.tsx', import.meta.url), 'utf8');
function fixture(role: string) {
  const slots: any[] = [];
  let cursor = 0;
  let effects: (() => void)[] = [];
  let resolve!: (rows: unknown[]) => void;
  let reject!: (error: Error) => void;
  const react = {
    ...require('react'),
    useState(initial: unknown) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = initial;
      return [slots[i], (v: any) => { slots[i] = typeof v === 'function' ? v(slots[i]) : v; }];
    },
    useEffect(callback: () => void, deps: unknown[]) {
      const i = cursor++;
      if (!slots[i] || deps.some((v,j) => v !== slots[i][j])) { slots[i] = deps; effects.push(callback); }
    },
  };
  const module = { exports: {} as any };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, { module, exports: module.exports, Error,
    require: (id: string) => id === 'react' ? react : id === 'react-router-dom' ? { Link: 'a' }
      : id.includes('oralReadingService') ? { getOwnOralReadingAttempts: () => new Promise((yes,no) => { resolve = yes; reject = no; }) } : require(id),
  });
  function render() {
    cursor=0;
    const tree=module.exports.default({role});
    const pending=effects; effects=[]; pending.forEach(fn=>fn());
    return tree;
  }
  return { render, resolve: (rows: unknown[]) => resolve(rows), reject: () => reject(new Error('History is offline')) };
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
    f.resolve([{ id:'saved', moduleTitle:'Seeds', passageTitle:'Growing', completedAt:'2026-10-08T10:00:00Z', pronunciationAccuracy:91.5, readingSpeedWpm:75, detectedErrorCount:2 }]);
    await tick();
    const tree=f.render();
    assert.match(JSON.stringify(tree), /Seeds/);
    assert.match(JSON.stringify(tree), /91.5/);
    assert.equal(find(tree,node=>node.type==='a').props.to, `${role==='admin'?'/admin':role==='student'?'/dashboard':'/m3/general'}/read-aloud/results/saved`);
  });
}
test('history handles empty records and retry after failure', async () => {
  const f=fixture('student'); f.render(); f.reject(); await tick();
  const tree=f.render();
  assert.match(JSON.stringify(tree), /History is offline/);
  find(tree,node=>node.type==='button').props.onClick(); f.render();
  assert.match(JSON.stringify(f.render()), /Loading reading history/);
  f.resolve([]); await tick();
  assert.match(JSON.stringify(f.render()), /No saved reading attempts yet/);
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
