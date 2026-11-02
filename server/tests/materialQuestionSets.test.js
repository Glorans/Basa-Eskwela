const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');
const { createMaterialsRouter } = require('../routes/materials');
const { SupabaseAuthenticationError } = require('../services/supabaseAdmin');
const { MaterialAuthorizationError } = require('../services/materialPersistenceService');
const { listMaterialQuestionSets, getMaterialQuestionSet, generateMaterialQuestionSet, saveMaterialQuestionSet, reviewMaterialQuestionSet, deleteMaterialQuestionSet } = require('../services/materialQuestionSetService');
const { createDatabase, dependencies, requester, material, generatedQuestions,
  TEACHER_A, TEACHER_B, GENERAL, ADMIN, MATERIAL_A, MATERIAL_B } = require('./fixtures/materialDatabase');
const SET = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const { generateComprehensionQuestions } = require('../services/questionGenerationService');
function fixture() {
  const questions = generatedQuestions();
  return createDatabase({ uploaded_materials: [material(MATERIAL_A, TEACHER_A), material(MATERIAL_B, TEACHER_A)],
    material_question_sets: [{ id: SET, material_id: MATERIAL_A, name: 'Question Set 1', sequence_number: 1, revision: 1 }],
    comprehension_questions: questions.map((q, i) => ({ id: q.id, material_id: MATERIAL_A, question_set_id: SET,
      question_type: q.type, question_text: q.questionText, options: q.options, scaffolding_hint: q.scaffoldingHint, review_status: 'generated', display_order: i+1 })),
    comprehension_question_answers: questions.map(q => ({ question_id: q.id, correct_answer: q.correctAnswer })),
  });
}

test('failed evidence repairs do not write or overwrite any saved question set', async () => {
  for (const setId of [null, SET]) {
    const db = fixture();
    const before = structuredClone(db.tables);
    let calls = 0;
    db.rpc = () => assert.fail('No persistence is allowed before successful validation');
    await assert.rejects(generateMaterialQuestionSet(requester(TEACHER_A, 'teacher'), MATERIAL_A, setId, setId ? 1 : null,
      input => generateComprehensionQuestions(input, { generateContent: async () => {
        calls++;
        return { text: JSON.stringify({ questions: generatedQuestions().map(q => ({ ...q,
          answerExplanation: 'A generated explanation.', supportingEvidence: 'This fabricated excerpt is not in the saved passage.' })) }) };
      } }), dependencies(db)), { code: 'INVALID_GEMINI_RESPONSE' });
    assert.equal(calls, 2);
    assert.deepEqual(db.tables, before);
  }
});
test('summaries expose counts without prompts or keys, details are scoped to both material and set', async () => {
  const deps = dependencies(fixture()); const teacher = requester(TEACHER_A, 'teacher');
  const sets = await listMaterialQuestionSets(teacher, MATERIAL_A, deps);
  assert.equal(sets.length, 1); assert.equal(sets[0].questionCount, 6);
  assert.deepEqual(sets[0].counts, { literal: 2, inferential: 2, critical: 2 });
  assert.equal('questions' in sets[0], false);
  const detail = await getMaterialQuestionSet(teacher, MATERIAL_A, SET, deps);
  assert.equal(detail.questions.length, 6); assert.equal(detail.questions[0].correctOptionIndex, 0);
  assert.deepEqual(await listMaterialQuestionSets(teacher, MATERIAL_B, deps), []);
  await assert.rejects(getMaterialQuestionSet(teacher, MATERIAL_B, SET, deps), { statusCode: 404 });
});
test('learners and nonowners cannot read keys, create, edit or regenerate', async () => {
  const deps = dependencies(fixture());
  for (const user of [requester(GENERAL, 'general_user'), requester(GENERAL, 'student'), requester(TEACHER_B, 'teacher')]) {
    for (const action of [
      () => listMaterialQuestionSets(user, MATERIAL_A, deps),
      () => getMaterialQuestionSet(user, MATERIAL_A, SET, deps),
      () => generateMaterialQuestionSet(user, MATERIAL_A, null, null, () => { throw Error('Must not generate'); }, deps),
      () => generateMaterialQuestionSet(user, MATERIAL_A, SET, 1, () => { throw Error('Must not generate'); }, deps),
      () => reviewMaterialQuestionSet(user, MATERIAL_A, SET, 1, deps),
      () => saveMaterialQuestionSet(user, MATERIAL_A, SET, 1, generatedQuestions(), deps),
    ]) await assert.rejects(action(), MaterialAuthorizationError);
  }
  assert.equal((await getMaterialQuestionSet(requester(ADMIN, 'admin'), MATERIAL_A, SET, deps)).questions.length, 6);
  await assert.rejects(generateMaterialQuestionSet(requester(ADMIN, 'admin'), MATERIAL_A, null, null, () => [], deps), MaterialAuthorizationError);
});
test('generation uses reviewed source and an atomic create RPC; regeneration sends only the selected set and revision', async () => {
  const db = fixture(); const calls = [];
  db.rpc = async (name, args) => { calls.push({ name, args }); return { data: SET, error: null }; };
  const deps = dependencies(db), teacher = requester(TEACHER_A, 'teacher');
  const generate = async args => { assert.equal(args.contentText, 'Reviewed reading text.'); assert.equal(args.language, 'en');
    // New sets default to 9; regenerating keeps the saved 6-question set's own size.
    assert.equal(args.questionCount, calls.length ? 6 : 9); assert.equal(args.previousQuestions.length, calls.length ? 0 : 6); return generatedQuestions(); };
  await generateMaterialQuestionSet(teacher, MATERIAL_A, null, null, generate, deps);
  await generateMaterialQuestionSet(teacher, MATERIAL_A, SET, 1, generate, deps);
  assert.equal(calls[0].name, 'm3_write_material_question_set');
  assert.equal(calls[0].args.operation, 'create'); assert.equal(calls[0].args.target_set, null);
  assert.equal(calls[1].args.operation, 'regenerate'); assert.equal(calls[1].args.target_set, SET);
  assert.equal(calls[1].args.expected_revision, 1); assert.equal(calls[1].args.actor_id, TEACHER_A);
  await assert.rejects(generateMaterialQuestionSet(teacher, MATERIAL_A, SET, 0, generate, deps), { statusCode: 409 });
  assert.equal(calls.length, 2);
});
test('saving strips client answer/reviewer fields; transaction errors propagate instead of reporting success', async () => {
  const db = fixture(); let captured;
  db.rpc = async (name, args) => { captured = args; return { data: SET, error: null }; };
  const questions = generatedQuestions().map(q => ({ ...q, reviewedBy: TEACHER_B }));
  await saveMaterialQuestionSet(requester(ADMIN, 'admin'), MATERIAL_A, SET, 1, questions, dependencies(db));
  assert.equal(captured.actor_id, ADMIN); assert.equal(captured.operation, 'save');
  assert.equal('correctAnswer' in captured.bank[0], false); assert.equal('reviewedBy' in captured.bank[0], false);
  db.rpc = async () => ({ error: { code: '40001', message: 'Reload changed set.' } });
  await assert.rejects(saveMaterialQuestionSet(requester(TEACHER_A, 'teacher'), MATERIAL_A, SET, 1, questions, dependencies(db)), { statusCode: 409 });
});
test('corrupted saved answer keys fail closed', async () => {
  const db = fixture(); db.tables.comprehension_question_answers[0].correct_answer = 'Missing';
  await assert.rejects(getMaterialQuestionSet(requester(TEACHER_A, 'teacher'), MATERIAL_A, SET, dependencies(db)), { statusCode: 409, code: 'INVALID_ANSWER_KEY' });
});
test('HTTP management endpoints enforce authentication, ownership, IDs, and retire material-wide writes', async t => {
  let user = null; const db = fixture();
  const app = express(); app.use(express.json());
  app.use('/api/materials', createMaterialsRouter({ ...dependencies(db), authorizeMaterialRequest: async () => {
    if (!user) throw new SupabaseAuthenticationError(); return user;
  } }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/materials/${MATERIAL_A}`;
  assert.equal((await fetch(`${base}/question-sets`)).status, 401);
  for (const role of ['student', 'general_user']) {
    user = requester(TEACHER_A, role);
    for (const [path, method] of [['/question-sets','GET'],[`/question-sets/${SET}`,'GET'],['/question-sets','POST'],[`/question-sets/${SET}`,'PUT'],[`/question-sets/${SET}/regenerate`,'POST'],[`/question-sets/${SET}/review`,'POST']]) {
      const response = await fetch(base+path, { method, headers: { 'Content-Type': 'application/json' }, ...(method !== 'GET' ? { body: JSON.stringify({ revision: 1, questions: generatedQuestions() }) } : {}) });
      assert.equal(response.status,403); assert.doesNotMatch(await response.text(), /correctAnswer|correct_answer/);
    }
  }
  user = requester(TEACHER_A, 'teacher');
  assert.equal((await fetch(`${base}/question-sets`)).status, 200);
  assert.equal((await fetch(`${base}/question-sets/not-an-id`)).status, 400);
  assert.equal((await fetch(`${base}/generate-questions`, { method:'POST' })).status,409);
  assert.equal((await fetch(`${base}/questions`, { method:'PUT' })).status,409);
  assert.equal(db.tables.comprehension_questions.length,6);
});
test('deleting one set uses scoped atomic RPC; ownership and stale revisions fail closed', async () => {
  const db = fixture(); const teacher = requester(TEACHER_A, 'teacher');
  let called = 0;
  db.rpc = async (name, args) => {
    called++;
    assert.equal(name, 'm3_write_material_question_set');
    assert.deepEqual(args, { actor_id: TEACHER_A, target_material: MATERIAL_A, target_set: SET, operation: 'delete', expected_revision: 1, bank: null });
    return { data: SET, error: null };
  };
  const deps = dependencies(db);
  for (const user of [requester(TEACHER_B, 'teacher'), requester(GENERAL, 'student'), requester(GENERAL, 'general_user'), requester(ADMIN, 'admin')]) {
    await assert.rejects(deleteMaterialQuestionSet(user, MATERIAL_A, SET, 1, deps), MaterialAuthorizationError);
  }
  assert.equal(called, 0);
  await deleteMaterialQuestionSet(teacher, MATERIAL_A, SET, 1, deps);
  db.rpc = async () => ({ error: { code: '40001', message: 'Reload changed set.' } });
  await assert.rejects(deleteMaterialQuestionSet(teacher, MATERIAL_A, SET, 1, deps), { statusCode: 409 });
});
test('saved count drives regeneration and variable-length review summaries', async () => {
  const db = fixture();
  db.tables.comprehension_questions = db.tables.comprehension_questions.filter((_, i) => i % 2 === 0);
  for (const q of db.tables.comprehension_questions) q.review_status = 'reviewed';
  const deps = dependencies(db); const teacher = requester(TEACHER_A, 'teacher');
  const saved = await getMaterialQuestionSet(teacher, MATERIAL_A, SET, deps);
  assert.equal(saved.questionCount, 3); assert.equal(saved.reviewStatus, 'reviewed');
  let operation;
  db.rpc = async (_, args) => { operation = args.operation; assert.equal(args.bank.length, 3); return { data: SET }; };
  await generateMaterialQuestionSet(teacher, MATERIAL_A, SET, 1, async input => {
    assert.equal(input.questionCount, 3); return generatedQuestions().filter((_, i) => i % 2 === 0);
  }, deps, 12);
  assert.equal(operation, 'regenerate');
  await saveMaterialQuestionSet(teacher, MATERIAL_A, SET, 1, generatedQuestions().filter((_, i) => i % 2 === 0), deps);
  assert.equal(operation, 'save');
});
test('follow-up SQL keeps deletion atomic, scoped, service-only and never renumbers sets', () => {
  const sql = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../supabase/m3_question_set_options.sql'), 'utf8');
  const deletion = sql.slice(sql.indexOf("if operation = 'delete' then"), sql.indexOf("if operation = 'regenerate' and"));
  assert.match(deletion, /delete from public.comprehension_question_answers/);
  assert.match(deletion, /question_set_id = saved_set.id and material_id = target_material/);
  assert.match(deletion, /delete from public.material_question_sets where id = saved_set.id and material_id = target_material/);
  assert.doesNotMatch(deletion, /update public/);
  assert.match(sql, /not in \(3, 6, 9, 12\)/);
  assert.match(sql, /expected_revision is distinct from saved_set.revision/);
  assert.match(sql, /from public, anon, authenticated/);
  assert.match(sql, /to service_role/);
});
test('delete Set 2 preserves Set 1 and Set 3 questions, keys, names and sequence numbers on reopen', async () => {
  const db = fixture();
  const initialQuestions = structuredClone(db.tables.comprehension_questions);
  const initialKeys = structuredClone(db.tables.comprehension_question_answers);
  const set2 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const set3 = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  for (const [id, number] of [[set2, 2], [set3, 3]]) {
    db.tables.material_question_sets.push({ ...db.tables.material_question_sets[0], id, name: `Question Set ${number}`, sequence_number: number });
    for (let i = 0; i < initialQuestions.length; i++) {
      const questionId = require('node:crypto').randomUUID();
      db.tables.comprehension_questions.push({ ...initialQuestions[i], id: questionId, question_set_id: id });
      db.tables.comprehension_question_answers.push({ ...initialKeys[i], question_id: questionId });
    }
  }
  const teacher = requester(TEACHER_A, 'teacher'), deps = dependencies(db);
  const before = await Promise.all([SET, set3].map(id => getMaterialQuestionSet(teacher, MATERIAL_A, id, deps)));
  db.rpc = async (_, args) => {
    assert.equal(args.operation, 'delete'); assert.equal(args.target_set, set2);
    await db.from('comprehension_questions').delete().eq('material_id', args.target_material).eq('question_set_id', args.target_set);
    await db.from('material_question_sets').delete().eq('material_id', args.target_material).eq('id', args.target_set);
    return { data: args.target_set };
  };
  await deleteMaterialQuestionSet(teacher, MATERIAL_A, set2, 1, deps);
  assert.deepEqual(await Promise.all([SET, set3].map(id => getMaterialQuestionSet(teacher, MATERIAL_A, id, deps))), before);
  assert.deepEqual((await listMaterialQuestionSets(teacher, MATERIAL_A, deps)).map(s => s.sequenceNumber), [1, 3]);
  assert.equal(db.tables.comprehension_question_answers.length, 12);
  await assert.rejects(getMaterialQuestionSet(teacher, MATERIAL_A, set2, deps), { statusCode: 404 });
});
test('assigned sets report usage, cannot be deleted, and lock edits once students have answered', async () => {
  const db = fixture(); const teacher = requester(TEACHER_A, 'teacher'), deps = dependencies(db);
  const ASSIGNMENT = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  db.tables.reading_activity_assignments.push({ id: ASSIGNMENT, material_id: MATERIAL_A, question_set_id: SET },
    { id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', material_id: MATERIAL_A, question_set_id: null });
  const calls = [];
  db.rpc = async (_, args) => { calls.push(args.operation); return { data: SET, error: null }; };
  const [summary] = await listMaterialQuestionSets(teacher, MATERIAL_A, deps);
  assert.equal(summary.assignedCount, 1); assert.equal(summary.hasStudentAttempts, false);
  await assert.rejects(deleteMaterialQuestionSet(teacher, MATERIAL_A, SET, 1, deps),
    { statusCode: 409, message: 'This question set is assigned to a class activity. Remove the assignment first.' });
  // Assigned but unanswered: editing and regenerating stay allowed.
  await saveMaterialQuestionSet(teacher, MATERIAL_A, SET, 1, generatedQuestions(), deps);
  await generateMaterialQuestionSet(teacher, MATERIAL_A, SET, 1, async () => generatedQuestions(), deps);
  assert.deepEqual(calls, ['save', 'regenerate']);
  db.tables.m6_comprehension_attempts.push({ id: 'attempt', activity_assignment_id: ASSIGNMENT });
  assert.equal((await getMaterialQuestionSet(teacher, MATERIAL_A, SET, deps)).hasStudentAttempts, true);
  await assert.rejects(saveMaterialQuestionSet(teacher, MATERIAL_A, SET, 1, generatedQuestions(), deps), { statusCode: 409, message: /already answered/ });
  await assert.rejects(generateMaterialQuestionSet(teacher, MATERIAL_A, SET, 1, () => assert.fail('Must not generate'), deps), { statusCode: 409, message: /already answered/ });
  assert.equal(calls.length, 2);
  // The database restriction gives the same message if an assignment appears mid-request.
  db.tables.reading_activity_assignments = [];
  db.rpc = async () => ({ error: { code: '23001', message: 'violates RESTRICT setting' } });
  await assert.rejects(deleteMaterialQuestionSet(teacher, MATERIAL_A, SET, 1, deps), { statusCode: 409, message: /Remove the assignment first/ });
});


test('approval without edits validates saved questions and exposes the reviewed set to assignment lists', async () => {
  const db = fixture(), deps = dependencies(db), teacher = requester(TEACHER_A, 'teacher');
  const before = await getMaterialQuestionSet(teacher, MATERIAL_A, SET, deps);
  const keys = structuredClone(db.tables.comprehension_question_answers);
  assert.equal((await listMaterialQuestionSets(teacher, MATERIAL_A, deps)).filter(s => s.reviewStatus === 'reviewed').length, 0);
  db.rpc = async (_, args) => {
    assert.equal(args.operation, 'approve');
    assert.equal(args.expected_revision, 1);
    assert.deepEqual(args.bank.map(q => q.id), before.questions.map(q => q.id));
    db.tables.comprehension_questions.forEach(q => { q.review_status = 'reviewed'; });
    db.tables.material_question_sets[0].revision++;
    return { data: SET };
  };
  const approved = await reviewMaterialQuestionSet(teacher, MATERIAL_A, SET, 1, deps);
  assert.equal(approved.reviewStatus, 'reviewed');
  assert.deepEqual(approved.questions, before.questions.map(q => ({ ...q, reviewStatus: 'reviewed' })));
  assert.deepEqual(db.tables.comprehension_question_answers, keys);
  assert.deepEqual((await listMaterialQuestionSets(teacher, MATERIAL_A, deps)).filter(s => s.reviewStatus === 'reviewed').map(s => s.id), [SET]);
  await assert.rejects(reviewMaterialQuestionSet(teacher, MATERIAL_A, SET, 1, deps), { statusCode: 409 });
});

test('approval rejects incomplete sets and invalid saved answer keys before any write', async () => {
  for (const corrupt of [
    db => { db.tables.comprehension_questions[0].question_text = ''; },
    db => { db.tables.comprehension_questions.pop(); },
    db => { db.tables.comprehension_question_answers[0].correct_answer = 'Missing'; },
  ]) {
    const db = fixture(); corrupt(db);
    db.rpc = () => assert.fail('Invalid content must not be approved');
    await assert.rejects(reviewMaterialQuestionSet(requester(TEACHER_A, 'teacher'), MATERIAL_A, SET, 1, dependencies(db)));
  }
});

test('separate review SQL updates only metadata on approval and resets changed questions on save', () => {
  const sql = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../supabase/migrations/20261012_separate_question_review.sql'), 'utf8');
  const approval = sql.slice(sql.indexOf("if operation = 'approve' then"), sql.indexOf('if (old_question.question_type'));
  assert.match(approval, /review_status = 'reviewed'/);
  assert.match(approval, /continue;/);
  assert.doesNotMatch(approval, /update public.comprehension_question_answers|set question_type|set question_text|set options/);
  assert.match(sql, /review_status = 'generated', reviewed_by = null, reviewed_at = null/);
  assert.match(sql, /expected_revision is distinct from saved_set.revision/);
  assert.match(sql, /join public.m6_comprehension_attempts/);
});


const unsupportedOperation = { code: '22023', message: 'Invalid question set operation' };

function legacyReviewRpc(db, calls) {
  return async (name, args) => {
    calls.push(args);
    assert.equal(name, 'm3_write_material_question_set');
    if (!['create', 'regenerate', 'review', 'delete'].includes(args.operation)) {
      return { error: unsupportedOperation };
    }
    assert.equal(args.operation, 'review');
    const set = db.tables.material_question_sets.find(s => s.id === args.target_set && s.material_id === args.target_material);
    if (set.revision !== args.expected_revision) return { error: { code: '40001', message: 'Reload changed set.' } };
    for (const item of args.bank) {
      const row = db.tables.comprehension_questions.find(q => q.id === item.id && q.question_set_id === set.id);
      assert.ok(row);
      const answer = db.tables.comprehension_question_answers.find(a => a.question_id === row.id);
      const answerIndex = row.options.indexOf(answer.correct_answer);
      assert.ok(answerIndex >= 0);
      Object.assign(row, { question_type: item.type, question_text: item.questionText.trim(),
        options: [...item.options], scaffolding_hint: item.scaffoldingHint.trim(),
        review_status: 'reviewed', reviewed_by: args.actor_id });
      answer.correct_answer = item.options[answerIndex];
    }
    set.revision++;
    return { data: set.id };
  };
}

test('legacy database approves unchanged saved content using review, preserving exact options and answers', async () => {
  const db = fixture(), calls = [], teacher = requester(TEACHER_A, 'teacher'), deps = dependencies(db);
  // Valid but non-normalized options must not be silently trimmed during approval.
  db.tables.comprehension_questions[0].options[0] = ' Answer 0 ';
  db.tables.comprehension_question_answers[0].correct_answer = ' Answer 0 ';
  const before = await getMaterialQuestionSet(teacher, MATERIAL_A, SET, deps);
  const keys = structuredClone(db.tables.comprehension_question_answers);
  db.rpc = legacyReviewRpc(db, calls);
  const approved = await reviewMaterialQuestionSet(teacher, MATERIAL_A, SET, 1, deps);
  assert.deepEqual(calls.map(c => c.operation), ['approve', 'review']);
  assert.equal(calls[1].actor_id, TEACHER_A);
  assert.equal(calls[1].expected_revision, 1);
  assert.equal(approved.reviewStatus, 'reviewed');
  assert.deepEqual(approved.questions, before.questions.map(q => ({ ...q, reviewStatus: 'reviewed' })));
  assert.deepEqual(db.tables.comprehension_question_answers, keys);
  assert.equal((await listMaterialQuestionSets(teacher, MATERIAL_A, deps)).filter(s => s.reviewStatus === 'reviewed').length, 1);
});

test('approval does not retry authorization, conflict, validation or network failures as legacy review', async () => {
  for (const error of [
    { code: '42501', message: 'Not authorized' },
    { code: '40001', message: 'Reload changed set.' },
    { code: '22023', message: 'Invalid saved answer key' },
    { code: '08006', message: 'Network failure' },
  ]) {
    const db = fixture(), before = structuredClone(db.tables); let calls = 0;
    db.rpc = async () => { calls++; return { error }; };
    await assert.rejects(reviewMaterialQuestionSet(requester(TEACHER_A, 'teacher'), MATERIAL_A, SET, 1, dependencies(db)));
    assert.equal(calls, 1);
    assert.deepEqual(db.tables, before);
  }
});

test('failed legacy approval preserves Needs Review and allows a subsequent retry', async () => {
  const db = fixture(), before = structuredClone(db.tables), teacher = requester(TEACHER_A, 'teacher'), deps = dependencies(db);
  db.rpc = async (_, args) => ({ error: args.operation === 'approve' ? unsupportedOperation : { code: '40001', message: 'Reload changed set.' } });
  await assert.rejects(reviewMaterialQuestionSet(teacher, MATERIAL_A, SET, 1, deps), { statusCode: 409 });
  assert.deepEqual(db.tables, before);
  db.rpc = legacyReviewRpc(db, []);
  assert.equal((await reviewMaterialQuestionSet(teacher, MATERIAL_A, SET, 1, deps)).reviewStatus, 'reviewed');
});

test('legacy fallback rechecks revisions and student locks before submitting review', async () => {
  for (const change of [
    db => { db.tables.material_question_sets[0].revision++; },
    db => {
      db.tables.reading_activity_assignments.push({ id: 'assignment', material_id: MATERIAL_A, question_set_id: SET });
      db.tables.m6_comprehension_attempts.push({ id: 'attempt', activity_assignment_id: 'assignment' });
    },
  ]) {
    const db = fixture(); let calls = 0;
    db.rpc = async () => { calls++; change(db); return { error: unsupportedOperation }; };
    await assert.rejects(reviewMaterialQuestionSet(requester(TEACHER_A, 'teacher'), MATERIAL_A, SET, 1, dependencies(db)), { statusCode: 409 });
    assert.equal(calls, 1);
    assert.ok(db.tables.comprehension_questions.every(q => q.review_status === 'generated'));
  }
});

test('saving never falls back to the legacy operation that would approve edits', async () => {
  const db = fixture(), before = structuredClone(db.tables); let calls = 0;
  db.rpc = async () => { calls++; return { error: unsupportedOperation }; };
  await assert.rejects(saveMaterialQuestionSet(requester(TEACHER_A, 'teacher'), MATERIAL_A, SET, 1,
    generatedQuestions(), dependencies(db)), { statusCode: 409, message: /Saving edits separately.*No edits were saved/ });
  assert.equal(calls, 1);
  assert.deepEqual(db.tables, before);
});

test('legacy review refuses to silently trim stored question text', async () => {
  const db = fixture(); db.tables.comprehension_questions[0].question_text += ' ';
  let calls = 0;
  db.rpc = async () => { calls++; return { error: unsupportedOperation }; };
  await assert.rejects(reviewMaterialQuestionSet(requester(TEACHER_A, 'teacher'), MATERIAL_A, SET, 1, dependencies(db)),
    { statusCode: 409, message: /without changing its saved text/ });
  assert.equal(calls, 1);
});

test('HTTP review accepts revision only and ignores submitted edits or operation overrides', async t => {
  const db = fixture(), calls = [], before = structuredClone(db.tables.comprehension_questions);
  db.rpc = legacyReviewRpc(db, calls);
  const app = express(); app.use(express.json());
  app.use('/api/materials', createMaterialsRouter({ ...dependencies(db), authorizeMaterialRequest: async () => requester(TEACHER_A, 'teacher') }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/materials/${MATERIAL_A}/question-sets/${SET}/review`;
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ revision: 1, operation: 'regenerate', questions: [{ questionText: 'Injected edit' }] }) });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).set.reviewStatus, 'reviewed');
  assert.deepEqual(db.tables.comprehension_questions.map(q => q.question_text), before.map(q => q.question_text));
  const stale = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: 1 }) });
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).success, false);
  assert.equal(calls.length, 2);
});
