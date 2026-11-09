import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

// Load the real service and the picker's pure helpers without a browser or Supabase.
function load(path: string, requireStub: (id: string) => unknown) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const module = { exports: {} as any };
  const code = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, require: requireStub, console });
  return module.exports;
}
const service = load("../src/modules/module4/services/classroomService.ts", () => ({ supabase: {} }));
const picker = load("../src/modules/module4/components/DueDateTimeInput.tsx", (id) =>
  id.endsWith("/classroomService") ? service : { jsx: () => null, jsxs: () => null });
const { dueDateIssue, parseOptionalDueDate } = service;
const joinDueValue = picker.joinDueValue as (date: string, time: string) => string;
// Arrays made inside the sandbox have another realm's prototype; copy them for deepEqual.
const splitDueValue = (value: string) => [...picker.splitDueValue(value)];

const NOW = new Date("2026-11-09T02:00:00.000Z"); // 10:00 AM in the Philippines

test("separate date and time fields still produce the existing Philippine-time value", () => {
  assert.equal(joinDueValue("2026-11-20", "16:45"), "2026-11-20T16:45");
  assert.deepEqual(splitDueValue("2026-11-20T16:45"), ["2026-11-20", "16:45"]);
  assert.equal(joinDueValue("", ""), "", "both empty means no deadline");
  assert.equal(parseOptionalDueDate(joinDueValue("2026-11-20", "16:45"), NOW), "2026-11-20T08:45:00.000Z");
  assert.equal(parseOptionalDueDate("", NOW), null);
});

test("a half-filled deadline names the missing part and is never saved", () => {
  assert.match(dueDateIssue(joinDueValue("2026-11-20", ""), NOW), /Choose a due time too/);
  assert.match(dueDateIssue(joinDueValue("", "16:45"), NOW), /Choose a due date too/);
  assert.throws(() => parseOptionalDueDate("2026-11-20T", NOW), /Choose a due time too/);
  assert.deepEqual(splitDueValue("2026-11-20T"), ["2026-11-20", ""]);
  assert.deepEqual(splitDueValue("T16:45"), ["", "16:45"]);
});

test("existing rules are unchanged: past times are refused, later today is allowed", () => {
  assert.match(dueDateIssue("2026-11-09T09:59", NOW), /already passed/);
  assert.equal(dueDateIssue("2026-11-09T10:30", NOW), "");
});
