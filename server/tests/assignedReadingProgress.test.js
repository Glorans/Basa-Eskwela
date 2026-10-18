const test = require("node:test");
const assert = require("node:assert/strict");
const { createDatabase } = require("./fixtures/materialDatabase");
const { getAssignedReadingProgress } = require("../services/assignedReadingProgress");

const room = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const owner = { user: { id: "student" }, profile: { role: "student" } };
function fixture() {
  const db = createDatabase({
    enrollments: [{ room_id: room, student_id: "student" }],
    reading_activity_assignments: [{ id: "assignment", material_id: "material", room_id: room, student_id: "student", status: "completed" }],
    oral_reading_attempts: [], m6_comprehension_attempts: [],
  });
  const oral = { id: "oral", user_id: "student", room_id: room, material_id: "material", activity_assignment_id: "assignment", completed_at: "2026-10-12", pronunciation_accuracy: 0 };
  const comprehension = { ...oral, id: "comprehension", oral_reading_attempt_id: "oral", status: "in_progress" };
  return { db, oral, comprehension, get: () => getAssignedReadingProgress(owner, room, { getSupabaseAdmin: () => db }) };
}

test("legacy completion is not assessment completion; saved linked records drive all stages without writes", async () => {
  const f = fixture();
  assert.equal((await f.get())[0].status, "Not Started");
  f.db.tables.oral_reading_attempts.push(f.oral);
  assert.equal((await f.get())[0].status, "Oral Reading Saved");
  f.db.tables.m6_comprehension_attempts.push(f.comprehension);
  assert.equal((await f.get())[0].status, "Comprehension In Progress");
  f.comprehension.status = "completed";
  const before = structuredClone(f.db.tables);
  const progress = (await f.get())[0];
  assert.equal(progress.status, "Completed");
  assert.equal(progress.comprehensionAttemptId, "comprehension");
  assert.equal(progress.oralReadingAttemptId, "oral");
  assert.deepEqual(f.db.tables, before);
  assert.equal("pronunciation_accuracy" in progress, false);
});

test("explicit oral-only completion requires a saved oral result and persisted activity status", async () => {
  const f = fixture();
  const assignment = f.db.tables.reading_activity_assignments[0];
  assignment.read_aloud_only = true;
  assignment.status = 'assigned';
  assert.equal((await f.get())[0].status, 'Not Started');
  f.db.tables.oral_reading_attempts.push(f.oral);
  assert.equal((await f.get())[0].status, 'Oral Reading Saved');
  assignment.status = 'completed';
  const progress = (await f.get())[0];
  assert.equal(progress.readAloudOnly, true);
  assert.equal(progress.status, 'Completed');
  assert.equal(progress.comprehensionAttemptId, null);
});

test("foreign students, assignments, materials, rooms and unlinked M6 cannot complete the activity", async () => {
  for (const mismatch of [
    { user_id: "other" }, { room_id: "other" }, { material_id: "other" },
    { activity_assignment_id: "other" }, { oral_reading_attempt_id: "other" },
  ]) {
    const f = fixture();
    f.db.tables.oral_reading_attempts.push(f.oral);
    f.db.tables.m6_comprehension_attempts.push({ ...f.comprehension, status: "completed", ...mismatch });
    assert.equal((await f.get())[0].status, "Oral Reading Saved");
  }
  const f = fixture();
  f.db.tables.oral_reading_attempts.push({ ...f.oral, user_id: "other" });
  f.db.tables.m6_comprehension_attempts.push({ ...f.comprehension, status: "completed" });
  assert.equal((await f.get())[0].status, "Not Started");
});

test("completed assessment takes precedence over later practice and progress spans result pages", async () => {
  const f = fixture();
  f.db.tables.oral_reading_attempts.push(f.oral);
  f.db.tables.m6_comprehension_attempts.push({ ...f.comprehension, status: "completed" });
  for (let index = 0; index < 105; index++) f.db.tables.oral_reading_attempts.push({ ...f.oral, id: `practice-${index}`, completed_at: "2026-10-13" });
  const progress = (await f.get())[0];
  assert.equal(progress.status, "Completed");
  assert.equal(progress.oralReadingAttemptId, "oral");
});

test("progress requires student enrollment and fails closed on database errors", async () => {
  const f = fixture();
  const deps = { getSupabaseAdmin: () => f.db };
  await assert.rejects(getAssignedReadingProgress({ ...owner, profile: { role: "general_user" } }, room, deps), { statusCode: 403 });
  await assert.rejects(getAssignedReadingProgress(owner, "bad", deps), { statusCode: 400 });
  f.db.tables.enrollments = [];
  await assert.rejects(f.get(), { statusCode: 403 });
  f.db.tables.enrollments = [{ room_id: room, student_id: "student" }];
  delete f.db.tables.m6_comprehension_attempts;
  await assert.rejects(f.get(), /Unable to load assessment progress/);
});
