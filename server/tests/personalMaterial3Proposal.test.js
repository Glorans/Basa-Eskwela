// personal_material_3_text_edits_and_new_questions (PROPOSED, NOT applied to Staging): edit the reading text after
// practice and get new questions for the same text, against the real private SQL (in-memory database, whose function
// bodies were verified identical to ReadFlow-Staging on 2026-11-18) and the real routes. No paid AI: fixture generator.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const express = require('express');
const { fixture, owner, story } = require('./fixtures/personalMaterialDatabase');
const { id, sqlFile } = require('./fixtures/m5M6SecurityDatabase');
const sqlClient = require('./fixtures/personalSqlClient');
const NAME = 'personal_material_3_text_edits_and_new_questions';
const read = kind => fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'proposed', `${NAME}_${kind}.sql`), 'utf8');

test('proposal files: guarded, private, reversible', () => {
  const proposed = read('PROPOSED');
  assert.match(proposed, /^begin;$/m); assert.match(proposed, /^commit;$/m);
  for (const sig of ['personal_material_access(uuid,uuid,text,text,jsonb)', 'personal_material_generation(uuid,uuid,text,uuid,jsonb)',
    'personal_material_text_guard()', 'personal_material_assessment_guard()']) assert.ok(proposed.includes(`STOP: unexpected installed definition of ${sig}`), sig);
  assert.match(proposed, /revoke all on function public\.personal_material_features\(\) from public,anon,authenticated;/);
  assert.match(proposed, /raise exception 'Finish your comprehension first\. Then you can edit the text\.';/);
  assert.doesNotMatch(read('PREFLIGHT_READONLY').replace(/--[^\n]*/g, ''), /\b(insert|update|delete|drop|alter|create|grant|revoke)\b/i);
  assert.doesNotMatch(read('VERIFY_READONLY').replace(/--[^\n]*/g, ''), /\b(insert|update|delete|drop|alter|create|grant|revoke)\b/i);
  assert.match(read('ROLLBACK_PROPOSED'), /delete from public\.personal_material_question_sets where replaced_at is not null;/);
});

test('with personal_material_3: edit after practice, history unchanged, outdated and new questions, assessment locks', async () => {
  const db = await fixture(); let server;
  try {
    const client = sqlClient(db), mat = id(900);
    await db.exec(`alter table public.profiles add column full_name text,add column nickname text; update public.profiles set role='general_user' where id='${id(1)}';`);
    await db.exec(`alter table public.uploaded_materials add column original_filename text,add column storage_path text,
      add column mime_type text,add column file_size_bytes bigint,add column raw_extracted_text text,
      add column ocr_confidence numeric,add column created_at timestamptz default now(),add column updated_at timestamptz default now();`);
    const original = 'Ana reeds a book. She shares the book with her friend.';
    await db.query(`insert into public.uploaded_materials(id,uploaded_by,title,content_text,raw_extracted_text,language,extraction_status,original_filename)
      values($1,$2,'Private',$3,$3,'en','completed','story.pdf')`, [mat, owner, original]);
    const pre = (await db.query(read('PREFLIGHT_READONLY').replace(/--[^\n]*/g, ''))).rows;
    assert.deepEqual(pre.filter(r => !r.ok).map(r => r.check_name), [], 'PREFLIGHT on the copy');
    await db.exec(read('PROPOSED'));
    const post = (await db.query(read('VERIFY_READONLY').replace(/--[^\n]*/g, ''))).rows;
    assert.deepEqual(post.filter(r => !r.ok).map(r => r.check_name), [], 'VERIFY on the copy');

    const auth = require('../services/supabaseAdmin');
    test.mock.method(auth, 'getSupabaseAdmin', () => client);
    const users = { owner, other: id(1) };
    test.mock.method(auth, 'getAuthenticatedSupabaseUser', async req => ({ id: users[req.headers.authorization.slice(7)] }));
    const providerInputs = [];
    let round = 0;
    const { createMaterialsRouter } = require('../routes/materials');
    const app = express(); app.use(express.json());
    app.use('/api/materials', createMaterialsRouter({ generateComprehensionQuestions: async input => {
      providerInputs.push(input); round++;
      return Array.from({ length: 9 }, (_, i) => ({ type: ['literal', 'inferential', 'critical'][Math.floor(i / 3)],
        questionText: `Round ${round}: what happens ${i}?`, options: ['Reads', 'Sleeps', 'Swims', 'Sings'], correctAnswer: 'Reads',
        answerExplanation: 'Ana reads.', supportingEvidence: 'Ana', scaffoldingHint: 'Read again.' }));
    } }));
    app.use('/api/comprehension', require('../routes/comprehension'));
    app.use('/api/oral-reading', require('../routes/oralReading').createOralReadingRouter());
    server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
    const request = async (p, body, user = 'owner', method = body === undefined ? 'GET' : 'POST') => {
      const r = await fetch(`http://127.0.0.1:${server.address().port}/api${p}`, { method,
        headers: { Authorization: 'Bearer ' + user, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: r.status, body: await r.json() };
    };
    const state = async () => (await request(`/materials/${mat}/personal-practice`)).body.state;
    const confirm = async () => assert.equal((await request(`/materials/${mat}/personal-practice/confirm`, { confirmed: true, revision: (await state()).revision })).status, 200);
    const saveText = async text => request(`/materials/${mat}/personal-practice/text`, { contentText: text, revision: (await state()).revision }, 'owner', 'PUT');
    const readAloud = async (text, n) => {
      const source = (await request(`/oral-reading/materials/${mat}`)).body.module;
      const r = await request('/oral-reading/attempts', { materialId: mat, passageRevision: source.passageRevision, submissionId: id(n), transcript: text, durationSeconds: 15 });
      assert.equal(r.status, 201, JSON.stringify(r.body)); return r.body.attempt;
    };
    const sets = async () => (await db.query('select id,revision,replaced_at,questions from public.personal_material_question_sets where material_id=$1 order by created_at', [mat])).rows;

    // Practice with the first text: confirm, questions, a reading.
    await confirm();
    assert.equal((await request(`/materials/${mat}/personal-practice/generate`, {})).status, 200);
    const firstReading = await readAloud(original, 910);
    let s = await state();
    assert.equal(s.canEditText, true, 'editing stays available after practice');
    assert.equal(s.questionsLockedReason, null, 'no lock before an assessment');
    assert.equal(s.canGetNewQuestions, true);

    // Edit after practice: the new text is used from now on; the saved reading and its questions are unchanged.
    const snapshotBefore = (await db.query('select passage_snapshot from public.oral_reading_attempts where id=$1', [firstReading.id])).rows[0].passage_snapshot;
    const edited = await saveText(story);
    assert.equal(edited.status, 200, JSON.stringify(edited.body));
    assert.equal((await db.query('select raw_extracted_text from public.uploaded_materials where id=$1', [mat])).rows[0].raw_extracted_text, original, 'original extraction kept');
    assert.equal((await db.query('select passage_snapshot from public.oral_reading_attempts where id=$1', [firstReading.id])).rows[0].passage_snapshot, snapshotBefore, 'saved reading unchanged');
    s = edited.body.state;
    assert.equal(s.reviewed, false, 'changed text is confirmed again');
    assert.equal(s.readingId, null, 'read the new text aloud again');
    assert.equal(s.questionSetId, null);
    assert.equal(s.questionsOutdated, true, 'questions for the old text are never used for the new text');
    await confirm();
    assert.equal((await request(`/materials/${mat}/personal-practice/questions`)).status, 409, 'no preview of outdated questions');
    // Saving the same text again changes nothing and keeps the confirmation.
    assert.equal((await saveText(story)).body.state.reviewed, true);

    // New questions for the new text, then NEW questions for the same text (the replaced set is kept).
    assert.equal((await request(`/materials/${mat}/personal-practice/generate`, {})).status, 200);
    const firstNewTextSet = (await request(`/materials/${mat}/personal-practice/questions`)).body;
    const replaced = await request(`/materials/${mat}/personal-practice/new-questions`, {});
    assert.equal(replaced.status, 200, JSON.stringify(replaced.body));
    assert.ok(providerInputs.at(-1).previousQuestions.length === 9, 'asks for different questions than the replaced ones');
    const afterReplace = (await request(`/materials/${mat}/personal-practice/questions`)).body;
    assert.notEqual(afterReplace.questionSetId, firstNewTextSet.questionSetId);
    assert.match(afterReplace.questions[0].questionText, /^Round 3/);
    assert.doesNotMatch(JSON.stringify(afterReplace), /correct|explanation|evidence|hint/i);
    const all = await sets();
    assert.equal(all.length, 3, 'every set is kept');
    assert.equal(all.filter(x => x.replaced_at).length, 1);
    assert.equal(all.filter(x => !x.replaced_at && x.revision === s.revision).length, 1, 'one current set per text');
    // The 5-per-24-hours limit counts replaced sets: 3 so far, two more, then refused.
    for (let i = 0; i < 2; i++) assert.equal((await request(`/materials/${mat}/personal-practice/new-questions`, {})).status, 200);
    const limited = await request(`/materials/${mat}/personal-practice/new-questions`, {});
    assert.equal(limited.status, 409); assert.match(limited.body.message, /Five new question sets are allowed per rolling 24 hours/);
    assert.equal((await sets()).length, 5);
    assert.equal((await request(`/materials/${mat}/personal-practice/new-questions`, {}, 'other')).status, 403, 'another learner cannot');

    // Read the new text, start the assessment: it uses the current set; replacing is now refused.
    const reading = await readAloud(story, 920);
    const current = (await request(`/materials/${mat}/personal-practice/questions`)).body;
    const started = await request('/comprehension/attempts', { materialId: mat, oralReadingAttemptId: reading.id, submissionId: id(921) });
    assert.equal(started.status, 201, JSON.stringify(started.body));
    assert.deepEqual(started.body.attempt.questions.map(q => q.id).sort(), current.questions.map(q => q.id).sort(), 'the assessment uses the current set');
    s = await state();
    assert.equal(s.canGetNewQuestions, false);
    assert.equal((await db.query('update public.personal_material_question_sets set replaced_at=null where false returning 1')).rowCount, 0);
    const blockedReplace = await request(`/materials/${mat}/personal-practice/new-questions`, {});
    assert.equal(blockedReplace.status, 409, 'no new questions once an assessment exists');

    // While unfinished: the text is locked (server and database); answers keep working.
    assert.equal(s.canEditText, false); assert.equal(s.textLockedReason, 'assessment_unfinished');
    assert.equal(s.questionsLockedReason, 'assessment_unfinished', 'questions locked while unfinished');
    const locked = await saveText('Something else.');
    assert.equal(locked.status, 409); assert.match(locked.body.message, /Finish your comprehension first/);
    await assert.rejects(db.query(`update public.uploaded_materials set content_text='x' where id=$1`, [mat]), /Finish your comprehension first/);
    const attempt = started.body.attempt;
    for (const q of attempt.questions) {
      const answered = await request(`/comprehension/attempts/${attempt.id}/actions`, { action: 'answer', questionId: q.id, optionIndex: 0, requestId: randomUUID() });
      assert.equal(answered.status, 200, JSON.stringify(answered.body));
    }
    let done = (await request(`/comprehension/attempts/${attempt.id}`)).body.attempt;
    if (done.status !== 'completed') {
      assert.equal((await request(`/comprehension/attempts/${attempt.id}/actions`, { action: 'complete' })).status, 200);
      done = (await request(`/comprehension/attempts/${attempt.id}`)).body.attempt;
    }
    assert.equal(done.status, 'completed');
    const result = async () => (await db.query(`select to_jsonb(a) r, (select jsonb_agg(to_jsonb(x) order by x.question_id) from public.m6_comprehension_responses x where x.attempt_id=a.id) responses
      from public.m6_comprehension_attempts a where a.id=$1`, [attempt.id])).rows[0];
    const completedBefore = await result();

    // After completion the text can be corrected again; the completed result never changes and no second assessment.
    s = await state();
    assert.equal(s.canEditText, true); assert.equal(s.canGetNewQuestions, false);
    assert.equal(s.questionsLockedReason, 'assessment_completed', 'questions locked after completion');
    assert.equal((await saveText(`${story} The end.`)).status, 200);
    assert.deepEqual(await result(), completedBefore, 'completed assessment and its answers unchanged (whole rows)');
    s = await state();
    assert.equal(s.attemptStatus, 'completed', 'the completed result is still shown');
    assert.equal(s.questionsOutdated, false, 'no new questions are needed: one assessment per material');
    await confirm();
    const regenerate = await request(`/materials/${mat}/personal-practice/generate`, {});
    assert.equal(regenerate.status, 409); assert.match(regenerate.body.message, /already has an assessment/);
    const newReading = await readAloud(`${story} The end.`, 930);
    const second = await request('/comprehension/attempts', { materialId: mat, oralReadingAttemptId: newReading.id, submissionId: id(931) });
    // Starting again only returns the same, completed assessment (existing rule); it never creates a second one.
    assert.equal(second.body.attempt?.id, attempt.id, `same assessment: ${JSON.stringify(second.body).slice(0, 160)}`);
    assert.equal(second.body.attempt?.status, 'completed');
    assert.equal((await db.query('select count(*)::int n from public.m6_comprehension_attempts where material_id=$1', [mat])).rows[0].n, 1);

    // Rollback restores the original behaviour (replaced sets are removed; nothing an assessment used).
    await db.exec(read('ROLLBACK_PROPOSED'));
    const back = (await db.query(read('PREFLIGHT_READONLY').replace(/--[^\n]*/g, ''))).rows;
    assert.deepEqual(back.filter(r => !r.ok).map(r => r.check_name), [], 'PREFLIGHT passes again after rollback');
    assert.equal((await db.query('select count(*)::int n from public.m6_comprehension_attempts where material_id=$1', [mat])).rows[0].n, 1);
    assert.deepEqual(await result(), completedBefore);
  } finally { if (server) await new Promise(r => server.close(r)); await db.close(); test.mock.restoreAll(); }
});

test('without personal_material_3 (current Staging): the existing lock and one-set rule stay in force', async () => {
  // Covered end to end by personalMaterialManagement.test.js; here only the feature probe.
  const { personalFeatures } = require('../services/personalMaterialService');
  assert.deepEqual(await personalFeatures({ rpc: async () => ({ data: null, error: { code: 'PGRST202' } }) }), {});
  assert.deepEqual(await personalFeatures({ rpc: async () => ({ data: { textEditsAfterPractice: true, newQuestions: true }, error: null }) }),
    { textEditsAfterPractice: true, newQuestions: true });
  void sqlFile;
});
