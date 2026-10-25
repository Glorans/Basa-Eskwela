import assert from "node:assert/strict";
import test from "node:test";
import { numberSavedAttempts } from "../src/modules/module5/services/savedAttemptOrder.ts";

test("result numbers are chronological, deterministic on ties, deduplicated and ignore unfinished rows", () => {
  const rows = [
    { id: "b", completedAt: "2026-10-25T02:00:00Z" },
    { id: "a", completedAt: "2026-10-25T02:00:00Z" },
    { id: "first", completedAt: "2026-10-25T01:00:00Z" },
    { id: "draft", completedAt: "" },
  ];
  const result = numberSavedAttempts([...rows, rows[0]]);
  assert.deepEqual(result.map(row => [row.id, row.resultNumber]), [["first", 1], ["a", 2], ["b", 3]]);
  assert.deepEqual(numberSavedAttempts(rows.slice().reverse()), result);
  assert.deepEqual(numberSavedAttempts([...rows, { id: "later", completedAt: "2026-10-26T01:00:00Z" }]).slice(0, 3), result);
  assert.equal(rows[0].id, "b", "input is not mutated");
});
