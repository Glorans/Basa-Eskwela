import assert from "node:assert/strict";
import test from "node:test";
import { readAloudTarget } from "../src/modules/module5/services/oralReadingNavigation.ts";

test("Student selected passage, room and assignment survive URL refresh", () => {
  const url = new URL(readAloudTarget("student", "module", { passageId: "passage-2", roomId: "room", assignmentId: "assignment" }), "http://localhost");
  assert.equal(url.pathname, "/dashboard/materials/module/read-aloud");
  assert.deepEqual(Object.fromEntries(url.searchParams), { passageId: "passage-2", roomId: "room", assignmentId: "assignment" });
});
test("Independent Learner selected passage uses its M3 entry route", () => {
  const url = new URL(readAloudTarget("general_user", "module", { passageId: "passage-2" }), "http://localhost");
  assert.equal(url.pathname, "/m3/general/modules/module/read-aloud");
  assert.equal(url.searchParams.get("passageId"), "passage-2");
  assert.equal(url.searchParams.has("roomId"), false);
});
