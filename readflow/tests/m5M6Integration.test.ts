import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { comprehensionTargetForReading } from "../src/modules/module5/services/comprehensionNavigation.ts";
import { processOralReading } from "../src/modules/module5/services/oralReadingProcessing.ts";

test("uploaded-story recording reuses M5 processing and preserves separate source IDs and revision", async () => {
  const saved = await processOralReading({
    moduleId: null, materialId: "material", activityAssignmentId: "activity", roomId: "room",
    passageRevision: "revision", submissionId: "submission", expectedText: "Seeds need sun.", language: "en",
    recording: new Blob(["recording"], { type: "audio/webm;codecs=opus" }), recordingDurationSeconds: 5,
    transcribeRecording: async () => ({ text: "Seeds need sun." }),
  });
  assert.equal(saved.moduleId, null);
  assert.equal(saved.materialId, "material");
  assert.equal(saved.activityAssignmentId, "activity");
  assert.equal(saved.passageRevision, "revision");
  assert.equal(saved.submissionId, "submission");
  assert.equal(saved.transcript, "Seeds need sun.");
  assert.ok(saved.wordMetrics.every(word => word.type === "match"));
});

test("material comprehension navigation carries exact oral result and assignment without a module ID", () => {
  const target = comprehensionTargetForReading("student", {
    id: "oral", moduleId: null, materialId: "material", roomId: "room", activityAssignmentId: "activity",
  });
  const url = new URL(target!, "http://localhost");
  assert.equal(url.pathname, "/dashboard/reading-materials/material/comprehension");
  assert.deepEqual(Object.fromEntries(url.searchParams), { roomId: "room", activityAssignmentId: "activity", oralReadingAttemptId: "oral" });
  assert.equal(comprehensionTargetForReading("student", { id: "oral", moduleId: null, materialId: "material" }), null);
  assert.equal(comprehensionTargetForReading("general_user", { id: "oral", moduleId: null, materialId: "material", roomId: "room", activityAssignmentId: "activity" }), null);
});

test("student and independent module transitions keep the exact selected passage", () => {
  for (const role of ["student", "general_user"] as const) {
    const url = new URL(comprehensionTargetForReading(role, { id: "oral", moduleId: "module", passageId: "passage" })!, "http://localhost");
    assert.equal(url.pathname, role === "student" ? "/dashboard/materials/module/comprehension" : "/m3/general/modules/module/comprehension");
    assert.equal(url.searchParams.get("passageId"), "passage");
    assert.equal(url.searchParams.get("oralReadingAttemptId"), "oral");
    assert.equal(comprehensionTargetForReading(role, { id: "oral", moduleId: "module", passageId: null }), null);
  }
});

test("integrated activity entry derives progress without writing M4 completion", async () => {
  const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");
  const [panel, page, source] = await Promise.all([
    read("../src/modules/module5/components/AssignedReadingAssessments.tsx"),
    read("../src/modules/module4/pages/StudentReadingActivityPage.tsx"),
    read("../../server/services/assignedReadingSource.js"),
  ]);
  assert.doesNotMatch(panel, /updateReadingActivityStatus|classroomService|\.update\(/);
  // Hash.update computes the story revision; only database mutations are forbidden.
  assert.doesNotMatch(source, /db\.from\([^;]+\.(?:update|insert|delete)\(/s);
  assert.match(page, /getAssignedReadingProgress/);
  assert.match(page, /assignedReadingTarget/);
  assert.doesNotMatch(page, /Mark as Completed|updateReadingActivityStatus/);
});

test("migration changes only assessment storage, never M4 policies, tables or records", async () => {
  const sql = await readFile(new URL("../../supabase/migrations/20261012_m5_m6_uploaded_reading.sql", import.meta.url), "utf8");
  assert.doesNotMatch(sql, /(?:alter table|update|delete from|insert into) public\.(?:rooms|enrollments|room_modules|uploaded_materials|reading_activity_assignments)\b/i);
  assert.doesNotMatch(sql, /(?:create|drop|alter) policy/i);
  assert.match(sql, /m6_owner_oral_result_unique/);
  assert.match(sql, /m5_reading_source_check/);
});
