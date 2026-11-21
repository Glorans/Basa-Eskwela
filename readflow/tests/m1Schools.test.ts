import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { createHookRuntime, findAll, loadComponentModule, textOf, tick } from "./helpers/hookRuntime.ts";

// M1 F8 Create School (System Admin). The server and database are the authority (server/tests/m1MultiTenancy.test.js,
// release-review rehearsal); these tests cover the page: validation, normalisation, list and status changes.
const require = createRequire(import.meta.url);

type School = { id: string; name: string; code: string; status: "active" | "inactive"; isLegacy: boolean; schoolAdmins: number; teachers: number; students: number };

function mountSchools(options: { fail?: string } = {}) {
  const runtime = createHookRuntime(require("react"));
  const schools: School[] = [{ id: "s1", name: "School 1", code: "SCHOOL-1", status: "active", isLegacy: true, schoolAdmins: 3, teachers: 5, students: 39 }];
  const created: object[] = [];
  const updated: [string, object][] = [];
  const confirms: string[] = [];
  const page = loadComponentModule(new URL("../src/modules/module1/pages/admin/SchoolsPage.tsx", import.meta.url), (id) => {
    if (id === "react") return runtime.react;
    if (id.endsWith("/components/ReadFlowDialog")) return { confirmReadFlow: async (message: string) => { confirms.push(message); return true; } };
    if (id.endsWith("/services/adminUsers")) return { getAdminUserError: (e: Error) => e.message };
    if (id.endsWith("/services/schools")) {
      // Same client-side hints as services/schools.ts (the server validates again).
      return {
        SCHOOL_CODE_PATTERN: /^[A-Z0-9][A-Z0-9-]{0,30}[A-Z0-9]$/,
        normalizeSchoolCode: (value: string) => value.trim().toUpperCase(),
        normalizeSchoolName: (value: string) => value.replace(/\s+/g, " ").trim(),
        listSchools: async () => schools.map((s) => ({ ...s })),
        createSchool: async (input: { name: string; code: string; status: School["status"] }) => {
          if (options.fail) throw new Error(options.fail);
          created.push(input);
          schools.push({ id: `s${schools.length + 1}`, ...input, isLegacy: false, schoolAdmins: 0, teachers: 0, students: 0 });
          return { success: true };
        },
        updateSchool: async (schoolId: string, input: { status: School["status"] }) => {
          updated.push([schoolId, input]);
          schools.find((s) => s.id === schoolId)!.status = input.status;
          return { success: true };
        },
      };
    }
    if (id.endsWith(".css")) return {};
    return require(id);
  });
  const render = () => runtime.render(page.default, {});
  const settle = async () => { for (let i = 0; i < 8; i++) { await tick(); render(); } };
  const inputs = () => findAll(render(), (n) => n.type === "input");
  const type = (index: number, value: string) => { inputs()[index].props.onChange({ target: { value } }); render(); };
  const submit = async () => { findAll(render(), (n) => n.type === "form")[0].props.onSubmit({ preventDefault() {} }); await settle(); };
  return { render, settle, type, submit, created, updated, confirms, text: () => textOf(render()) };
}

test("F8 Create School: validates name and code, normalises them, and lists the new school", async () => {
  const m = mountSchools();
  m.render();
  await m.settle();
  assert.match(m.text(), /School 1 \(existing school\)SCHOOL-1Active3539/);
  await m.submit();
  assert.match(m.text(), /Enter the school name/);
  assert.match(m.text(), /Use 2 to 32 letters, numbers or hyphens/);
  assert.equal(m.created.length, 0);
  m.type(0, "  Mabini   Elementary  ");
  m.type(1, " school-2 ");
  await m.submit();
  assert.deepEqual(JSON.parse(JSON.stringify(m.created)), [{ name: "Mabini Elementary", code: "SCHOOL-2", status: "active" }]);
  assert.match(m.text(), /School created: Mabini Elementary \(SCHOOL-2\)/);
  assert.match(m.text(), /Mabini ElementarySCHOOL-2Active000/);
});

test("F8: a server refusal (for example a duplicate code) is shown and nothing is listed", async () => {
  const m = mountSchools({ fail: "A school with this code already exists. Choose a different code." });
  m.render();
  await m.settle();
  m.type(0, "Another School");
  m.type(1, "SCHOOL-1");
  await m.submit();
  assert.match(m.text(), /already exists/);
  assert.doesNotMatch(m.text(), /Another School/);
});

test("F8: deactivating a school asks first, says records are kept, and never offers deletion", async () => {
  const m = mountSchools();
  m.render();
  await m.settle();
  assert.doesNotMatch(m.text(), /Delete/);
  const button = findAll(m.render(), (n) => n.type === "button" && textOf(n) === "Deactivate")[0];
  button.props.onClick();
  await m.settle();
  assert.match(m.confirms[0], /accounts and records are kept/);
  assert.deepEqual(JSON.parse(JSON.stringify(m.updated)), [["s1", { status: "inactive" }]]);
  assert.match(m.text(), /School 1 is now inactive/);
  assert.ok(findAll(m.render(), (n) => n.type === "button" && textOf(n) === "Reactivate").length === 1);
});
