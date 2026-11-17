// Independent Learner content management (edit text, preview questions, Trash and Restore) against the real private
// SQL (in-memory database, including personal_material_text_guard) and the real routes. Its own file: the services
// capture the mocked Supabase client at load. No paid AI: question generation is a fixture.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { fixture, owner, story } = require('./fixtures/personalMaterialDatabase');
const { id } = require('./fixtures/m5M6SecurityDatabase');
const sqlClient = require('./fixtures/personalSqlClient');

test('IL content management: edit text before practice, preview without answers, Trash and Restore keep every record', async () => {
  const db = await fixture(); let server;
  try {
    const client = sqlClient(db), mat = id(900), second = id(901), fresh = id(902);
    await db.exec(`alter table public.profiles add column full_name text,add column nickname text; update public.profiles set role='general_user' where id='${id(1)}';`);
    await db.exec(`alter table public.uploaded_materials add column original_filename text,add column storage_path text,
      add column mime_type text,add column file_size_bytes bigint,add column raw_extracted_text text,
      add column ocr_confidence numeric,add column created_at timestamptz default now(),add column updated_at timestamptz default now();`);
    await db.query(`insert into public.uploaded_materials(id,uploaded_by,title,content_text,raw_extracted_text,language,extraction_status,original_filename)
      values($1,$2,'Private',$3,$3,'en','completed','story.pdf'),($4,$5,'Other',$3,$3,'en','completed','other.pdf'),
            ($6,$2,'Fresh',$3,$3,'en','completed','fresh.pdf')`, [mat, owner, 'Ana reeds a book. She shares the book with her friend.', second, id(1), fresh]);
    const auth = require('../services/supabaseAdmin');
    test.mock.method(auth, 'getSupabaseAdmin', () => client);
    const users = { owner, other: id(1), teacher: id(3) };
    test.mock.method(auth, 'getAuthenticatedSupabaseUser', async req => ({ id: users[req.headers.authorization.slice(7)] }));
    let providerCalls = 0;
    const { createMaterialsRouter } = require('../routes/materials');
    const app = express(); app.use(express.json());
    app.use('/api/materials', createMaterialsRouter({ generateComprehensionQuestions: async () => { providerCalls++; return Array.from({ length: 9 }, (_, i) => ({
      type: ['literal', 'inferential', 'critical'][Math.floor(i / 3)], questionText: `What happens ${i}?`, options: ['Reads', 'Sleeps', 'Swims', 'Sings'],
      correctAnswer: 'Reads', answerExplanation: 'SECRET explanation.', supportingEvidence: 'Ana reads a book.', scaffoldingHint: 'SECRET hint.' })); } }));
    app.use('/api/comprehension', require('../routes/comprehension'));
    app.use('/api/oral-reading', require('../routes/oralReading').createOralReadingRouter());
    server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
    const request = async (path, body, user = 'owner', method = body === undefined ? 'GET' : 'POST') => {
      const r = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method,
        headers: { Authorization: 'Bearer ' + user, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: r.status, body: await r.json() };
    };
    const state = async (m = mat) => (await request(`/materials/${m}/personal-practice`)).body.state;
    const saveText = (contentText, revision, m = mat, user = 'owner') => request(`/materials/${m}/personal-practice/text`, { contentText, revision }, user, 'PUT');
    const row = async m => (await db.query('select content_text,raw_extracted_text from public.uploaded_materials where id=$1', [m])).rows[0];

    // 1. Edit the extracted text before practice. Only the practice text changes; the original extraction is kept.
    let s = await state();
    assert.equal(s.reviewed, false);
    assert.equal((await saveText('Ana reads a book.', 'stale-revision')).status, 409, 'a stale revision is refused, never overwritten');
    assert.equal((await saveText('   ', s.revision)).status, 400);
    assert.equal((await saveText('Hacked.', s.revision, mat, 'other')).status, 403, 'another learner cannot edit');
    assert.equal((await saveText('Hacked.', s.revision, mat, 'teacher')).status, 403, 'a Teacher cannot edit a learner text here');
    const saved = await saveText(`${story}\r\n`, s.revision);
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal((await row(mat)).content_text, story, 'corrected text saved (line endings normalized, trimmed)');
    assert.equal((await row(mat)).raw_extracted_text, 'Ana reeds a book. She shares the book with her friend.', 'the original extraction is unchanged');
    assert.notEqual(saved.body.state.revision, s.revision);
    assert.equal(saved.body.state.reviewed, false, 'changed text must be confirmed again');
    // Unchanged text keeps a confirmation.
    s = await state();
    assert.equal((await request(`/materials/${mat}/personal-practice/confirm`, { confirmed: true, revision: s.revision })).status, 200);
    const same = await saveText(story, s.revision);
    assert.equal(same.status, 200); assert.equal(same.body.state.reviewed, true, 'saving the same text keeps the confirmation');
    // Reopening needs no new confirmation.
    assert.equal((await state()).reviewed, true);

    // 2. Generate, then preview: no answer keys, nothing written, the assessment is not started.
    assert.equal((await request(`/materials/${mat}/personal-practice/questions`)).status, 409, 'no preview before generation');
    assert.equal((await request(`/materials/${mat}/personal-practice/generate`, {})).status, 200);
    assert.equal(providerCalls, 1);
    const attemptsBefore = (await db.query('select count(*)::int n from public.m6_comprehension_attempts')).rows[0].n;
    const preview = await request(`/materials/${mat}/personal-practice/questions`);
    assert.equal(preview.status, 200, JSON.stringify(preview.body));
    assert.equal(preview.body.questions.length, 9);
    assert.deepEqual(preview.body.questions.map(q => q.type), ['literal', 'literal', 'literal', 'inferential', 'inferential', 'inferential', 'critical', 'critical', 'critical']);
    for (const q of preview.body.questions) assert.deepEqual(Object.keys(q).sort(), ['id', 'options', 'questionText', 'type']);
    assert.doesNotMatch(JSON.stringify(preview.body), /correct|SECRET|explanation|evidence|hint/i);
    assert.equal((await request(`/materials/${mat}/personal-practice/questions`)).status, 200, 'previewing twice is fine');
    assert.equal((await db.query('select count(*)::int n from public.m6_comprehension_attempts')).rows[0].n, attemptsBefore, 'preview never starts an assessment');
    assert.equal((await state()).attemptId, null);
    assert.equal((await request(`/materials/${mat}/personal-practice/questions`, undefined, 'other')).status, 403, 'another learner cannot preview');
    assert.equal(providerCalls, 1, 'preview never calls the provider');

    // 3. Once practice has started the text is locked (server check and database trigger).
    s = await state();
    const locked = await saveText('Something new.', s.revision);
    assert.equal(locked.status, 409);
    assert.match(locked.body.message, /already practiced with this text/);
    await assert.rejects(db.query(`update public.uploaded_materials set content_text='x' where id=$1`, [mat]), /Personal practice has started/,
      'the database trigger refuses too');

    // 4. Read Aloud and start the assessment (one per material), then Trash and Restore.
    const source = (await request(`/oral-reading/materials/${mat}`)).body.module;
    const reading = await request('/oral-reading/attempts', { materialId: mat, passageRevision: source.passageRevision, submissionId: id(910), transcript: story, durationSeconds: 15 });
    assert.equal(reading.status, 201, JSON.stringify(reading.body));
    const started = await request('/comprehension/attempts', { materialId: mat, oralReadingAttemptId: reading.body.attempt.id, submissionId: id(911) });
    assert.equal(started.status, 201, JSON.stringify(started.body));
    const history = async () => (await db.query(`select (select count(*) from public.oral_reading_attempts where material_id=$1)::int r,
      (select count(*) from public.m6_comprehension_attempts where material_id=$1)::int a,
      (select count(*) from public.personal_material_question_sets where material_id=$1)::int q`, [mat])).rows[0];
    const before = await history();

    const listIds = async (path, user = 'owner') => (await request(path, undefined, user)).body.materials?.map(m => m.id);
    assert.ok((await listIds('/materials')).includes(mat));
    assert.deepEqual(await listIds('/materials/trash'), []);
    assert.equal((await request(`/materials/${mat}`, undefined, 'owner', 'DELETE')).status, 200, 'Move to Trash');
    assert.ok(!(await listIds('/materials')).includes(mat), 'gone from My Materials');
    const trash = (await request('/materials/trash')).body.materials;
    assert.deepEqual(trash.map(m => m.id), [mat], 'listed in Trash');
    assert.ok(trash[0].deletedAt);
    assert.equal(trash[0].title, 'Private'); assert.equal(trash[0].originalFilename, 'story.pdf');
    assert.equal((await request(`/materials/${mat}/personal-practice/questions`)).status, 403, 'no practice while in Trash');
    assert.deepEqual(await history(), before, 'Trash erases nothing');
    assert.deepEqual(await listIds('/materials/trash', 'other'), [], 'another learner never sees this Trash');
    assert.equal((await request('/materials/trash', undefined, 'teacher')).status, 403, 'Trash is for Independent Learners');
    assert.equal((await request(`/materials/${mat}/personal-practice/restore`, {}, 'other')).status, 403, 'another learner cannot restore');
    assert.equal((await request(`/materials/${fresh}/personal-practice/restore`, {})).status, 409, 'only materials in Trash can be restored');

    const restored = await request(`/materials/${mat}/personal-practice/restore`, {});
    assert.equal(restored.status, 200, JSON.stringify(restored.body));
    assert.ok((await listIds('/materials')).includes(mat), 'back in My Materials');
    assert.deepEqual(await listIds('/materials/trash'), []);
    assert.deepEqual(await history(), before, 'restore keeps readings, questions and the assessment');
    s = await state();
    assert.equal(s.reviewed, true, 'the confirmation is kept');
    assert.equal(s.attemptId, started.body.attempt.id, 'the same unfinished assessment resumes');
    assert.equal(s.attemptStatus, 'in_progress');
    const again = await request('/comprehension/attempts', { materialId: mat, oralReadingAttemptId: reading.body.attempt.id, submissionId: id(912) });
    // Starting again resumes the same assessment (existing rule); it never creates a second one.
    assert.equal(again.body.attempt?.id, started.body.attempt.id, `resumes, not a new attempt: ${JSON.stringify(again.body).slice(0, 160)}`);
    assert.deepEqual(await history(), before, 'still one assessment per material after Restore');
    assert.equal((await request(`/materials/${mat}/personal-practice/questions`)).status, 200, 'preview works again after Restore');
    assert.equal(providerCalls, 1);
  } finally { if (server) await new Promise(r => server.close(r)); await db.close(); test.mock.restoreAll(); }
});
