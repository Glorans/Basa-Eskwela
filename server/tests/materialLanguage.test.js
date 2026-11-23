const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { randomUUID } = require('node:crypto');
const { createCanvas } = require('@napi-rs/canvas');
const { detectMaterialLanguage } = require('../services/materialLanguageDetection');
const { extractTeacherMaterial } = require('../services/teacherMaterialExtraction');
const { terminateOcrWorker } = require('../services/materialOcrService');
const { validateMaterialFields } = require('../services/materialValidation');
const { materialFinalizeBody } = require('../services/materialFinalizeBody');
const { createMaterialsRouter } = require('../routes/materials');
const { updateMaterialLanguage } = require('../services/materialPersistenceService');
const { generateMaterialQuestionSet } = require('../services/materialQuestionSetService');
const { multiPageDocx } = require('./fixtures/multiPageDocuments');
const { createDatabase, dependencies, requester, material, generatedQuestions,
  TEACHER_A, TEACHER_B, ADMIN, MATERIAL_A } = require('./fixtures/materialDatabase');

const ENGLISH = 'The children walked to the river with their teacher. They saw the fish and the birds, and they wrote what they learned in their notebooks.';
const FILIPINO = 'Ang Ating Kalikasan. Ang mga puno ay nagbibigay sa atin ng malinis na hangin. Dapat nating alagaan ang kalikasan dahil ito ang ating tahanan at hindi natin ito dapat sirain.';
const MIXED = 'Ang mga bata ay pumunta sa park. They played with the ball and ang kanilang guro ay masaya. The day was very hot so sila ay umuwi.';

test.after(() => terminateOcrWorker());

test('detects clear English and Filipino passages from their text', () => {
  assert.deepEqual(
    { language: detectMaterialLanguage(ENGLISH).language, certain: detectMaterialLanguage(ENGLISH).certain },
    { language: 'en', certain: true });
  const filipino = detectMaterialLanguage(FILIPINO);
  assert.equal(filipino.language, 'fil');
  assert.equal(filipino.certain, true);
  assert.equal(filipino.reason, 'clear');
});

test('mixed, short and empty text is uncertain and never defaults to English', () => {
  const mixed = detectMaterialLanguage(MIXED);
  assert.equal(mixed.language, null); assert.equal(mixed.certain, false); assert.equal(mixed.reason, 'mixed');
  assert.ok(mixed.scores.en >= 3 && mixed.scores.fil >= 3);
  const short = detectMaterialLanguage('Ang Ating Kalikasan');
  assert.equal(short.language, null); assert.equal(short.reason, 'too_short'); assert.equal(short.suggestedLanguage, 'fil');
  const none = detectMaterialLanguage('12345 67890 ---');
  assert.deepEqual([none.language, none.reason, none.suggestedLanguage], [null, 'no_signal', null]);
  // One stray word from OCR noise gives no hint at all.
  const noise = detectMaterialLanguage('RANE ICR ee ae TF RR ST the Se');
  assert.deepEqual([noise.language, noise.suggestedLanguage, noise.scores.en], [null, null, 1]);
  // A Filipino title on English text is still English: the text decides, not the name.
  assert.equal(detectMaterialLanguage(`Ang Ating Kalikasan\n\n${ENGLISH}`).language, 'en');
});

test('upload fields accept a missing language but still reject an unsupported one', () => {
  assert.deepEqual(validateMaterialFields({ title: 'Lesson' }), { title: 'Lesson' });
  assert.deepEqual(validateMaterialFields({ title: 'Lesson', language: '' }), { title: 'Lesson' });
  assert.deepEqual(validateMaterialFields({ title: 'Lesson', language: 'fil' }), { title: 'Lesson', language: 'fil' });
  assert.throws(() => validateMaterialFields({ title: 'Lesson', language: 'es' }), { code: 'UNSUPPORTED_LANGUAGE' });
});

test('an explicit language is kept and only one extraction runs', async () => {
  const calls = [];
  const extract = async input => { calls.push(input.language); return { status: 'completed', extractedText: ENGLISH, ocrConfidence: 90 }; };
  const result = await extractTeacherMaterial({ filePath: 'x', fileType: 'PNG', language: 'fil' }, { extract });
  assert.deepEqual(calls, ['fil']);
  assert.equal(result.language, 'fil'); assert.equal(result.languageDetection, null);
});

test('documents are detected from one extraction; images use at most two OCR passes', async () => {
  // Each pass returns [text, ocrConfidence] (or just text at confidence 80).
  const run = async (fileType, passes) => {
    const calls = [];
    const extract = async input => {
      calls.push(input.language);
      const pass = passes[calls.length - 1];
      assert.ok(pass !== undefined, 'no more than the planned OCR passes');
      const [extractedText, ocrConfidence] = Array.isArray(pass) ? pass : [pass, 80];
      return { status: 'completed', extractedText, ocrConfidence };
    };
    return { calls, result: await extractTeacherMaterial({ filePath: 'x', fileType }, { extract }) };
  };
  let r = await run('PDF', [FILIPINO]);
  assert.deepEqual(r.calls, [undefined]); assert.equal(r.result.language, 'fil');
  r = await run('DOCX', [ENGLISH]);
  assert.deepEqual(r.calls, [undefined]); assert.equal(r.result.language, 'en');
  r = await run('PNG', [ENGLISH]);
  assert.deepEqual(r.calls, ['en'], 'English images need one pass');
  assert.equal(r.result.language, 'en');
  r = await run('JPG', [FILIPINO, `${FILIPINO} (tagalog model)`]);
  assert.deepEqual(r.calls, ['en', 'fil'], 'Filipino images are read again with the Tagalog model');
  assert.equal(r.result.language, 'fil'); assert.match(r.result.extractedText, /tagalog model/);
  // A noisy Filipino image the English model barely reads: the Tagalog pass confirms it.
  r = await run('PNG', [['Tuwing Umaga naglalakad si Lito . = a : i 5', 36], ['Tuwing umaga, naglalakad si Lito kasama ang kanyang aso na si Bantay', 68]]);
  assert.deepEqual(r.calls, ['en', 'fil'], 'a lean towards Filipino earns the one Tagalog pass');
  assert.equal(r.result.language, 'fil'); assert.match(r.result.extractedText, /Bantay/);
  // Leaning Filipino but still unclear: the clearer reading is kept, the teacher decides.
  r = await run('PNG', [[MIXED, 40], [`${MIXED} (tagalog model)`, 70]]);
  assert.deepEqual(r.calls, ['en', 'fil']);
  assert.equal(r.result.language, null); assert.match(r.result.extractedText, /tagalog model/);
  r = await run('PNG', [[MIXED, 70], [`${MIXED} (tagalog model)`, 40]]);
  assert.equal(r.result.language, null); assert.doesNotMatch(r.result.extractedText, /tagalog model/);
  // A Tagalog reading that looks clearly English never turns an uncertain image into English.
  r = await run('PNG', [['Ang mga bata ay umuwi the', 30], [ENGLISH, 90]]);
  assert.equal(r.result.language, null); assert.equal(r.result.languageDetection.certain, false);
  // Garbled or English-leaning images are not re-read.
  r = await run('PNG', [['RANE ICR ee ae TF the Se', 19]]);
  assert.deepEqual(r.calls, ['en']); assert.equal(r.result.language, null);
  r = await run('PNG', [FILIPINO, MIXED]);
  assert.equal(r.result.language, null, 'a second reading that no longer looks Filipino is left to the teacher');
  assert.equal(r.result.languageDetection.suggestedLanguage, 'fil');
});

function textImage(lines) {
  const canvas = createCanvas(1400, 120 + lines.length * 90);
  const context = canvas.getContext('2d');
  context.fillStyle = 'white'; context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = 'black'; context.font = 'bold 56px Arial';
  lines.forEach((line, i) => context.fillText(line, 50, 100 + i * 90));
  return canvas.toBuffer('image/png');
}

test('a real Filipino image is detected with installed models only', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'readflow-lang-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'kalikasan.png');
  await fs.writeFile(filePath, textImage([
    'Ang mga puno ay nagbibigay sa atin',
    'ng malinis na hangin at ito ay',
    'mahalaga sa ating buhay.',
  ]));
  const result = await extractTeacherMaterial({ filePath, fileType: 'PNG' });
  assert.equal(result.language, 'fil');
  assert.match(result.extractedText, /puno/i);
});

function routeApp(t, db) {
  const originalFrom = db.from.bind(db);
  db.from = table => {
    const query = originalFrom(table), originalInsert = query.insert.bind(query);
    query.insert = value => originalInsert(table === 'uploaded_materials' ? { id: randomUUID(), created_at: new Date().toISOString(), ...value } : value);
    const execute = query.execute.bind(query);
    query.execute = async () => {
      const result = await execute();
      if (query.action === 'insert' && query.singleMode && Array.isArray(result.data)) result.data = result.data[0];
      return result;
    };
    return query;
  };
  const storage = new Map();
  db.storage.from = () => ({ info: async key => ({ data: storage.get(key), error: null }), remove: async () => ({ error: null }) });
  const app = express(); app.post('/api/materials/finalize', materialFinalizeBody); app.use(express.json());
  app.use('/api/materials', createMaterialsRouter({ getSupabaseAdmin: () => db, authorizeMaterialRequest: async () => requester(TEACHER_A, 'teacher') }));
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise(r => server.close(r)));
  return { server, storage, ready: new Promise(r => server.once('listening', r)) };
}

test('upload detects the language; save needs a confirmed language and keeps the teacher choice', async t => {
  const db = createDatabase({ profiles: [{ id: TEACHER_A, role: 'teacher', full_name: 'Teacher' }] });
  const { server, storage, ready } = routeApp(t, db); await ready;
  const base = `http://127.0.0.1:${server.address().port}/api/materials`;
  const json = { method: 'POST', headers: { 'Content-Type': 'application/json' } };
  async function upload(text) {
    const bytes = await multiPageDocx([text]);
    const form = new FormData();
    form.append('file', new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), 'english-name.docx');
    form.append('title', 'Ang Ating Kalikasan');
    const response = await fetch(`${base}/upload`, { method: 'POST', body: form });
    assert.equal(response.status, 201);
    const { material: uploaded } = await response.json();
    const storagePath = `${TEACHER_A}/${randomUUID()}.docx`;
    storage.set(storagePath, { size: bytes.length, contentType: uploaded.mimeType });
    return { uploaded, body: { temporaryMaterialId: uploaded.id, storagePath, contentText: uploaded.extractedText } };
  }

  const filipino = await upload(FILIPINO);
  assert.equal(filipino.uploaded.language, 'fil');
  assert.equal(filipino.uploaded.languageDetection.certain, true);
  assert.equal((await fetch(`${base}/finalize`, { ...json, body: JSON.stringify(filipino.body) })).status, 201);
  assert.equal(db.tables.uploaded_materials.at(-1).language, 'fil', 'older clients that omit the language keep the detected one');

  const mixed = await upload(MIXED);
  assert.equal(mixed.uploaded.language, null);
  const missing = await fetch(`${base}/finalize`, { ...json, body: JSON.stringify(mixed.body) });
  assert.equal(missing.status, 400); assert.match((await missing.json()).message, /Select English or Filipino/);
  assert.equal(db.tables.uploaded_materials.length, 1, 'nothing is saved without a confirmed language');
  const invalid = await fetch(`${base}/finalize`, { ...json, body: JSON.stringify({ ...mixed.body, language: 'es' }) });
  assert.equal(invalid.status, 400);
  assert.equal((await fetch(`${base}/finalize`, { ...json, body: JSON.stringify({ ...mixed.body, language: 'fil' }) })).status, 201);
  assert.equal(db.tables.uploaded_materials.at(-1).language, 'fil');

  const english = await upload(ENGLISH);
  assert.equal(english.uploaded.language, 'en');
  assert.equal((await fetch(`${base}/finalize`, { ...json, body: JSON.stringify({ ...english.body, language: 'fil' }) })).status, 201);
  assert.equal(db.tables.uploaded_materials.at(-1).language, 'fil', 'the teacher correction wins over detection');
});

function languageFixture(extra = {}) {
  const db = createDatabase({
    uploaded_materials: [{ ...material(MATERIAL_A, TEACHER_A), language: 'en' }],
    oral_reading_attempts: [],
    ...extra,
  });
  // Like Supabase, update(...).maybeSingle() returns one row or null (the shared fixture returns an array).
  const from = db.from.bind(db);
  db.from = table => {
    const query = from(table), execute = query.execute.bind(query);
    query.execute = async () => {
      const result = await execute();
      if (query.action === 'update' && query.singleMode === 'maybe' && Array.isArray(result.data)) result.data = result.data[0] ?? null;
      return result;
    };
    return query;
  };
  return db;
}

test('the uploader can correct the language of an unused saved material', async () => {
  const db = languageFixture({ material_question_sets: [{ id: 'set', material_id: MATERIAL_A }] });
  const result = await updateMaterialLanguage(requester(TEACHER_A, 'teacher'), MATERIAL_A, 'fil', dependencies(db));
  assert.deepEqual(result, { id: MATERIAL_A, language: 'fil', changed: true });
  assert.equal(db.tables.uploaded_materials[0].language, 'fil');
  assert.equal(db.tables.material_question_sets.length, 1, 'question sets are kept');
  assert.equal((await updateMaterialLanguage(requester(TEACHER_A, 'teacher'), MATERIAL_A, 'fil', dependencies(db))).changed, false);
});

test('assigned or answered materials, other users and invalid languages cannot change', async () => {
  for (const [table, row] of [
    ['reading_activity_assignments', { id: 'a', material_id: MATERIAL_A }],
    ['oral_reading_attempts', { id: 'o', material_id: MATERIAL_A }],
    ['m6_comprehension_attempts', { id: 'm', material_id: MATERIAL_A }],
  ]) {
    const db = languageFixture({ [table]: [row] });
    await assert.rejects(updateMaterialLanguage(requester(TEACHER_A, 'teacher'), MATERIAL_A, 'fil', dependencies(db)),
      { statusCode: 409, code: 'MATERIAL_LANGUAGE_IN_USE' }, table);
    assert.equal(db.tables.uploaded_materials[0].language, 'en', `${table} keeps the saved language`);
  }
  const db = languageFixture();
  await assert.rejects(updateMaterialLanguage(requester(TEACHER_B, 'teacher'), MATERIAL_A, 'fil', dependencies(db)), { statusCode: 403 });
  await assert.rejects(updateMaterialLanguage(requester(ADMIN, 'admin'), MATERIAL_A, 'fil', dependencies(db)), { statusCode: 403 });
  await assert.rejects(updateMaterialLanguage(requester(TEACHER_A, 'teacher'), MATERIAL_A, 'es', dependencies(db)), { statusCode: 400 });
  assert.equal(db.tables.uploaded_materials[0].language, 'en');
});

test('a room-subject trigger conflict is reported as in use, not as a server failure', async () => {
  const db = languageFixture();
  const from = db.from.bind(db);
  db.from = table => {
    const query = from(table);
    if (table === 'uploaded_materials') {
      const update = query.update.bind(query);
      query.update = payload => { update(payload); query.execute = async () => ({ data: null, error: { code: '23514' } }); return query; };
    }
    return query;
  };
  await assert.rejects(updateMaterialLanguage(requester(TEACHER_A, 'teacher'), MATERIAL_A, 'fil', dependencies(db)),
    { statusCode: 409, code: 'MATERIAL_LANGUAGE_IN_USE' });
});

test('an assignment created during the change (legacy room race) undoes the change', async () => {
  const db = languageFixture();
  const from = db.from.bind(db);
  db.from = table => {
    const query = from(table);
    if (table === 'uploaded_materials') {
      const update = query.update.bind(query);
      // A teacher assigns the material in a legacy room at the same moment as the update.
      query.update = payload => {
        if (payload.language === 'fil') db.tables.reading_activity_assignments.push({ id: 'race', material_id: MATERIAL_A, room_id: 'legacy' });
        return update(payload);
      };
    }
    return query;
  };
  await assert.rejects(updateMaterialLanguage(requester(TEACHER_A, 'teacher'), MATERIAL_A, 'fil', dependencies(db)),
    { statusCode: 409, code: 'MATERIAL_LANGUAGE_IN_USE' });
  assert.equal(db.tables.uploaded_materials[0].language, 'en', 'the original language is restored');
  assert.equal(db.tables.reading_activity_assignments.length, 1, 'the assignment is untouched');
});

test('PATCH /:materialId/language returns the corrected language', async t => {
  const db = languageFixture();
  const app = express(); app.use(express.json());
  app.use('/api/materials', createMaterialsRouter({ getSupabaseAdmin: () => db, authorizeMaterialRequest: async () => requester(TEACHER_A, 'teacher') }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  t.after(() => new Promise(r => server.close(r)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/materials/${MATERIAL_A}/language`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ language: 'fil' }) });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).material, { id: MATERIAL_A, language: 'fil', changed: true });
});

test('new question sets: at least 6, multiples of 3, at most 12 (shared rule); 9 is the default', async () => {
  const db = createDatabase({ uploaded_materials: [material(MATERIAL_A, TEACHER_A)] });
  db.rpc = async () => ({ data: 'new-set', error: null });
  const teacher = requester(TEACHER_A, 'teacher');
  for (const count of [3, 0, 7, 15, '9']) {
    await assert.rejects(generateMaterialQuestionSet(teacher, MATERIAL_A, null, null, () => assert.fail('no generation'), dependencies(db), count),
      { statusCode: 400, code: 'INVALID_QUESTION_COUNT' }, String(count));
  }
  const requested = [];
  const generate = async input => { requested.push(input.questionCount); return generatedQuestions(); };
  for (const count of [undefined, 6, 9, 12]) {
    db.tables.material_question_sets = [];
    await generateMaterialQuestionSet(teacher, MATERIAL_A, null, null, generate, dependencies(db), count).catch(() => undefined);
  }
  assert.deepEqual(requested, [9, 6, 9, 12]);
});

test('the question-set route rejects a count that is not a multiple of 3', async t => {
  const db = createDatabase({ profiles: [{ id: TEACHER_A, role: 'teacher' }], uploaded_materials: [material(MATERIAL_A, TEACHER_A)] });
  const app = express(); app.use(express.json());
  app.use('/api/materials', createMaterialsRouter({ getSupabaseAdmin: () => db, authorizeMaterialRequest: async () => requester(TEACHER_A, 'teacher'),
    generateComprehensionQuestions: () => assert.fail('no generation') }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  t.after(() => new Promise(r => server.close(r)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/materials/${MATERIAL_A}/question-sets`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ questionCount: 7 }) });
  assert.equal(response.status, 400);
  assert.match((await response.json()).message, /multiple of 3/);
});
