// M2 F6 + F10 assessment packages: service + policy against the REAL proposed SQL in disposable in-memory
// PostgreSQL (PGlite). Never connects to Supabase. A PGlite repository implements the same interface as
// services/assessmentPackageRepository.js, so the guard triggers, constraints and the publish function run for real.
const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const express = require("express");
const { PGlite } = require("@electric-sql/pglite");
const { createAssessmentPackageService } = require("../services/assessmentPackageService");
const { createAssessmentPackagesRouter } = require("../routes/assessmentPackages");
const { DIAGNOSTIC_ASSESSMENTS } = require("../services/diagnosticAssessments");
const policy = require("../services/assessmentPackagePolicy");

const PROPOSAL = readFileSync(resolve(__dirname, "../../supabase/proposed/m2_assessment_packages_PROPOSED.sql"), "utf8");
const sql = (f) => readFileSync(resolve(__dirname, "../../supabase/proposed", f), "utf8");
const FOUNDATION = sql("m2_reassessment_foundation_PROPOSED.sql");
const F10 = sql("m2_f10_direct_publish_PROPOSED.sql");
const { LIVE_FIXTURE } = require("../../supabase/tests/fixtures/liveDiagnosticFixture.cjs");
const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const PEOPLE = {
  sa: { id: uid(1), role: "system_admin", full_name: "Sys Admin" },
  admin: { id: uid(2), role: "admin", full_name: "School Admin" },
  teacher: { id: uid(3), role: "teacher", teacher_status: "approved", full_name: "Teacher One" },
  otherTeacher: { id: uid(4), role: "teacher", teacher_status: "approved", full_name: "Teacher Two" },
  pendingTeacher: { id: uid(5), role: "teacher", teacher_status: "pending", full_name: "Pending Teacher" },
  student: { id: uid(6), role: "student", nickname: "Kid" },
  learner: { id: uid(7), role: "general_user", nickname: "Solo" },
};
const as = (key) => ({ user: { id: PEOPLE[key].id }, profile: { ...PEOPLE[key] } });

function pgliteRepository(d) {
  const all = async (sql, params) => (await d.query(sql, params)).rows;
  const first = async (sql, params) => (await all(sql, params))[0] ?? null;
  const insert = async (table, row) => {
    const keys = Object.keys(row);
    const values = keys.map((k) => (row[k] !== null && typeof row[k] === "object" ? JSON.stringify(row[k]) : row[k]));
    return first(`insert into ${table}(${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning *`, values);
  };
  const update = async (table, id, patch) => {
    const keys = Object.keys(patch);
    const values = keys.map((k) => (patch[k] !== null && typeof patch[k] === "object" ? JSON.stringify(patch[k]) : patch[k]));
    return first(`update ${table} set ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")} where id = $1 returning *`, [id, ...values]);
  };
  return {
    listPackages: ({ scopes, ownerId }) => (ownerId
      ? all("select * from m2_assessment_packages where scope = any($1) and owner_id = $2", [scopes, ownerId])
      : all("select * from m2_assessment_packages where scope = any($1)", [scopes])),
    getPackage: (id) => first("select * from m2_assessment_packages where id = $1", [id]),
    findPackageByLegacyId: (legacy) => first("select * from m2_assessment_packages where legacy_assessment_id = $1", [legacy]),
    insertPackage: (row) => insert("m2_assessment_packages", row),
    updatePackage: (id, patch) => update("m2_assessment_packages", id, patch),
    listVersions: (ids) => all("select * from m2_assessment_package_versions where package_id = any($1)", [ids]),
    getVersion: (id) => first("select * from m2_assessment_package_versions where id = $1", [id]),
    insertVersion: (row) => insert("m2_assessment_package_versions", row),
    updateVersion: (id, patch) => update("m2_assessment_package_versions", id, patch),
    deleteVersion: (id) => d.query("delete from m2_assessment_package_versions where id = $1", [id]),
    publishVersion: (id, actor) => d.query("select m2_publish_assessment_version($1, $2)", [id, actor]),
    contentIssues: async (t, p, q) => (await first("select m2_assessment_content_issues($1, $2, $3) issues",
      [t, JSON.stringify(p), JSON.stringify(q)])).issues,
    loadProfiles: (ids) => all("select id, role, full_name, nickname from profiles where id = any($1)", [ids]),
    listReviews: (ids) => all("select * from m2_assessment_educator_reviews where version_id = any($1)", [ids]),
    insertReview: (row) => insert("m2_assessment_educator_reviews", row),
  };
}

async function setup() {
  const d = new PGlite();
  await d.exec(`
    create role authenticated; create role anon; create role service_role bypassrls;
    create table profiles(id uuid primary key, role text, full_name text, nickname text);
    create table diagnostic_results(id uuid primary key, reading_level text);
    insert into diagnostic_results values ('${uid(900)}', 'Instructional');
    grant usage on schema public to authenticated, anon, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;`);
  for (const p of Object.values(PEOPLE)) {
    await d.query("insert into profiles values ($1, $2, $3, $4)", [p.id, p.role, p.full_name ?? null, p.nickname ?? null]);
  }
  await d.exec(PROPOSAL);
  return { d, service: createAssessmentPackageService({ repository: pgliteRepository(d) }) };
}

/** The live table shapes plus the packages, reassessment foundation and F10 direct-publish proposals (F10 tests). */
async function setupF10() {
  const d = new PGlite();
  await d.exec(LIVE_FIXTURE);
  for (const p of Object.values(PEOPLE)) {
    await d.query("insert into auth.users values ($1)", [p.id]);
    await d.query("insert into profiles(id, role, teacher_status, full_name, nickname) values ($1, $2, $3, $4, $5)",
      [p.id, p.role, p.teacher_status ?? null, p.full_name ?? null, p.nickname ?? null]);
  }
  await d.exec(PROPOSAL);
  await d.exec(FOUNDATION);
  await d.exec(F10);
  return { d, service: createAssessmentPackageService({ repository: pgliteRepository(d) }) };
}
const F10_REVIEW = { reviewerName: "Ms. Santos", reviewerQualification: "Teacher (stated)", reviewedOn: "2026-11-18", passageSuitable: true,
  questionsSound: true, answerKeysCorrect: true, languageAccurate: true, outcome: "endorsed", notes: "" };

const refused = (promise, status, pattern) => assert.rejects(promise, (error) => {
  assert.equal(error.statusCode, status, `${error.message}`);
  if (pattern) assert.match(error.message, pattern);
  return true;
});
const question = (n, type) => ({ type, prompt: `Question ${n}?`, correctChoiceId: "b",
  choices: ["a", "b", "c", "d"].map((id) => ({ id, label: `Choice ${id}` })) });
const COMPLETE = {
  passageTitle: "Ana at the River",
  paragraphs: ["Ana walked to the river with her small brown dog early in the morning.",
    "They watched the fish swim under the old bridge until the sun was high and warm."],
  questions: [question(1, "literal"), question(2, "literal"), question(3, "inferential"),
    question(4, "inferential"), question(5, "inferential"), question(6, "critical")],
};
/** What the System Admin's browser sends for the import: the code copy plus prompts and choice labels. */
const codeContent = (language) => {
  const code = DIAGNOSTIC_ASSESSMENTS[language];
  return {
    id: code.id, version: code.version, language: code.language, title: code.title,
    passage: { paragraphs: [...code.paragraphs] },
    questions: code.questions.map((q, i) => ({ id: q.id, prompt: `Prompt ${i + 1}`, correctChoiceId: q.correctChoiceId,
      choices: ["a", "b", "c", "d"].map((id) => ({ id, label: `Label ${id}` })) })),
  };
};

test("learners, pending Teachers and anonymous requesters are refused every operation", async () => {
  const { service } = await setup();
  for (const key of ["student", "learner", "pendingTeacher"]) {
    await refused(service.listPackages(as(key)), 403);
    await refused(service.createPackage(as(key), { category: "teacher", language: "en", title: "X" }), 403);
    await refused(service.getPackage(as(key), uid(999)), 403);
    await refused(service.importInitial(as(key), { language: "en", assessment: codeContent("en") }), 403);
  }
  await refused(service.listPackages(null), 403);
});

test("each role creates only its own category; nobody creates an initial package from scratch", async () => {
  const { service } = await setup();
  const create = (key, category) => service.createPackage(as(key), { category, language: "en", title: "Story" });
  await refused(create("teacher", "school"), 403);
  await refused(create("teacher", "independent"), 403);
  await refused(create("admin", "teacher"), 403);
  await refused(create("admin", "independent"), 403);
  await refused(create("sa", "school"), 403);
  await refused(create("sa", "teacher"), 403);
  for (const key of ["sa", "admin", "teacher"]) await refused(create(key, "initial"), 403);
  await refused(service.createPackage(as("teacher"), { category: "teacher", language: "es", title: "X" }), 400);
  await refused(service.createPackage(as("teacher"), { category: "teacher", language: "en", title: "  " }), 400);
  const t = await create("teacher", "teacher");
  assert.equal(t.package.category, "teacher");
  assert.deepEqual(t.versions.map((v) => [v.versionLabel, v.status]), [["1.0", "draft"]]);
  assert.equal((await create("admin", "school")).package.category, "school");
  assert.equal((await create("sa", "independent")).package.category, "independent");
});

test("Teacher packages are private: other Teachers, the System Admin and School Admins cannot see them (F10)", async () => {
  const { service } = await setup();
  const { package: pkg } = await service.createPackage(as("teacher"), { category: "teacher", language: "fil", title: "Kuwento" });
  assert.equal((await service.listPackages(as("teacher"))).packages.length, 1);
  assert.equal((await service.listPackages(as("otherTeacher"))).packages.length, 0);
  assert.equal((await service.listPackages(as("sa"))).packages.length, 0, "Independent Learner side never lists Teacher packages");
  await refused(service.getPackage(as("otherTeacher"), pkg.id), 404);
  await refused(service.getPackage(as("sa"), pkg.id), 404);
  // F10 final workflow: School Admins do not review Teachers' private packages, so they no longer see them here.
  assert.equal((await service.listPackages(as("admin"))).packages.length, 0);
  await refused(service.getPackage(as("admin"), pkg.id), 404);
  // School packages are not visible to Teachers or the System Admin.
  const school = await service.createPackage(as("admin"), { category: "school", language: "en", title: "School" });
  await refused(service.getPackage(as("teacher"), school.package.id), 404);
  await refused(service.getPackage(as("sa"), school.package.id), 404);
  // Nobody but the owning Teacher may edit or publish a Teacher's content.
  const draft = (await service.getPackage(as("teacher"), pkg.id)).versions[0];
  for (const key of ["admin", "otherTeacher", "sa"]) {
    await refused(service.updateDraft(as(key), pkg.id, draft.id, { content: COMPLETE }), 404);
    await refused(service.transition(as(key), pkg.id, draft.id, "publish"), 404);
  }
});

test("F10 Teacher lifecycle: draft -> publish directly (no review, approval or endorsement) -> new version retires the old one", async () => {
  const { d, service } = await setupF10();
  const created = await service.createPackage(as("teacher"), { category: "teacher", language: "en", title: "River" });
  const pkgId = created.package.id;
  const v1 = created.versions[0].id;
  await refused(service.transition(as("teacher"), pkgId, v1, "publish"), 422, /not ready to publish/);
  const edited = await service.updateDraft(as("teacher"), pkgId, v1, { content: COMPLETE });
  assert.deepEqual(edited.versions[0].issues, []);
  assert.deepEqual(edited.versions[0].content.questions.map((q) => q.id), ["q1", "q2", "q3", "q4", "q5", "q6"]);
  for (const action of ["submit", "approve", "return"]) {
    await refused(service.transition(as("teacher"), pkgId, v1, action, { attestation: "x", note: "x" }), 409, /no review or approval step/);
  }
  await refused(service.recordEducatorReview(as("teacher"), pkgId, v1, F10_REVIEW), 409, /no longer part of the reassessment workflow/);
  const published = await service.transition(as("teacher"), pkgId, v1, "publish");
  const p1 = published.versions[0];
  assert.equal(published.package.publishedVersion, "1.0");
  assert.deepEqual([p1.status, p1.submittedAt, p1.reviewedAt, p1.educatorEndorsed, p1.educatorReviews.length], ["published", null, null, false, 0],
    "no submission, approval or endorsement is invented");
  const hash = p1.contentSha256;
  assert.match(hash, /^[0-9a-f]{64}$/, "published content is frozen");
  assert.equal((await d.query("select count(*)::int n from m2_reassessment_assignments")).rows[0].n, 0, "publishing never assigns");
  await refused(service.updateDraft(as("teacher"), pkgId, v1, { content: COMPLETE }), 409, /Only drafts/);

  // Changing published content needs a new version; the published one never changes.
  const v2 = (await service.createVersion(as("teacher"), pkgId)).versions[0];
  assert.deepEqual([v2.versionLabel, v2.status, v2.basedOnVersionId], ["2.0", "draft", v1]);
  await refused(service.createVersion(as("teacher"), pkgId), 409, /in progress/);
  await service.updateDraft(as("teacher"), pkgId, v2.id, { content: { ...COMPLETE, paragraphs: [...COMPLETE.paragraphs, "Then they went home for lunch together."] } });
  const after = await service.transition(as("teacher"), pkgId, v2.id, "publish");
  assert.deepEqual(after.versions.map((v) => [v.versionLabel, v.status]), [["2.0", "published"], ["1.0", "retired"]]);
  assert.equal(after.versions[1].contentSha256, hash, "the retired version keeps its exact content");
  await assert.rejects(d.query("update m2_assessment_package_versions set paragraphs = '[]' where id = $1", [v1]), /Only draft content/);
  await assert.rejects(d.query("delete from m2_assessment_package_versions where id = $1", [v1]), /Only draft versions/);
  await refused(service.deleteDraft(as("teacher"), pkgId, v1), 409);

  // A version left "Submitted for review" by the old workflow: its manager moves it back to draft, or publishes it.
  const v3 = (await service.createVersion(as("teacher"), pkgId)).versions[0];
  await d.query("update m2_assessment_package_versions set status = 'in_review', submitted_by = $2 where id = $1", [v3.id, PEOPLE.teacher.id]);
  await refused(service.transition(as("otherTeacher"), pkgId, v3.id, "reopen"), 404);
  assert.equal((await service.transition(as("teacher"), pkgId, v3.id, "reopen")).versions[0].status, "draft");
  await refused(service.transition(as("teacher"), pkgId, v3.id, "reopen"), 409, /Only a submitted version/);
  await d.query("update m2_assessment_package_versions set status = 'in_review', submitted_by = $2 where id = $1", [v3.id, PEOPLE.teacher.id]);
  const last = await service.transition(as("teacher"), pkgId, v3.id, "publish");
  assert.deepEqual(last.versions.map((v) => v.status), ["published", "retired", "retired"]);
});

test("F10 School Admin and System Admin publish their own packages directly; the initial diagnostic still needs approval (F6)", async () => {
  const { service } = await setupF10();
  const made = {};
  for (const [key, category] of [["admin", "school"], ["sa", "independent"]]) {
    const created = await service.createPackage(as(key), { category, language: "fil", title: `${category} check` });
    const [pid, vid] = [created.package.id, created.versions[0].id];
    assert.deepEqual(created.package.permissions, { view: true, manage: true, review: false, publish: true }, `${key}: no review stage`);
    await refused(service.transition(as(key), pid, vid, "publish"), 422, /not ready to publish/);
    await service.updateDraft(as(key), pid, vid, { content: COMPLETE });
    const published = await service.transition(as(key), pid, vid, "publish");
    assert.deepEqual([published.versions[0].status, published.package.publishedVersion], ["published", "1.0"]);
    made[key] = { pid, vid };
  }
  await refused(service.getPackage(as("admin"), made.sa.pid), 404, /not found/);
  await refused(service.transition(as("admin"), made.sa.pid, made.sa.vid, "retire"), 404);
  await refused(service.getPackage(as("sa"), made.admin.pid), 404);
  await refused(service.getPackage(as("teacher"), made.admin.pid), 404);
  const imported = await service.importInitial(as("sa"), { language: "en", assessment: codeContent("en") });
  const next = (await service.createVersion(as("sa"), imported.package.id)).versions[0];
  await refused(service.transition(as("sa"), imported.package.id, next.id, "publish"), 409, /approved/);
  assert.equal(imported.package.permissions.review, true, "F6 keeps its review stage");
});

test("before m2_f10_direct_publish is applied, direct publishing is refused with a clear message (no bypass)", async () => {
  const { service } = await setup();
  const created = await service.createPackage(as("teacher"), { category: "teacher", language: "en", title: "Pending" });
  const [pid, vid] = [created.package.id, created.versions[0].id];
  await service.updateDraft(as("teacher"), pid, vid, { content: COMPLETE });
  await refused(service.transition(as("teacher"), pid, vid, "publish"), 409, /database update that has not been applied yet/);
  assert.equal((await service.getPackage(as("teacher"), pid)).versions[0].status, "draft");
});

test("F6: the System Admin imports the code 3.0 diagnostic, verified against the server copy; learner delivery stays on code", async () => {
  const { d, service } = await setup();
  const before = (await d.query("select count(*)::int n from diagnostic_results")).rows[0].n;
  assert.deepEqual((await service.listPackages(as("sa"))).capabilities.importInitial, ["en", "fil"]);
  const tampered = codeContent("en");
  tampered.questions[0].correctChoiceId = "b";
  await refused(service.importInitial(as("sa"), { language: "en", assessment: tampered }), 409, /does not match/);
  const reworded = codeContent("en");
  reworded.passage.paragraphs[0] += " Extra.";
  await refused(service.importInitial(as("sa"), { language: "en", assessment: reworded }), 409);
  await refused(service.importInitial(as("sa"), { language: "fil", assessment: codeContent("en") }), 409, /does not match/); // languages stay separate
  await refused(service.importInitial(as("admin"), { language: "en", assessment: codeContent("en") }), 403);

  const imported = await service.importInitial(as("sa"), { language: "en", assessment: codeContent("en") });
  assert.equal(imported.package.category, "initial");
  assert.deepEqual(imported.package.delivery, { source: "code", assessmentId: "grade5-en-passage-v3", version: "3.0", activationAvailable: false });
  assert.deepEqual(imported.versions.map((v) => [v.versionLabel, v.status, v.source]), [["3.0", "published", "code_import"]]);
  assert.deepEqual(imported.versions[0].content.questions.map((q) => q.type),
    ["literal", "literal", "inferential", "inferential", "inferential", "critical"]);
  await refused(service.importInitial(as("sa"), { language: "en", assessment: codeContent("en") }), 409, /already/);
  assert.deepEqual((await service.listPackages(as("sa"))).capabilities.importInitial, ["fil"]);
  // School Admins and Teachers never see the initial package.
  await refused(service.getPackage(as("admin"), imported.package.id), 404);
  await refused(service.getPackage(as("teacher"), imported.package.id), 404);

  const pkgId = imported.package.id;
  const v3 = imported.versions[0].id;
  await refused(service.transition(as("sa"), pkgId, v3, "retire"), 409, /newer version/);
  await refused(service.archivePackage(as("sa"), pkgId), 409);
  const next = await service.createVersion(as("sa"), pkgId);
  assert.deepEqual([next.versions[0].versionLabel, next.versions[0].status], ["4.0", "draft"]);
  await refused(service.createVersion(as("sa"), pkgId), 409);
  // A new initial version is approved and published, but what learners take is still the code-defined 3.0.
  const v4 = next.versions[0].id;
  await service.transition(as("sa"), pkgId, v4, "submit");
  await service.transition(as("sa"), pkgId, v4, "approve", { attestation: "Reviewed by the Grade 5 English teacher." });
  const published = await service.transition(as("sa"), pkgId, v4, "publish");
  assert.equal(published.package.publishedVersion, "4.0");
  assert.equal(published.package.delivery.version, "3.0");
  assert.equal(DIAGNOSTIC_ASSESSMENTS.en.version, "3.0", "the delivered code assessment is untouched");
  assert.equal((await d.query("select count(*)::int n from diagnostic_results")).rows[0].n, before, "no diagnostic results touched");
});

test("archived packages are read-only and stay listed; custom version labels are validated", async () => {
  const { service } = await setup();
  const created = await service.createPackage(as("sa"), { category: "independent", language: "fil", title: "Pagsusulit" });
  const pkgId = created.package.id;
  await service.deleteDraft(as("sa"), pkgId, created.versions[0].id);
  await refused(service.createVersion(as("sa"), pkgId, { versionLabel: "v2" }), 400);
  const custom = await service.createVersion(as("sa"), pkgId, { versionLabel: "1.5" });
  assert.equal(custom.versions[0].versionLabel, "1.5");
  const archived = await service.archivePackage(as("sa"), pkgId);
  assert.equal(archived.package.archived, true);
  assert.deepEqual(archived.package.permissions, { view: true, manage: false, review: false, publish: false });
  await refused(service.updateDraft(as("sa"), pkgId, custom.versions[0].id, { content: COMPLETE }), 409, /archived/);
  await refused(service.renamePackage(as("sa"), pkgId, { title: "New" }), 409);
  assert.equal((await service.listPackages(as("sa"))).packages.length, 1);
});

test("draft content is normalized: ids by position, choices a-d, unknown types and keys dropped, limits enforced", async () => {
  const { service } = await setup();
  const created = await service.createPackage(as("teacher"), { category: "teacher", language: "en", title: "T" });
  const [pkgId, vId] = [created.package.id, created.versions[0].id];
  const result = await service.updateDraft(as("teacher"), pkgId, vId, { content: {
    passageTitle: " Title ", paragraphs: [" One. "],
    questions: [{ id: "evil", type: "essay", prompt: " P ", correctChoiceId: "z", extra: "x",
      choices: [{ id: "d", label: "D" }, { id: "a", label: "A", correct: true }] }],
  } });
  const content = result.versions[0].content;
  assert.deepEqual(content, { passageTitle: "Title", paragraphs: ["One."], questions: [{ id: "q1", type: "", prompt: "P",
    choices: [{ id: "a", label: "A" }, { id: "b", label: "" }, { id: "c", label: "" }, { id: "d", label: "D" }], correctChoiceId: null }] });
  assert.ok(result.versions[0].issues.length > 0, "structural issues are reported for the draft");
  // Drafts hold up to 8 questions (the editor's 5–8 range); the database still decides what may be submitted.
  const eight = [...COMPLETE.questions, question(7, "literal"), question(8, "critical")];
  await service.updateDraft(as("teacher"), pkgId, vId, { content: { ...COMPLETE, questions: eight } });
  await refused(service.updateDraft(as("teacher"), pkgId, vId, { content: { ...COMPLETE, questions: [...eight, question(9, "literal")] } }), 400);
  await refused(service.updateDraft(as("teacher"), pkgId, vId, { content: { ...COMPLETE, passageTitle: "x".repeat(201) } }), 400);
  await refused(service.updateDraft(as("teacher"), pkgId, "not-a-uuid", { content: COMPLETE }), 404);
});

test("policy table: categories map to exactly one kind/audience/scope; Teachers never review", () => {
  const teacher = { ...PEOPLE.teacher };
  const own = { kind: "reassessment", audience: "classroom", scope: "teacher", owner_id: teacher.id };
  assert.equal(policy.canReview(teacher, own), false);
  assert.equal(policy.canManage(teacher, own), true);
  assert.equal(policy.canView({ ...PEOPLE.pendingTeacher }, { ...own, owner_id: PEOPLE.pendingTeacher.id }), false);
  assert.equal(policy.categoryOf({ kind: "initial", audience: "classroom", scope: "school" }), null);
  for (const role of ["student", "general_user"]) {
    for (const shape of Object.values(policy.CATEGORIES)) {
      assert.equal(policy.canView({ id: uid(6), role }, { ...shape, owner_id: uid(6) }), false);
    }
  }
});

async function call(router, method, path, body) {
  const app = express();
  app.use(express.json());
  app.use("/api/assessment-packages", router);
  const server = app.listen(0);
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/assessment-packages${path}`, {
      method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, body: await response.json(), cache: response.headers.get("cache-control") };
  } finally {
    server.close();
  }
}

test("routes: learner refusal message, issues passed through, unknown action 404, no-store, 500s hide details", async () => {
  const { service } = await setup();
  const { OralReadingAuthorizationError } = require("../services/oralReadingAttemptService");
  const learnerRouter = createAssessmentPackagesRouter({ authorize: async () => { throw new OralReadingAuthorizationError(); }, service });
  const denied = await call(learnerRouter, "GET", "/");
  assert.equal(denied.status, 403);
  assert.match(denied.body.message, /System Admins, School Admins and approved Teachers only/);
  assert.equal(denied.cache, "no-store");

  const teacherRouter = createAssessmentPackagesRouter({ authorize: async () => as("teacher"), service });
  const created = await call(teacherRouter, "POST", "/", { category: "teacher", language: "en", title: "Route" });
  assert.equal(created.status, 200);
  const { id } = created.body.package;
  const versionId = created.body.versions[0].id;
  const publish = await call(teacherRouter, "POST", `/${id}/versions/${versionId}/publish`);
  assert.equal(publish.status, 422);
  assert.ok(publish.body.issues.length >= 3);
  assert.equal((await call(teacherRouter, "POST", `/${id}/versions/${versionId}/submit`)).status, 409, "F10 has no review stage");
  assert.equal((await call(teacherRouter, "POST", `/${id}/versions/${versionId}/delete-everything`)).status, 404);

  const logged = [];
  const broken = createAssessmentPackagesRouter({ authorize: async () => as("teacher"), log: (...a) => logged.push(a),
    service: { listPackages: async () => { throw new Error("connection string with secrets"); } } });
  const crash = await call(broken, "GET", "/");
  assert.equal(crash.status, 500);
  assert.doesNotMatch(JSON.stringify(crash.body) + JSON.stringify(logged), /secrets/);
});

test("no learner-facing code path reads the package tables, and diagnostic scoring files do not reference them", () => {
  for (const file of ["services/diagnosticResultService.js", "services/diagnosticAssessments.js", "routes/diagnosticResults.js"]) {
    let source = "";
    try { source = readFileSync(resolve(__dirname, "..", file), "utf8"); } catch { continue; }
    assert.doesNotMatch(source, /m2_assessment_package/, file);
  }
});

const REVIEW = { reviewerName: "Ms. Santos", reviewerQualification: "Grade 5 Filipino teacher, 12 years (stated by the reviewer)",
  reviewedOn: "2026-11-18", passageSuitable: true, questionsSound: true, answerKeysCorrect: true, languageAccurate: true,
  outcome: "endorsed", notes: "Synthetic test review." };

test("A1 educator reviews (F10): no new reviews for reassessment versions; earlier review records stay visible, read-only", async () => {
  const { d, service } = await setup();
  const created = await service.createPackage(as("teacher"), { category: "teacher", language: "fil", title: "Kuwento" });
  const [pkgId, vId] = [created.package.id, created.versions[0].id];
  await service.updateDraft(as("teacher"), pkgId, vId, { content: COMPLETE });
  // A version submitted under the old workflow, with a review recorded then (history).
  await d.query("update m2_assessment_package_versions set status = 'in_review', submitted_by = $2 where id = $1", [vId, PEOPLE.teacher.id]);
  await d.query(`insert into m2_assessment_educator_reviews(version_id, reviewer_name, reviewer_qualification, reviewed_on, passage_suitable, questions_sound,
    answer_keys_correct, language_accurate, outcome, recorded_by) values ($1, 'Ms. Santos', 'Teacher (stated)', '2026-11-18', true, true, true, true, 'endorsed', $2)`,
    [vId, PEOPLE.admin.id]);
  for (const key of ["teacher", "admin", "sa"]) await refused(service.recordEducatorReview(as(key), pkgId, vId, REVIEW), key === "teacher" ? 409 : 404);
  const view = await service.getPackage(as("teacher"), pkgId);
  assert.deepEqual(view.versions[0].educatorReviews.map((r) => [r.reviewedOn, r.outcome, r.recordedBy]), [["2026-11-18", "endorsed", "School Admin"]]);
  assert.equal(view.versions[0].educatorEndorsed, true);
  assert.equal((await d.query("select m2_version_educator_endorsed($1) ok", [vId])).rows[0].ok, true, "JS mirror agrees with the SQL rule");
  assert.deepEqual(view.package.permissions, { view: true, manage: true, review: false, publish: true });
});

test("A2 published vs active: imported 3.0 is the only active initial version; publishing 4.0 does not replace it", async () => {
  const { service } = await setup();
  const imported = await service.importInitial(as("sa"), { language: "en", assessment: codeContent("en") });
  assert.deepEqual([imported.versions[0].stageLabel, imported.versions[0].activeForLearners], ["Published in library", true]);
  assert.equal(imported.package.activeVersion, "3.0");
  const pkgId = imported.package.id;
  const next = await service.createVersion(as("sa"), pkgId);
  const v4 = next.versions[0].id;
  await service.transition(as("sa"), pkgId, v4, "submit");
  assert.equal((await service.getPackage(as("sa"), pkgId)).versions[0].stageLabel, "Submitted for review");
  await service.transition(as("sa"), pkgId, v4, "approve", { attestation: "Library approval." });
  await service.recordEducatorReview(as("sa"), pkgId, v4, REVIEW);
  const published = await service.transition(as("sa"), pkgId, v4, "publish");
  const [four, three] = published.versions;
  assert.deepEqual([four.versionLabel, four.stageLabel, four.activeForLearners, four.educatorEndorsed], ["4.0", "Published in library", false, true]);
  assert.match(four.activationNote, /does not replace the current initial diagnostic/);
  assert.deepEqual([three.versionLabel, three.status, three.activeForLearners], ["3.0", "retired", true],
    "the retired library record of 3.0 is still what learners take: library status and learner activity are separate");
  assert.equal(published.package.publishedVersion, "4.0");
  assert.equal(published.package.activeVersion, "3.0");
  assert.equal(DIAGNOSTIC_ASSESSMENTS.en.version, "3.0");

  const reassess = await service.createPackage(as("sa"), { category: "independent", language: "en", title: "IL" });
  assert.deepEqual([reassess.versions[0].activeForLearners, reassess.package.activeVersion], [false, null]);
  assert.match(reassess.versions[0].activationNote, /Never delivered automatically/);
});

test("current reading level service: maps the SQL lookup, validates input, reports a missing migration as 503", async () => {
  const { getCurrentReadingLevel, hasCompletedInitialDiagnostic, CurrentReadingLevelError } = require("../services/currentReadingLevelService");
  const calls = [];
  const admin = (respond) => () => ({ rpc: async (name, args) => { calls.push([name, args]); return respond(name); } });
  const row = { result_id: uid(500), assessment_type: "initial", reading_level: "Instructional", difficulty_tier: "Medium",
    assessment_id: "grade5-en-passage-v3", assessment_version: "3.0", package_version_id: null, verified_at: "2026-11-01T00:00:00Z" };
  const level = await getCurrentReadingLevel(PEOPLE.student.id, "en", { getAdmin: admin(() => ({ data: [row], error: null })) });
  assert.deepEqual(level, { resultId: uid(500), assessmentType: "initial", readingLevel: "Instructional", difficultyTier: "Medium",
    assessmentId: "grade5-en-passage-v3", assessmentVersion: "3.0", packageVersionId: null, verifiedAt: "2026-11-01T00:00:00Z" });
  assert.deepEqual(calls[0], ["m2_current_reading_level", { p_user: PEOPLE.student.id, p_language: "en" }]);
  assert.equal(await getCurrentReadingLevel(PEOPLE.student.id, "fil", { getAdmin: admin(() => ({ data: [], error: null })) }), null);
  assert.equal(await hasCompletedInitialDiagnostic(PEOPLE.student.id, "fil", { getAdmin: admin(() => ({ data: true, error: null })) }), true);
  await assert.rejects(getCurrentReadingLevel(PEOPLE.student.id, "es"), (e) => e instanceof CurrentReadingLevelError && e.statusCode === 400);
  await assert.rejects(getCurrentReadingLevel("nope", "en"), (e) => e.statusCode === 400);
  await assert.rejects(getCurrentReadingLevel(PEOPLE.student.id, "en", { getAdmin: admin(() => ({ data: null, error: { code: "PGRST202" } })) }),
    (e) => e.statusCode === 503 && e.code === "READING_LEVEL_NOT_INSTALLED");
  await assert.rejects(getCurrentReadingLevel(PEOPLE.student.id, "en", { getAdmin: admin(() => ({ data: null, error: { code: "XX000", message: "secret detail" } })) }),
    (e) => e.statusCode === 500 && !/secret/.test(e.message));
});

test("M3 and M8 are not rewired; F8/F9 code never calls M8 functions", () => {
  const { readFileSync: read } = require("node:fs");
  const placement = read(resolve(__dirname, "../../readflow/src/modules/module3/services/learnerPlacement.ts"), "utf8");
  assert.match(placement, /getInitialDiagnosticResult/);
  assert.doesNotMatch(placement, /current-level|m2_current_reading_level/);
  const serverJs = read(resolve(__dirname, "../server.js"), "utf8");
  assert.doesNotMatch(serverJs, /currentReadingLevel/, "the reading-level lookup is not exposed yet");
  for (const file of ["../routes/reassessments.js", "../services/reassessmentDeliveryService.js", "../services/reassessmentDeliveryRepository.js"]) {
    assert.doesNotMatch(read(resolve(__dirname, file), "utf8"), /m8_|m2_trusted_reading_level|unlocked_difficulty|level_up/, `${file} never touches M8`);
  }
});

test("review dates use the Manila calendar day (UTC 23:30 on the 18th is already the 19th in Manila)", () => {
  const { manilaToday } = require("../services/assessmentPackageService");
  assert.equal(manilaToday(new Date("2026-11-18T23:30:00Z")), "2026-11-19");
  assert.equal(manilaToday(new Date("2026-11-18T15:59:00Z")), "2026-11-18");
});
