const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { randomUUID } = require('node:crypto');
const {
  TEMPORARY_MATERIAL_TTL_MS,
  getTemporaryMaterial,
  registerTemporaryMaterial,
  sweepTemporaryUploads,
} = require('../services/temporaryMaterialRegistry');
const { createMaterialsRouter } = require('../routes/materials');
const { multiPageDocx } = require('./fixtures/multiPageDocuments');
const { requester, TEACHER_A } = require('./fixtures/materialDatabase');

const HOUR = 60 * 60 * 1000;
const exists = file => fs.access(file).then(() => true, () => false);

async function writeAged(directory, name, ageMs) {
  const file = path.join(directory, name);
  await fs.writeFile(file, 'temporary');
  const time = new Date(Date.now() - ageMs);
  await fs.utimes(file, time, time);
  return file;
}

test('the sweep removes only abandoned temporary uploads', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'readflow-sweep-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const now = Date.now();
  const expiredId = randomUUID(), freshId = randomUUID();
  const expiredFile = await writeAged(directory, `${randomUUID()}.png`, 13 * HOUR);
  const freshRegisteredFile = await writeAged(directory, `${randomUUID()}.pdf`, 13 * HOUR);
  registerTemporaryMaterial({ id: expiredId }, expiredFile, now - 13 * HOUR);
  registerTemporaryMaterial({ id: freshId }, freshRegisteredFile, now - 1 * HOUR);
  const orphanOld = await writeAged(directory, `${randomUUID()}.docx`, 13 * HOUR);
  const orphanYoung = await writeAged(directory, `${randomUUID()}.jpg`, 1 * HOUR);
  const unrelated = await writeAged(directory, 'notes.pdf', 48 * HOUR);
  await fs.mkdir(path.join(directory, `${randomUUID()}.png`));

  const removed = await sweepTemporaryUploads({ directory, now });

  assert.equal(removed, 2);
  assert.equal(getTemporaryMaterial(expiredId), undefined, 'expired registration is forgotten');
  assert.equal(await exists(expiredFile), false);
  assert.ok(getTemporaryMaterial(freshId), 'a registration younger than the TTL is kept, even with an old file time');
  assert.equal(await exists(freshRegisteredFile), true);
  assert.equal(await exists(orphanOld), false, 'files left by a restart or closed tab are removed');
  assert.equal(await exists(orphanYoung), true, 'young files may still be uploading or extracting');
  assert.equal(await exists(unrelated), true, 'names the upload middleware never creates are never touched');
  assert.equal(TEMPORARY_MATERIAL_TTL_MS, 12 * HOUR);
});

test('an upload abandoned during extraction is discarded, not kept on the server', async t => {
  let release, seenPath;
  const started = new Promise(resolve => {
    release = resolve;
  });
  let finishExtraction;
  const extraction = new Promise(resolve => { finishExtraction = resolve; });
  let routeDone;
  const done = new Promise(resolve => { routeDone = resolve; });
  const extractTeacherMaterial = async input => {
    seenPath = input.filePath;
    release();
    await extraction;
    setImmediate(routeDone);
    return { status: 'completed', extractedText: 'Ang mga bata ay masaya.', ocrConfidence: null, language: null, languageDetection: null };
  };
  const app = express();
  app.use('/api/materials', createMaterialsRouter({
    authorizeMaterialRequest: async () => requester(TEACHER_A, 'teacher'),
    extractTeacherMaterial,
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  t.after(() => new Promise(r => server.close(r)));

  const form = new FormData();
  form.append('file', new Blob([await multiPageDocx(['Ang mga bata ay masaya.'])],
    { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), 'reading.docx');
  form.append('title', 'Abandoned');
  const controller = new AbortController();
  const request = fetch(`http://127.0.0.1:${server.address().port}/api/materials/upload`, { method: 'POST', body: form, signal: controller.signal })
    .catch(error => error);
  await started;
  assert.equal(await exists(seenPath), true, 'the upload is on disk while extracting');
  controller.abort();
  assert.equal((await request).name, 'AbortError');
  await new Promise(r => setTimeout(r, 100));
  finishExtraction();
  await done;
  await new Promise(r => setTimeout(r, 50));
  assert.equal(await exists(seenPath), false, 'the abandoned file is deleted as soon as extraction ends');
});
