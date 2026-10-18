import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import test from "node:test";

test("M4 classroom service preserves enrollment and assignment contracts", async (t) => {
  const calls: { operation: string; args: unknown[] }[] = [];
  let replies: { data: unknown; error: Error | null }[] = [];
  const client = {
    rpc(...args: unknown[]) {
      calls.push({ operation: "rpc", args });
      return Promise.resolve(replies.shift());
    },
    from(table: string) {
      calls.push({ operation: "from", args: [table] });
      const query: Record<string, (...args: any[]) => any> = {};
      for (const operation of ["select", "eq", "is", "in", "order", "insert", "update", "delete", "single", "maybeSingle"]) {
        query[operation] = (...args: unknown[]) => {
          calls.push({ operation, args });
          return query;
        };
      }
      query.then = (resolve, reject) => Promise.resolve(replies.shift()).then(resolve, reject);
      return query;
    },
  };
  const globals = globalThis as typeof globalThis & { __m4ClassroomClient?: typeof client };
  globals.__m4ClassroomClient = client;
  const url = new URL("../src/modules/module4/services/classroomService.ts", import.meta.url).href;
  const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
    if (context.parentURL === url && specifier.endsWith("/supabaseClient")) {
      return { url: "data:text/javascript,export const supabase = globalThis.__m4ClassroomClient", shortCircuit: true };
    }
    return nextResolve(specifier, context);
  } });
  function respond(...data: unknown[]) {
    calls.length = 0;
    replies = data.map((value) => ({ data: value, error: null }));
  }
  try {
    const service = await import(url) as typeof import("../src/modules/module4/services/classroomService.ts");
    await t.test("rosters use real nicknames, ignore legacy names and retain enrollment identities", async () => {
      const enrollments = ["nickname", "legacy", "missing", "fallback"].map(student_id => ({ id: `enrollment-${student_id}`, student_id, enrolled_at: "2026-10-08" }));
      respond(enrollments, [
        { id: "nickname", role: "student", nickname: "Reader", full_name: "Legal Name" },
        { id: "legacy", role: "student", nickname: " New User ", full_name: "NEW USER" },
        { id: "fallback", role: "student", nickname: null, full_name: "Legacy Name" },
      ]);
      const students = await service.getRoomEnrollments("room");
      assert.deepEqual(students.map(student => student.display_name), ["Reader", "\u2014", "\u2014", "Legacy Name"]);
      assert.deepEqual(students.map(student => student.enrollment_id), enrollments.map(row => row.id));
      assert.ok(calls.some(call => call.operation === "select" && call.args[0] === "id, full_name, nickname, role"));
    });
    await t.test("room joining normalizes the code and leaves identity to the authenticated RPC", async () => {
      respond({ id: "enrollment" });
      assert.deepEqual(await service.joinClassroomByCode("untrusted-student", "  abc234  "), { id: "enrollment" });
      assert.deepEqual(calls, [{ operation: "rpc", args: ["join_room_by_code", { p_room_code: "ABC234" }] }]);
    });
    await t.test("failed enrollment is propagated without a direct insert fallback", async () => {
      const error = new Error("enrollment rejected");
      respond();
      replies = [{ data: null, error }];
      await assert.rejects(service.joinClassroomByCode("student", "ROOM"), error);
      assert.deepEqual(calls.map((call) => call.operation), ["rpc"]);
    });
    await t.test("a student with no enrollments gets no rooms and no unrestricted room lookup", async () => {
      respond([]);
      assert.deepEqual(await service.getStudentClassrooms("student"), []);
      assert.deepEqual(calls.filter((call) => call.operation === "from").map((call) => call.args), [["enrollments"]]);
      assert.ok(calls.some((call) => call.operation === "eq" && call.args[0] === "student_id" && call.args[1] === "student"));
    });
    await t.test("student room queries use only enrolled room IDs", async () => {
      const rooms = [{ id: "room-a", room_name: "Class A" }];
      respond([{ room_id: "room-a" }], rooms);
      assert.deepEqual(await service.getStudentClassrooms("student"), rooms);
      assert.ok(calls.some((call) => call.operation === "in" && JSON.stringify(call.args) === JSON.stringify(["id", ["room-a"]])));
    });
    await t.test("teacher assignment catalog requests only published modules", async () => {
      respond([{ id: "module", status: "published" }]);
      assert.equal((await service.getPublishedModules()).length, 1);
      assert.ok(calls.some((call) => call.operation === "eq" && call.args[0] === "status" && call.args[1] === "published"));
    });
    await t.test("assigning a module preserves the deployed room_modules payload", async () => {
      respond(null);
      await service.assignModuleToRoom("room", "module", "teacher");
      assert.ok(calls.some((call) => call.operation === "from" && call.args[0] === "room_modules"));
      assert.deepEqual(calls.find((call) => call.operation === "insert")?.args, [{ room_id: "room", module_id: "module", assigned_by: "teacher" }]);
    });
    await t.test("assignment results combine saved assignment IDs with module metadata", async () => {
      respond([{ id: "assignment", module_id: "module", assigned_at: "2026-10-06" }], [{ id: "module", title: "Story", difficulty: "Easy" }]);
      assert.deepEqual(await service.getAssignedModules("room"), [{ assignment_id: "assignment", module_id: "module", assigned_at: "2026-10-06", title: "Story", difficulty: "Easy" }]);
    });
    await t.test("deleted, unpublished, and unavailable module assignments are omitted", async () => {
      respond([
        { id: "hidden-assignment", module_id: "hidden", assigned_at: "2026-10-06" },
        { id: "visible-assignment", module_id: "visible", assigned_at: "2026-10-06" },
      ], [{ id: "visible", title: "Available", difficulty: "Easy" }]);
      const rows = await service.getAssignedModules("room");
      assert.deepEqual(rows.map(row => row.assignment_id), ["visible-assignment"]);
      assert.ok(calls.some(call => call.operation === "is" && call.args[0] === "deleted_at" && call.args[1] === null));
      assert.ok(calls.some(call => call.operation === "eq" && call.args[0] === "status" && call.args[1] === "published"));
    });
  } finally {
    hooks.deregister();
    delete globals.__m4ClassroomClient;
  }
});

test("M4 routes retain role guards and coexist with the M5 results routes", async () => {
  const app = (await readFile(new URL("../src/App.tsx", import.meta.url), "utf8")).replace(/\s+/g, " ");
  const guardedSection = (role: string) => {
    const start = app.indexOf(`allowedRoles={["${role}"]}`);
    assert.ok(start >= 0);
    const next = app.indexOf("<Route element={<RequireRole", start);
    return app.slice(start, next < 0 ? undefined : next);
  };
  assert.match(guardedSection("student"), /path="join-classroom" element=\{<JoinClassroomPage \/>\}/);
  assert.match(guardedSection("student"), /path="learning-rooms\/:roomId" element=\{<StudentClassroomPage \/>\}/);
  assert.match(guardedSection("teacher"), /path="learning-rooms" element=\{<LearningRoomsPage \/>\}/);
  assert.match(guardedSection("admin"), /path="learning-rooms" element=\{<AdminLearningRoomsPage \/>\}/);
  assert.doesNotMatch(guardedSection("general_user"), /ClassroomPage|LearningRoomsPage/);
  assert.match(app, /modules\/module4\/pages\/ClassroomDetailsPage/);
  assert.match(app, /modules\/module5\/pages\/TeacherOralReadingAttemptPage/);
  assert.match(app, /modules\/module6\/pages\/ComprehensionPage/);
  for (const role of ["student", "general_user"]) {
    const section = guardedSection(role);
    const modulePath = role === "student" ? "materials" : "modules";
    assert.ok(section.includes(`path="${modulePath}/:moduleId/comprehension" element={<ComprehensionPage role="${role}" />}`));
    assert.ok(section.includes(`path="comprehension/:attemptId" element={<ComprehensionPage role="${role}" />}`));
    assert.ok(section.includes(`path="read-aloud/results/:attemptId" element={<ReadingResultPage role="${role}" />}`));
  }
  for (const role of ["teacher", "admin"]) {
    assert.doesNotMatch(guardedSection(role), /<ComprehensionPage/);
  }
});
