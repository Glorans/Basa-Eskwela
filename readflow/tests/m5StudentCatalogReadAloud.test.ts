import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { after, beforeEach, test } from "node:test";
import { AxiosError, AxiosHeaders } from "axios";

// Student Reading Materials -> module -> Read Aloud. The catalog lists every published module; a Student's
// Read Aloud needs a classroom assignment. The module page asks the server first (the same cached request the
// Read Aloud page makes) and explains a refusal instead of offering a Read Aloud that cannot open.

type Call = { url: string; config: Record<string, unknown> };
let calls: Call[] = [];
let reply: () => Promise<unknown>;
let sessionNumber = 0;
let token = "token";
const fixture = {
  supabase: { auth: {
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    getSession: async () => ({ data: { session: { access_token: token, user: { id: "student" } } }, error: null }),
  } },
  api: { get: (url: string, config: Record<string, unknown>) => { calls.push({ url, config }); return reply(); } },
};
const globals = globalThis as typeof globalThis & { __m5StudentCatalog?: typeof fixture };
globals.__m5StudentCatalog = fixture;
const serviceUrl = new URL("../src/modules/module5/services/oralReadingService.ts", import.meta.url).href;
const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  if (context.parentURL === serviceUrl) {
    if (specifier.endsWith("/supabaseClient")) return { url: "data:text/javascript,export const supabase = globalThis.__m5StudentCatalog.supabase", shortCircuit: true };
    if (specifier.endsWith("/services/api")) return { url: "data:text/javascript,export default globalThis.__m5StudentCatalog.api", shortCircuit: true };
    if (specifier.endsWith("/teacherComprehension")) {
      return { url: "data:text/javascript,export const parseTeacherComprehensionDetail = (value) => value; export const parseTeacherComprehensionSummary = (value) => value;", shortCircuit: true };
    }
  }
  return nextResolve(specifier, context);
} });
const service = await import(serviceUrl) as typeof import("../src/modules/module5/services/oralReadingService.ts");
after(() => { hooks.deregister(); delete globals.__m5StudentCatalog; });
beforeEach(() => { calls = []; token = `token-${++sessionNumber}`; });

const forbidden = (data: Record<string, unknown>) => () => Promise.reject(new AxiosError("Request failed", "ERR_BAD_REQUEST", undefined, undefined,
  { status: 403, statusText: "Forbidden", data, headers: {}, config: { headers: new AxiosHeaders() } }));

test("the server's assignment reason code reaches the page, and only those codes count as an assignment refusal", async () => {
  reply = forbidden({ success: false, code: "CLASSROOM_ASSIGNMENT_REQUIRED", message: "This module must be assigned in a classroom where you are enrolled." });
  const error = await service.getOralReadingModule("early", { passageId: "p1" }).catch((e: unknown) => e);
  assert.ok(error instanceof service.OralReadingServiceError);
  assert.equal(error.code, "CLASSROOM_ASSIGNMENT_REQUIRED");
  assert.equal(error.message, "This module must be assigned in a classroom where you are enrolled.");
  assert.equal(service.isStudentAssignmentRefusal(error), true);
  for (const code of ["SELECTED_STUDENTS_ONLY", "MODULE_REMOVED_FROM_CLASSROOM"]) {
    assert.equal(service.isStudentAssignmentRefusal(new service.OralReadingServiceError("x", code)), true);
  }
  // Network, server and other refusals keep the Read Aloud link (that page shows them with Retry).
  for (const code of [undefined, "CLASSROOM_REQUIRED", "MODULE_NOT_FOUND", "PASSAGE_REQUIRED"]) {
    assert.equal(service.isStudentAssignmentRefusal(new service.OralReadingServiceError("x", code)), false);
  }
  assert.equal(service.isStudentAssignmentRefusal(new Error("x")), false);
});

test("a generic refusal keeps its message and has no code", async () => {
  reply = forbidden({ success: false, message: "This oral-reading activity is not available to your account." });
  const error = await service.getOralReadingModule("m", { roomId: "other" }).catch((e: unknown) => e);
  assert.ok(error instanceof service.OralReadingServiceError);
  assert.equal(error.code, undefined);
  assert.equal(service.isStudentAssignmentRefusal(error), false);
});

test("the module-page check and the Read Aloud page share one request for the same module and passage", async () => {
  reply = async () => ({ data: { module: { id: "english", passage: "Ana reads.", roomId: "room" } } });
  // Module page: { passageId } only. Read Aloud page: values from the URL (null when absent).
  await service.getOralReadingModule("english", { passageId: "p1" });
  const loaded = await service.getOralReadingModule("english", { passageId: "p1", roomId: null, assignmentId: null, materialId: null, activityAssignmentId: null } as never);
  assert.equal(calls.length, 1);
  assert.equal(loaded.roomId, "room");
  assert.equal(calls[0].url, "/api/oral-reading/modules/english");
});

const source = (path: string) => readFile(new URL(`../src/${path}`, import.meta.url), "utf8");

test("the Student module page checks Read Aloud only for catalog entries and explains assignment refusals", async () => {
  const page = await source("pages/StudentModuleViewPage.tsx");
  assert.match(page, /const checkReadAloud = role === "student" && !cameFromClassroom && !archivedRoom && Boolean\(module\);/);
  assert.match(page, /getOralReadingModule\(checkedModuleId, \{ passageId: checkPassageId \}\)/);
  assert.match(page, /module\.passages\[0\]\?\.id \?\? module\.id/);
  assert.match(page, /isStudentAssignmentRefusal\(error\)/);
  assert.match(page, /readAloudRefusal\?\.moduleId === module\.id \? \(/);
  assert.match(page, /You can read this passage here\. Read Aloud is not available: \{readAloudRefusal\.message\}/);
  // The Start Read-Aloud link and its classroom parameters are unchanged.
  assert.match(page, /passageId: activePassage\?\.id \?\? module\.id,/);
  assert.match(page, /roomId: cameFromClassroom \? roomId : undefined,/);
  assert.match(page, /Start Read-Aloud/);
});

test("assignment refusals are translated for Filipino reading screens", async () => {
  const language = await source("pages/reading-activity/activityLanguage.ts");
  for (const text of [
    "This module must be assigned in a classroom where you are enrolled.",
    "This module must be assigned in a classroom where you are enrolled. Join your teacher's classroom first.",
    "Your teacher assigned this module to selected students only.",
    "Your teacher removed this module from the classroom. Your saved results are still in Reading History.",
  ]) assert.ok(language.includes(`"${text}":`), text);
  const server = await readFile(new URL("../../server/services/oralReadingAttemptService.js", import.meta.url), "utf8");
  assert.match(server, /const NO_CLASSROOM_MESSAGE = `\$\{CLASSROOM_ASSIGNMENT_MESSAGE\} Join your teacher's classroom first\.`;/);
});
