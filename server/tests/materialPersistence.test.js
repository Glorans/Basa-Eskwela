const assert = require("node:assert/strict");
const test = require("node:test");
const {
  MaterialAuthorizationError,
  MaterialPersistenceError,
  authorizeMaterialRequest,
  canAccessMaterial,
  deletePersistedMaterial,
  getPersistedMaterial,
  listPersistedMaterials,
  requireUploadRole,
} = require("../services/materialPersistenceService");

const { createDatabase, dependencies, requester, material,
  TEACHER_A, TEACHER_B, GENERAL, ADMIN, MATERIAL_A, MATERIAL_B } = require("./fixtures/materialDatabase");

test("upload authorization allows Teacher and Independent Learner but denies Admin and Student", () => {
  assert.doesNotThrow(() => requireUploadRole({ role: "teacher" }));
  assert.doesNotThrow(() => requireUploadRole({ role: "general_user" }));
  assert.throws(() => requireUploadRole({ role: "admin" }), MaterialAuthorizationError);
  assert.throws(() => requireUploadRole({ role: "student" }), MaterialAuthorizationError);
});

test("authorization derives the role from public.profiles after validating the auth user", async () => {
  const database = createDatabase({
    profiles: [{ id: TEACHER_A, full_name: "Teacher A", role: "teacher", teacher_status: "approved" }],
  });
  const authorized = await authorizeMaterialRequest({}, {
    getAuthenticatedSupabaseUser: async () => ({ id: TEACHER_A, user_metadata: { role: "admin" } }),
    getSupabaseAdmin: () => database,
  });
  assert.equal(authorized.profile.role, "teacher");

  database.tables.profiles[0].role = "student";
  await assert.rejects(
    authorizeMaterialRequest({}, {
      getAuthenticatedSupabaseUser: async () => ({ id: TEACHER_A }),
      getSupabaseAdmin: () => database,
    }),
    MaterialAuthorizationError,
  );
});

test("material ownership permits Admin or the owning uploader only", () => {
  const row = material(MATERIAL_A, TEACHER_A);
  assert.equal(canAccessMaterial(requester(ADMIN, "admin"), row), true);
  assert.equal(canAccessMaterial(requester(TEACHER_A, "teacher"), row), true);
  assert.equal(canAccessMaterial(requester(TEACHER_B, "teacher"), row), false);
  assert.equal(canAccessMaterial(requester(GENERAL, "general_user"), row), false);
});

test("real material lists are server-filtered and include safe uploader labels", async () => {
  const database = createDatabase({
    profiles: [
      { id: TEACHER_A, full_name: "Teacher A", role: "teacher" },
      { id: GENERAL, full_name: "Reader", role: "general_user" },
    ],
    uploaded_materials: [material(MATERIAL_A, TEACHER_A), material(MATERIAL_B, GENERAL)],
    material_question_sets: [{ id: "set-1", material_id: MATERIAL_A }, { id: "set-2", material_id: MATERIAL_A }],
  });

  const adminRows = await listPersistedMaterials(requester(ADMIN, "admin"), dependencies(database));
  const teacherRows = await listPersistedMaterials(requester(TEACHER_A, "teacher"), dependencies(database));
  const generalRows = await listPersistedMaterials(requester(GENERAL, "general_user"), dependencies(database));

  assert.deepEqual(adminRows.map((row) => row.id).sort(), [MATERIAL_A, MATERIAL_B].sort());
  assert.deepEqual(teacherRows.map((row) => row.id), [MATERIAL_A]);
  assert.deepEqual(generalRows.map((row) => row.id), [MATERIAL_B]);
  assert.equal(teacherRows[0].questionSetCount, 2);
  assert.equal(generalRows[0].questionSetCount, 0);
  assert.equal(generalRows[0].uploaderRole, "Independent Learner");
  assert.equal(Object.hasOwn(generalRows[0], "storagePath"), false);
});

test("material detail enforces Teacher and General User ownership while Admin may view any", async () => {
  const database = createDatabase({
    profiles: [{ id: TEACHER_A, full_name: "Teacher A", role: "teacher" }],
    uploaded_materials: [material(MATERIAL_A, TEACHER_A)],
  });
  const deps = dependencies(database);
  assert.equal((await getPersistedMaterial(requester(ADMIN, "admin"), MATERIAL_A, deps)).id, MATERIAL_A);
  assert.equal((await getPersistedMaterial(requester(TEACHER_A, "teacher"), MATERIAL_A, deps)).id, MATERIAL_A);
  await assert.rejects(
    getPersistedMaterial(requester(TEACHER_B, "teacher"), MATERIAL_A, deps),
    MaterialAuthorizationError,
  );
  await assert.rejects(
    getPersistedMaterial(requester(GENERAL, "general_user"), MATERIAL_A, deps),
    MaterialAuthorizationError,
  );
});

test("referenced material deletion returns 409 without removing Storage or metadata", async () => {
  const database = createDatabase({
    uploaded_materials: [material(MATERIAL_A, TEACHER_A)],
    modules: [{ id: "module-1", source_material_id: MATERIAL_A }],
  });
  await assert.rejects(
    deletePersistedMaterial(requester(ADMIN, "admin"), MATERIAL_A, dependencies(database)),
    (error) => error instanceof MaterialPersistenceError && error.statusCode === 409,
  );
  assert.equal(database.removedStoragePaths.length, 0);
  assert.equal(database.tables.uploaded_materials.length, 1);
});

test("Teacher and Independent Learner cannot delete another user's material", async () => {
  for (const actor of [requester(TEACHER_B, "teacher"), requester(GENERAL, "general_user")]) {
    const database = createDatabase({ uploaded_materials: [material(MATERIAL_A, TEACHER_A)] });
    await assert.rejects(
      deletePersistedMaterial(actor, MATERIAL_A, dependencies(database)),
      MaterialAuthorizationError,
    );
    assert.equal(database.tables.uploaded_materials.length, 1);
    assert.equal(database.removedStoragePaths.length, 0);
  }
});

test("eligible deletion removes Storage, material questions, answer keys, and metadata", async () => {
  const question = {
    id: "88888888-8888-4888-8888-888888888888",
    material_id: MATERIAL_A,
  };
  const database = createDatabase({
    uploaded_materials: [material(MATERIAL_A, TEACHER_A)],
    comprehension_questions: [question],
    comprehension_question_answers: [{ question_id: question.id, correct_answer: "A" }],
  });
  await deletePersistedMaterial(requester(TEACHER_A, "teacher"), MATERIAL_A, dependencies(database));
  assert.equal(database.removedStoragePaths.length, 1);
  assert.equal(database.tables.uploaded_materials.length, 0);
  assert.equal(database.tables.comprehension_questions.length, 0);
  assert.equal(database.tables.comprehension_question_answers.length, 0);
});

test("Storage deletion failure preserves database metadata and reports failure", async () => {
  const database = createDatabase({ uploaded_materials: [material(MATERIAL_A, TEACHER_A)] });
  database.storageError = { message: "storage unavailable" };
  await assert.rejects(
    deletePersistedMaterial(requester(ADMIN, "admin"), MATERIAL_A, dependencies(database)),
    (error) => error instanceof MaterialPersistenceError && error.statusCode === 502,
  );
  assert.equal(database.tables.uploaded_materials.length, 1);
});
