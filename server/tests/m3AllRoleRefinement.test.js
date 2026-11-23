// M3 all-role refinement (2026-11-23): shared question-count rule, staff material Trash and School Admin scope.
const test = require("node:test");
const assert = require("node:assert/strict");
const { questionCountProblem, ALLOWED_QUESTION_COUNTS } = require("../services/questionCountRule");
const { validateNewQuestionSetCount, generateMaterialQuestionSet } = require("../services/materialQuestionSetService");
const { trashStaffMaterial, restoreStaffMaterial, deletePersistedMaterial, MaterialAuthorizationError } = require("../services/materialPersistenceService");
const { createDatabase, dependencies, requester, material, TEACHER_A, TEACHER_B, ADMIN, MATERIAL_A, MATERIAL_B } = require("./fixtures/materialDatabase");

test("question count rule: at least 6, multiples of 3, at most 12; never adjusted", () => {
  assert.deepEqual([...ALLOWED_QUESTION_COUNTS], [6, 9, 12]);
  for (const value of [6, 9, 12]) assert.equal(questionCountProblem(value), null, String(value));
  assert.equal(questionCountProblem(undefined), "Enter the number of questions.");
  assert.equal(questionCountProblem(""), "Enter the number of questions.");
  assert.match(questionCountProblem("9"), /whole number/, "a string is refused, never coerced");
  assert.match(questionCountProblem(9.5), /whole number/);
  assert.equal(questionCountProblem(3), "Enter at least 6 questions.");
  assert.match(questionCountProblem(8), /multiple of 3/);
  assert.match(questionCountProblem(15), /at most 12/);
  for (const value of [6, 9, 12]) assert.equal(validateNewQuestionSetCount(value), value);
  for (const value of [0, 3, 7, 15, "9"]) assert.throws(() => validateNewQuestionSetCount(value), { statusCode: 400, code: "INVALID_QUESTION_COUNT" });
});

test("staff Trash: only the owner (or their School Admin) can move a material; another Teacher cannot", async () => {
  const db = createDatabase({ uploaded_materials: [material(MATERIAL_A, TEACHER_A)] });
  await assert.rejects(trashStaffMaterial(requester(TEACHER_B, "teacher"), MATERIAL_A, dependencies(db)), MaterialAuthorizationError);
  await assert.rejects(restoreStaffMaterial(requester(TEACHER_B, "teacher"), MATERIAL_A, dependencies(db)), MaterialAuthorizationError);
  assert.equal(db.tables.uploaded_materials[0].trashed_at, undefined, "nothing changed");
});

test("before the database update, staff delete refuses clearly and never removes the file or the record", async () => {
  const db = createDatabase({ uploaded_materials: [material(MATERIAL_A, TEACHER_A)] });
  const original = db.from.bind(db);
  // Simulate a database without m3_all_role_refinement: selecting trashed_at fails with an undefined column.
  db.from = (table) => {
    const query = original(table);
    if (table !== "uploaded_materials") return query;
    const select = query.select.bind(query);
    query.select = (columns) => (String(columns).includes("trashed_at")
      ? { in: async () => ({ data: null, error: { code: "42703", message: "column trashed_at does not exist" } }) }
      : select(columns));
    return query;
  };
  await assert.rejects(deletePersistedMaterial(requester(TEACHER_A, "teacher"), MATERIAL_A, dependencies(db)),
    { statusCode: 503, code: "MATERIAL_TRASH_NOT_INSTALLED" });
  assert.equal(db.removedStoragePaths.length, 0);
  assert.equal(db.tables.uploaded_materials.length, 1);
});

test("School Admin generates question sets for their own uploads only, never on a Teacher's material", async () => {
  const db = createDatabase({ uploaded_materials: [material(MATERIAL_A, TEACHER_A), material(MATERIAL_B, ADMIN)],
    profiles: [{ id: ADMIN, role: "admin" }, { id: TEACHER_A, role: "teacher" }] });
  const admin = requester(ADMIN, "admin");
  await assert.rejects(generateMaterialQuestionSet(admin, MATERIAL_A, null, null, () => assert.fail("no generation"), dependencies(db), 9),
    MaterialAuthorizationError, "a Teacher's material stays with that Teacher");
  let asked = null;
  db.rpc = async () => ({ data: null, error: { code: "XX000", message: "stop after authorization" } });
  await generateMaterialQuestionSet(admin, MATERIAL_B, null, null, async (input) => { asked = input.questionCount; return []; }, dependencies(db), 6)
    .catch(() => undefined);
  assert.equal(asked, 6, "own upload: authorized and the requested count reaches generation unchanged");
});

test("School Admin never lists, opens or trashes a System Admin's platform upload (school scope)", async () => {
  const { listPersistedMaterials, getPersistedMaterial } = require("../services/materialPersistenceService");
  const SYS = "55555555-5555-4555-8555-555555555555";
  const db = createDatabase({ uploaded_materials: [material(MATERIAL_A, TEACHER_A), material(MATERIAL_B, SYS)],
    profiles: [{ id: SYS, role: "system_admin" }, { id: TEACHER_A, role: "teacher" }, { id: ADMIN, role: "admin" }] });
  const admin = requester(ADMIN, "admin");
  const listed = (await listPersistedMaterials(admin, dependencies(db))).map((item) => item.id);
  assert.ok(listed.includes(MATERIAL_A) && !listed.includes(MATERIAL_B), "the school's Teacher upload, never the platform upload");
  await assert.rejects(getPersistedMaterial(admin, MATERIAL_B, dependencies(db)), { statusCode: 404 });
  await assert.rejects(trashStaffMaterial(admin, MATERIAL_B, dependencies(db)), { statusCode: 404 });
  assert.equal(db.tables.uploaded_materials.find((row) => row.id === MATERIAL_B).trashed_at, undefined);
});
