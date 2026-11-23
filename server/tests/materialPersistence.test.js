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
  trashStaffMaterial,
  restoreStaffMaterial,
  listTrashedStaffMaterials,
} = require("../services/materialPersistenceService");

const { createDatabase, dependencies, requester, material,
  TEACHER_A, TEACHER_B, GENERAL, ADMIN, MATERIAL_A, MATERIAL_B } = require("./fixtures/materialDatabase");

test("upload authorization allows Teacher, School Admin and Independent Learner but denies Student", () => {
  assert.doesNotThrow(() => requireUploadRole({ role: "teacher" }));
  assert.doesNotThrow(() => requireUploadRole({ role: "general_user" }));
  assert.doesNotThrow(() => requireUploadRole({ role: "admin" }), "M3 all-role refinement: School Admin upload");
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

  // M1 scope: the School Admin never sees an Independent Learner's personal upload.
  assert.deepEqual(adminRows.map((row) => row.id), [MATERIAL_A]);
  assert.equal(JSON.stringify(adminRows).includes("Reader"), false, "no Independent Learner name");
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

test("School Admin gets 'not found' for an Independent Learner's material: no detail, no deletion", async () => {
  const database = createDatabase({
    profiles: [{ id: TEACHER_A, full_name: "Teacher A", role: "teacher" }, { id: GENERAL, full_name: "Reader", role: "general_user" }],
    uploaded_materials: [material(MATERIAL_A, TEACHER_A), material(MATERIAL_B, GENERAL)],
  });
  const deps = dependencies(database);
  for (const action of [() => getPersistedMaterial(requester(ADMIN, "admin"), MATERIAL_B, deps),
    () => deletePersistedMaterial(requester(ADMIN, "admin"), MATERIAL_B, deps)]) {
    await assert.rejects(action, (error) => error instanceof MaterialPersistenceError && error.statusCode === 404);
  }
  assert.equal(database.tables.uploaded_materials.length, 2, "nothing deleted");
  assert.equal(database.removedStoragePaths.length, 0);
  assert.equal((await getPersistedMaterial(requester(ADMIN, "admin"), MATERIAL_A, deps)).id, MATERIAL_A, "Teacher material still visible");
  assert.equal((await getPersistedMaterial(requester(GENERAL, "general_user"), MATERIAL_B, deps)).id, MATERIAL_B, "the owner still sees it");
});

// M3 all-role refinement: staff "Delete" is Move to Trash. The old path removed the storage file before the database
// rows, so a referenced material could keep a record without its file. Nothing is erased now.
test("staff deletion moves a material used by a module to Trash without touching Storage or rows", async () => {
  const database = createDatabase({
    uploaded_materials: [material(MATERIAL_A, TEACHER_A)],
    modules: [{ id: "module-1", source_material_id: MATERIAL_A }],
  });
  await deletePersistedMaterial(requester(ADMIN, "admin"), MATERIAL_A, dependencies(database));
  assert.equal(database.removedStoragePaths.length, 0);
  assert.equal(database.tables.uploaded_materials.length, 1);
  assert.ok(database.tables.uploaded_materials[0].trashed_at, "in Trash");
  assert.equal(database.tables.uploaded_materials[0].trashed_by, ADMIN);
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

test("Move to Trash keeps Storage, questions, answer keys and metadata; Restore brings it back unchanged", async () => {
  const question = {
    id: "88888888-8888-4888-8888-888888888888",
    material_id: MATERIAL_A,
  };
  const database = createDatabase({
    uploaded_materials: [material(MATERIAL_A, TEACHER_A)],
    comprehension_questions: [question],
    comprehension_question_answers: [{ question_id: question.id, correct_answer: "A" }],
  });
  const teacher = requester(TEACHER_A, "teacher");
  await deletePersistedMaterial(teacher, MATERIAL_A, dependencies(database));
  assert.equal(database.removedStoragePaths.length, 0);
  assert.equal(database.tables.uploaded_materials.length, 1);
  assert.equal(database.tables.comprehension_questions.length, 1);
  assert.equal(database.tables.comprehension_question_answers.length, 1);
  assert.equal((await listPersistedMaterials(teacher, dependencies(database))).length, 0, "gone from the active list");
  const trash = await listTrashedStaffMaterials(teacher, dependencies(database));
  assert.deepEqual(trash.materials.map((item) => item.id), [MATERIAL_A]);
  await assert.rejects(getPersistedMaterial(teacher, MATERIAL_A, dependencies(database)), { statusCode: 409, code: "MATERIAL_IN_TRASH" });
  await restoreStaffMaterial(teacher, MATERIAL_A, dependencies(database));
  assert.equal(database.tables.uploaded_materials[0].trashed_at, null);
  assert.equal((await listPersistedMaterials(teacher, dependencies(database))).length, 1, "back in the active list");
});

test("a material assigned to an active classroom activity cannot be moved to Trash", async () => {
  const database = createDatabase({
    uploaded_materials: [material(MATERIAL_A, TEACHER_A)],
    reading_activity_assignments: [{ id: "a1", material_id: MATERIAL_A, removed_at: null }],
  });
  await assert.rejects(trashStaffMaterial(requester(TEACHER_A, "teacher"), MATERIAL_A, dependencies(database)), { statusCode: 409, code: "MATERIAL_ASSIGNED" });
  assert.equal(database.tables.uploaded_materials[0].trashed_at, undefined);
  database.tables.reading_activity_assignments[0].removed_at = "2026-11-20T00:00:00Z";
  await trashStaffMaterial(requester(TEACHER_A, "teacher"), MATERIAL_A, dependencies(database));
  assert.ok(database.tables.uploaded_materials[0].trashed_at, "a removed assignment no longer blocks Trash");
});

test("staff Trash never calls Storage, even when Storage is unavailable", async () => {
  const database = createDatabase({ uploaded_materials: [material(MATERIAL_A, TEACHER_A)] });
  database.storageError = { message: "storage unavailable" };
  await deletePersistedMaterial(requester(ADMIN, "admin"), MATERIAL_A, dependencies(database));
  assert.equal(database.tables.uploaded_materials.length, 1);
  assert.equal(database.removedStoragePaths.length, 0);
});
