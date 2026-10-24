import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../src/modules/module4/pages/ClassroomDetailsPage.tsx', import.meta.url), 'utf8');

// Run the real page and handlers with controlled hook state and save responses.
function loadService(supabase: unknown) {
  const serviceSource = readFileSync(new URL('../src/modules/module4/services/classroomService.ts', import.meta.url), 'utf8');
  const module = { exports: {} as any };
  const code = ts.transpileModule(serviceSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, require: () => ({ supabase }), console });
  return module.exports;
}

async function fixture(listFailsAfterSave = false, questionSets: any[] = [], expectedSetId: string | null = null) {
  const slots: any[] = [];
  let cursor = 0;
  let effects: (() => void)[] = [];
  const listeners = new Map<string, () => void>();
  const timers = new Map<number, () => void>();
  let timerId = 0;
  let calls = 0;
  let resolveSave: () => void;
  let rejectSave: (error: unknown) => void;
  const react = {
    ...require('react'),
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], (value: any) => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
    },
    useRef(initial: unknown) { return slots[cursor++] ??= { current: initial }; },
    useEffect(callback: () => any, deps: unknown[]) {
      const index = cursor++;
      const previous = slots[index];
      if (!previous || deps.some((value, i) => value !== previous.deps[i])) {
        effects.push(() => { previous?.cleanup?.(); slots[index] = { deps, cleanup: callback() }; });
      }
    },
  };
  let saved = false;
  const service = {
    getReadingActivityError: loadService({}).getReadingActivityError,
    getClassroomReadingActivities: async () => {
      if (saved && listFailsAfterSave) throw Error('offline');
      return saved ? [{ id: 'assignment', material_id: 'material', student_id: 'student', status: 'assigned',
        question_set_id: expectedSetId, question_set_name: expectedSetId ? 'Question Set 2' : null }] : [];
    },
    getClassroomById: async () => ({ id: 'room', room_name: 'Readers', room_code: 'ABC' }),
    getRoomEnrollments: async () => [{ enrollment_id: 'enrollment', student_id: 'student', full_name: 'Reader', display_name: 'Reader' }],
    getPublishedModules: async () => [], getAssignedModules: async () => [],
    getUploadedReadingMaterials: async () => [{ id: 'material', title: 'Story', language: 'en' }],
    assignReadingActivity: (...args: unknown[]) => {
      calls++;
      assert.equal(JSON.stringify(args), JSON.stringify(['room', 'material', ['student'], null, expectedSetId]));
      return new Promise<void>((resolve, reject) => { resolveSave = resolve; rejectSave = reject; });
    },
  };
  const module = { exports: {} as any };
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, {
    module, exports: module.exports,
    require: (id: string) => id === 'react' ? react : id === 'react-router-dom' ? { useParams: () => ({ roomId: 'room' }), Link: 'a' } : id.includes('ReadFlowDialog') ? { confirmReadFlow: async () => true, showReadFlowDialog: async () => true } : id.includes('classroomService') ? service : id.includes('materialService') ? { getMaterialQuestionSets: async () => questionSets, getMaterialServiceError: (_: unknown, fallback: string) => fallback } : id.includes('supabaseClient') ? {} : require(id),
    console: { error() {} },
    window: {
      addEventListener(name: string, callback: () => void) { listeners.set(name, callback); },
      removeEventListener(name: string) { listeners.delete(name); },
      setTimeout(fn: () => void, delay: number) { assert.equal(delay, 4000); timers.set(++timerId, fn); return timerId; },
      clearTimeout(id: number) { timers.delete(id); },
      alert() { assert.fail('Native alert called'); },
    },
  });
  function render() {
    cursor = 0;
    const tree = module.exports.default();
    const pending = effects; effects = []; pending.forEach(fn => fn());
    return tree;
  }
  function find(tree: any, predicate: (node: any) => boolean): any {
    if (!tree || typeof tree !== 'object') return;
    if (predicate(tree)) return tree;
    for (const child of [tree.props?.children].flat(Infinity)) {
      const found = find(child, predicate); if (found) return found;
    }
  }
  render(); await new Promise(resolve => setImmediate(resolve));
  let tree = render();
  find(tree, node => node.props?.onClick?.name === 'handleToggleActivityForm').props.onClick();
  tree = render();
  // RoomLanguageSelect is not expanded here; its onChange takes the language code.
  find(tree, node => node.props?.id === 'activityLanguage').props.onChange('en');
  tree = render();
  find(tree, node => node.props?.id === 'readingMaterial').props.onChange({ target: { value: 'material' } });
  find(tree, node => node.props?.type === 'checkbox').props.onChange();
  // Let the selected material's question sets finish loading.
  render(); await new Promise(resolve => setImmediate(resolve));
  const submit = () => find(render(), node => node.props?.onSubmit?.name === 'handleAssignActivity').props.onSubmit({ preventDefault() {} });
  const text = () => JSON.stringify(render());
  return { render, find, submit, text, timers, focus: () => listeners.get('focus')?.(), calls: () => calls, save: () => { saved = true; resolveSave!(); }, fail: (error: unknown) => rejectSave!(error) };
}

test('success waits for saving, blocks repeat requests, and expires after four seconds', async () => {
  const page = await fixture();
  const pending = page.submit();
  await page.submit();
  assert.equal(page.calls(), 1);
  assert.doesNotMatch(page.text(), /Reading activity assigned successfully!/);
  assert.equal(page.find(page.render(), node => node.type === 'fieldset').props.disabled, true);
  page.save(); await pending;
  assert.match(page.text(), /Reading activity assigned successfully!/);
  assert.match(page.text(), /assignment/);
  const notification = page.find(page.render(), node => node.props?.role === 'status');
  assert.equal(notification.props['aria-live'], 'polite');
  assert.equal(notification.props.children.props.children, 'Reading activity assigned successfully!');
  for (const callback of page.timers.values()) callback();
  assert.doesNotMatch(page.text(), /Reading activity assigned successfully!/);
});

const set = (id: string, reviewStatus: string, count = 6) => ({ id, name: `Question Set ${id.slice(-1)}`, reviewStatus,
  questionCount: count, counts: { literal: count / 3, inferential: count / 3, critical: count / 3 } });

test('the only reviewed question set is preselected, saved with the activity, and named in the list', async () => {
  const page = await fixture(false, [set('set-2', 'reviewed'), set('set-3', 'generated', 3)], 'set-2');
  assert.equal(page.find(page.render(), node => node.props?.id === 'questionSet').props.value, 'set-2');
  assert.match(page.text(), /No questions \(read-aloud only\)/);
  assert.match(page.text(), /Question Set 2 \(6 questions: 2 literal, 2 inferential, 2 critical\)/);
  assert.doesNotMatch(page.text(), /Question Set 3/);
  const pending = page.submit(); page.save(); await pending;
  assert.match(page.text(), /Question Set 2/);
});

test('without a reviewed set the teacher is pointed to the material and can assign read-aloud only', async () => {
  const page = await fixture(false, [set('set-3', 'generated')]);
  assert.match(page.text(), /Review a question set first so it can be assigned\./);
  assert.match(page.text(), /\/m3\/teacher\/materials\/material/);
  const pending = page.submit(); page.save(); await pending;
  assert.match(page.text(), /Read-aloud only/);
});

for (const [label, error, expected] of [
  ['duplicate', { code: '23505', message: 'duplicate key' }, /already been assigned/],
  ['network', { message: 'Failed to fetch' }, /Unable to assign reading activity\. Please try again\./],
] as const) {
  test(`${label} failure stays inline, preserves choices, and allows retry`, async () => {
    const page = await fixture();
    const pending = page.submit(); page.fail(error); await pending;
    assert.match(page.text(), expected);
    assert.doesNotMatch(page.text(), /Reading activity assigned successfully!/);
    assert.equal(page.find(page.render(), node => node.props?.id === 'readingMaterial').props.value, 'material');
    assert.equal(page.find(page.render(), node => node.type === 'fieldset').props.disabled, false);
    const retry = page.submit(); assert.equal(page.calls(), 2); page.save(); await retry;
  });
}

test('a list refresh failure does not misreport a confirmed save as a failed assignment', async () => {
  const page = await fixture(true);
  const pending = page.submit(); page.save(); await pending;
  assert.match(page.text(), /Reading activity assigned successfully!/);
  assert.match(page.text(), /Unable to refresh assigned activities/);
  assert.doesNotMatch(page.text(), /Unable to assign reading activity/);
});

const roomId = '00000000-0000-4000-8000-000000000001';
const materialId = '00000000-0000-4000-8000-000000000002';
const studentId = '00000000-0000-4000-8000-000000000003';
const teacherId = '00000000-0000-4000-8000-000000000004';
const secondStudentId = '00000000-0000-4000-8000-000000000005';
function serviceFixture(mode = '') {
  const rows: any[] = [];
  let inserts = 0;
  let userId = teacherId;
  const supabase = {
    auth: { getUser: async () => ({ data: { user: { id: userId } }, error: null }) },
    from(table: string) {
      const filters: ((row: any) => boolean)[] = [];
      let single = false;
      let update: Record<string, unknown> | undefined;
      const query: any = {
        select() { return query; },
        eq(key: string, value: unknown) { filters.push(row => row[key] === value); return query; },
        in(key: string, values: unknown[]) { filters.push(row => values.includes(row[key])); return query; },
        order() { return query; },
        maybeSingle() { single = true; return query; },
        update(values: Record<string, unknown>) { update = values; return query; },
        insert(assignments: any[]) {
          inserts++;
          if (mode === 'race') return Promise.resolve({ error: { code: '23505' } });
          if (mode === 'rls') return Promise.resolve({ error: { code: '42501' } });
          rows.push(...assignments.map((row, i) => ({ ...row, id: `assignment-${i}`, assigned_at: '2026-10-08' })));
          return Promise.resolve({ error: null });
        },
        then(resolve: (value: unknown) => void) {
          const tables: Record<string, any[]> = {
            rooms: mode === 'room' ? [] : [{ id: roomId, teacher_id: teacherId }],
            uploaded_materials: [{ id: materialId, title: 'Story', uploaded_by: mode === 'material' ? 'other' : teacherId, extraction_status: 'completed' }],
            enrollments: mode === 'student' ? [] : [studentId, secondStudentId].map(id => ({ room_id: roomId, student_id: id })),
            reading_activity_assignments: rows,
          };
          const data = tables[table].filter(row => filters.every(filter => filter(row)));
          if (update) data.forEach(row => Object.assign(row, update));
          resolve({ data: single ? data[0] ?? null : data, error: null });
        },
      };
      return query;
    },
  };
  return { service: loadService(supabase), rows, inserts: () => inserts, asStudent: () => { userId = studentId; } };
}

test('one-student save, teacher list, student list, and duplicate preflight preserve assignment identity', async () => {
  const f = serviceFixture();
  await f.service.assignReadingActivity(roomId, materialId, [studentId, studentId]);
  assert.equal(f.rows.length, 1);
  assert.equal(f.rows[0].assigned_by, teacherId);
  assert.equal((await f.service.getClassroomReadingActivities(roomId)).length, 1);
  await assert.rejects(f.service.assignReadingActivity(roomId, materialId, [studentId]), /already been assigned/);
  assert.equal(f.inserts(), 1);
  f.asStudent();
  const activities = await f.service.getStudentReadingActivities(roomId);
  assert.equal(activities[0].title, 'Story');
  assert.equal(activities[0].assignment_id, 'assignment-0');
});

test('multiple enrolled students are saved in one atomic insert', async () => {
  const f = serviceFixture();
  await f.service.assignReadingActivity(roomId, materialId, [studentId, secondStudentId]);
  assert.equal(f.rows.length, 2);
  assert.equal(f.inserts(), 1);
});

test('whole-class assignment skips existing students without resetting their progress', async () => {
  const f = serviceFixture();
  await f.service.assignReadingActivity(roomId, materialId, [studentId]);
  f.rows[0].status = 'completed';
  await f.service.assignReadingActivity(roomId, materialId, [studentId, secondStudentId]);
  assert.equal(f.rows.length, 2);
  assert.equal(f.rows[0].status, 'completed');
  assert.equal(f.rows[1].student_id, secondStudentId);
});

for (const [mode, expected] of [['room', /classroom is unavailable/], ['material', /own uploads/], ['student', /no longer enrolled/]] as const) {
  test(`${mode} validation prevents invalid inserts`, async () => {
    const f = serviceFixture(mode);
    await assert.rejects(f.service.assignReadingActivity(roomId, materialId, [studentId]), expected);
    assert.equal(f.inserts(), 0);
  });
}
for (const [mode, expected] of [['race', /already been assigned/], ['rls', /permission/]] as const) {
  test(`${mode} database rejection is reported without saving`, async () => {
    const f = serviceFixture(mode);
    try { await f.service.assignReadingActivity(roomId, materialId, [studentId]); assert.fail('Expected rejection'); }
    catch (error) { assert.match(f.service.getReadingActivityError(error), expected); }
    assert.equal(f.rows.length, 0);
  });
}
test('malformed identifiers and empty selection never reach insert', async () => {
  const f = serviceFixture();
  await assert.rejects(f.service.assignReadingActivity('', materialId, [studentId]), /classroom is invalid/);
  await assert.rejects(f.service.assignReadingActivity(roomId, 'bad', [studentId]), /valid reading material/);
  await assert.rejects(f.service.assignReadingActivity(roomId, materialId, []), /valid enrolled student/);
  assert.equal(f.inserts(), 0);
});
test('a question set id is validated and saved on every new assignment row', async () => {
  const f = serviceFixture();
  const setId = '00000000-0000-4000-8000-000000000006';
  await assert.rejects(f.service.assignReadingActivity(roomId, materialId, [studentId], null, 'bad'), /valid question set/);
  assert.equal(f.inserts(), 0);
  await f.service.assignReadingActivity(roomId, materialId, [studentId, secondStudentId], null, setId);
  assert.deepEqual(f.rows.map(row => row.question_set_id), [setId, setId]);
  assert.deepEqual(f.rows.map(row => row.read_aloud_only), [false, false]);
  f.asStudent();
  assert.equal((await f.service.getStudentReadingActivities(roomId))[0].has_questions, true);
});
test('read-aloud only assignments save a NULL question set', async () => {
  const f = serviceFixture();
  await f.service.assignReadingActivity(roomId, materialId, [studentId]);
  assert.equal(f.rows[0].question_set_id, null);
  assert.equal(f.rows[0].read_aloud_only, true);
  assert.equal((await f.service.getClassroomReadingActivities(roomId))[0].question_set_name, null);
  f.asStudent();
  assert.equal((await f.service.getStudentReadingActivities(roomId))[0].has_questions, false);
});

test('existing student status function updates only the signed-in student assignment', async () => {
  const f = serviceFixture();
  await f.service.assignReadingActivity(roomId, materialId, [studentId, secondStudentId]);
  f.asStudent();
  await f.service.updateReadingActivityStatus(f.rows[0].id, 'completed');
  assert.equal(f.rows[0].status, 'completed');
  await f.service.updateReadingActivityStatus(f.rows[1].id, 'completed');
  assert.equal(f.rows[1].status, 'assigned');
  assert.equal(f.rows[0].read_aloud_only, true);
});

test('legacy false/null student activity card data stays identical to the pre-column response', async () => {
  const f = serviceFixture();
  f.rows.push({ id: 'legacy', room_id: roomId, material_id: materialId, student_id: studentId,
    assigned_by: teacherId, assigned_at: '2026-10-08', due_at: null, status: 'in_progress', question_set_id: null });
  f.asStudent();
  const before = JSON.stringify(await f.service.getStudentReadingActivities(roomId));
  f.rows[0].read_aloud_only = false;
  assert.equal(JSON.stringify(await f.service.getStudentReadingActivities(roomId)), before);
});
test('missing schema and foreign-key errors give actionable feedback', () => {
  const service = loadService({});
  assert.match(service.getReadingActivityError({ code: '42703' }), /database setup is incomplete/);
  assert.match(service.getReadingActivityError({ code: '23503' }), /no longer available/);
  assert.match(service.getReadingActivityError({ code: '23514' }), /not reviewed or does not belong/);
  assert.match(service.getReadingActivityError({ code: '23503', details: 'Key (question_set_id)=(x) is not present' }), /question set no longer exists/);
});


test('assignment selector refreshes on focus and includes only fully reviewed sets', async () => {
  const sets = [
    { id: 'set-a', name: 'Awaiting Approval', questionCount: 6, counts: { literal: 2, inferential: 2, critical: 2 }, reviewStatus: 'generated' },
    { id: 'set-b', name: 'Still Unreviewed', questionCount: 6, counts: { literal: 2, inferential: 2, critical: 2 }, reviewStatus: 'generated' },
  ];
  const page = await fixture(false, sets);
  assert.doesNotMatch(page.text(), /Awaiting Approval|Still Unreviewed/);
  sets[0].reviewStatus = 'reviewed';
  page.focus(); page.render();
  await new Promise(resolve => setImmediate(resolve));
  assert.match(page.text(), /Awaiting Approval/);
  assert.doesNotMatch(page.text(), /Still Unreviewed/);
  sets[0].reviewStatus = 'generated';
  page.focus(); page.render();
  await new Promise(resolve => setImmediate(resolve));
  assert.doesNotMatch(page.text(), /Awaiting Approval|Still Unreviewed/);
});
