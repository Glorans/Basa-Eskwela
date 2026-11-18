const test = require('node:test');
const assert = require('node:assert/strict');
const { authorizeMaterialRequest, requireUploadRole, listPersistedMaterials, getPersistedMaterial,
  deletePersistedMaterial, MaterialAuthorizationError } = require('../services/materialPersistenceService');
const { listMaterialQuestionSets, getMaterialQuestionSet, saveMaterialQuestionSet, reviewMaterialQuestionSet,
  generateMaterialQuestionSet } = require('../services/materialQuestionSetService');
const { createDatabase, dependencies, requester, material, generatedQuestions,
  TEACHER_A, TEACHER_B, GENERAL, ADMIN, MATERIAL_A, MATERIAL_B } = require('./fixtures/materialDatabase');
const SYS = '55555555-5555-4555-8555-555555555555';
const SET = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const actor = requester(SYS, 'system_admin');
function fixture() {
  const qs = generatedQuestions();
  return createDatabase({
    profiles: [{ id: SYS, role: 'system_admin', full_name: 'System Admin' },
      { id: GENERAL, role: 'general_user', full_name: 'Private learner' }],
    uploaded_materials: [material(MATERIAL_A, SYS), material(MATERIAL_B, GENERAL)],
    material_question_sets: [{ id: SET, material_id: MATERIAL_A, name: 'Set 1', sequence_number: 1, revision: 1 }],
    comprehension_questions: qs.map((q,i) => ({ id: q.id, material_id: MATERIAL_A, question_set_id: SET,
      question_type: q.type, question_text: q.questionText, options: q.options, scaffolding_hint: q.scaffoldingHint,
      review_status: 'generated', display_order: i+1 })),
    comprehension_question_answers: qs.map(q => ({ question_id: q.id, correct_answer: q.correctAnswer })),
  });
}
test('System Admin F7/F8: verified profile may upload, list and view only own materials', async () => {
  const db = fixture(), deps = dependencies(db);
  const auth = await authorizeMaterialRequest({}, { ...deps, getAuthenticatedSupabaseUser: async () => ({ id: SYS }) });
  assert.doesNotThrow(() => requireUploadRole(auth.profile));
  const rows = await listPersistedMaterials(auth, deps);
  assert.deepEqual(rows.map(r => r.id), [MATERIAL_A]);
  assert.equal(rows[0].uploaderRole, 'System Admin');
  assert.equal((await getPersistedMaterial(auth, MATERIAL_A, deps)).id, MATERIAL_A);
  assert.doesNotMatch(JSON.stringify(rows), /Private learner/);
});
test('System Admin F9: existing question review and save preserve actor, set and revision', async () => {
  const db = fixture(), deps = dependencies(db), calls = [];
  db.rpc = async (name, args) => { calls.push({name, args}); return {data: SET, error: null}; };
  assert.equal((await listMaterialQuestionSets(actor, MATERIAL_A, deps)).length, 1);
  assert.equal((await getMaterialQuestionSet(actor, MATERIAL_A, SET, deps)).questions.length, 6);
  await saveMaterialQuestionSet(actor, MATERIAL_A, SET, 1, generatedQuestions(), deps);
  await reviewMaterialQuestionSet(actor, MATERIAL_A, SET, 1, deps);
  assert.deepEqual(calls.map(c => c.args.operation), ['save','approve']);
  for (const c of calls) { assert.equal(c.name,'m3_write_material_question_set'); assert.equal(c.args.actor_id,SYS);
    assert.equal(c.args.target_material,MATERIAL_A); assert.equal(c.args.target_set,SET); assert.equal(c.args.expected_revision,1); }
});
test('System Admin F8-F10: other uploads, private questions and deletion remain unauthorized', async () => {
  for (const owner of [GENERAL, TEACHER_A, TEACHER_B]) {
    const db=fixture(); db.tables.uploaded_materials[1].uploaded_by=owner; const deps=dependencies(db);
    for (const work of [() => getPersistedMaterial(actor,MATERIAL_B,deps),
      () => listMaterialQuestionSets(actor,MATERIAL_B,deps),
      () => saveMaterialQuestionSet(actor,MATERIAL_B,SET,1,generatedQuestions(),deps),
      () => reviewMaterialQuestionSet(actor,MATERIAL_B,SET,1,deps),
      () => generateMaterialQuestionSet(actor,MATERIAL_B,null,null,() => assert.fail('No generation'),deps),
      () => deletePersistedMaterial(actor,MATERIAL_B,deps)]) await assert.rejects(work(),MaterialAuthorizationError);
    assert.deepEqual(db.removedStoragePaths,[]);
  }
});
test('System Admin F10: existing material deletion refuses references and deletes only own unused upload', async () => {
  const db=fixture(), deps=dependencies(db);
  db.tables.modules.push({ id: 'module', source_material_id: MATERIAL_A });
  await assert.rejects(deletePersistedMaterial(actor,MATERIAL_A,deps));
  assert.deepEqual(db.removedStoragePaths,[]);
  db.tables.modules=[];
  await deletePersistedMaterial(actor,MATERIAL_A,deps);
  assert.deepEqual(db.tables.uploaded_materials.map(m=>m.id),[MATERIAL_B]);
  assert.deepEqual(db.removedStoragePaths,[`${SYS}/${MATERIAL_A}.pdf`]);
});
test('School Admin still cannot read Independent Learner material; Teacher ownership remains enforced', async () => {
  const db=fixture(), deps=dependencies(db);
  await assert.rejects(getPersistedMaterial(requester(ADMIN,'admin'),MATERIAL_B,deps),{statusCode:404});
  await assert.rejects(getPersistedMaterial(requester(TEACHER_A,'teacher'),MATERIAL_A,deps),MaterialAuthorizationError);
});
