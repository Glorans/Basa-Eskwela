import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { createHookRuntime, loadComponentModule, tick } from "./helpers/hookRuntime.ts";

// Behavior tests for M3ContentContext's module status callbacks: status guard,
// service call, list update and feedback message. They read only the context
// value, so they hold across refactors of the provider's internals.

const require = createRequire(import.meta.url);
const contextUrl = new URL("../src/modules/module3/context/M3ContentContext.tsx", import.meta.url);

type Module = { id: string; title: string; status: "draft" | "published" | "archived" };
const loaded: Module[] = [
  { id: "draft", title: "Draft Story", status: "draft" },
  { id: "published", title: "Published Story", status: "published" },
  { id: "archived", title: "Archived Story", status: "archived" },
];
const RETURNED_TITLE = "Returned Story";
// Values created inside the vm sandbox have another realm's prototypes.
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));

type Overrides = Partial<Record<"publish" | "unpublish" | "archive" | "restore" | "delete", (id: string) => unknown>>;

async function mount(overrides: Overrides = {}) {
  const calls: [string, string][] = [];
  const returned = (status: Module["status"]) => (id: string) =>
    ({ ...loaded.find((module) => module.id === id)!, title: RETURNED_TITLE, status });
  const service = (name: keyof Overrides, fallback: (id: string) => unknown) => async (id: string) => {
    calls.push([name, id]);
    return (overrides[name] ?? fallback)(id);
  };
  const moduleService = {
    getModules: async () => loaded.map((module) => ({ ...module })),
    getLearningPaths: async () => [],
    getModuleById: async () => undefined,
    // Mirrors moduleService.getModuleErrorMessage.
    getModuleErrorMessage: (error: unknown, fallback: string) =>
      error instanceof Error && error.message ? error.message : fallback,
    createModule: async () => assert.fail("createModule is not under test"),
    updateModule: async () => assert.fail("updateModule is not under test"),
    publishModule: service("publish", returned("published")),
    unpublishModule: service("unpublish", returned("draft")),
    archiveModule: service("archive", returned("archived")),
    restoreModule: service("restore", returned("draft")),
    deleteModule: service("delete", () => "permanent"),
  };

  const runtime = createHookRuntime(require("react"));
  const context = loadComponentModule(contextUrl, (id) => {
    if (id === "react") return runtime.react;
    if (id === "react-router-dom") return { useLocation: () => ({ pathname: "/m3/admin" }) };
    if (id.endsWith("/moduleService")) return moduleService;
    if (id.endsWith("/studentModuleState")) return { getPublishedStudentModules: () => [] };
    if (id.endsWith("/supabaseClient")) return { supabase: {} };
    if (id.endsWith("/modulePassageService")) return { createModulePassageRepository: () => ({ getPassages: async () => [] }) };
    if (id.endsWith("/studentModuleDetail")) return { loadStudentModuleDetail: async () => undefined };
    if (id.endsWith("/materialService")) {
      return { getMaterials: async () => [], deleteMaterial: async () => {}, getMaterialServiceError: (_: unknown, fallback: string) => fallback };
    }
    return require(id);
  });

  const value = () => runtime.render(context.M3ContentProvider, { children: null }).props.value;
  value();
  await tick();
  assert.deepEqual(plain(value().modules).map((module: Module) => module.id), ["draft", "published", "archived"]);
  return {
    value,
    calls,
    modules: () => plain(value().modules) as Module[],
    feedback: () => plain(value().feedback),
  };
}

const statusCases = [
  {
    action: "publishModule", service: "publish", allowed: "draft", refused: ["published", "archived", "missing"],
    newStatus: "published", guard: "Only draft modules can be published.",
    success: (title: string) => `${title} was published and is now visible in published catalogs.`,
    fallback: "Unable to publish the reading module.",
  },
  {
    action: "unpublishModule", service: "unpublish", allowed: "published", refused: ["draft", "archived", "missing"],
    newStatus: "draft", guard: "Only published modules can be unpublished.",
    success: (title: string) => `${title} was unpublished and returned to Draft.`,
    fallback: "Unable to unpublish the reading module.",
  },
  {
    action: "archiveModule", service: "archive", allowed: "published", refused: ["archived", "missing"],
    newStatus: "archived", guard: "This module is already archived or unavailable.",
    success: (title: string) => `${title} was archived.`,
    fallback: "Unable to archive the reading module.",
  },
  {
    action: "restoreModule", service: "restore", allowed: "archived", refused: ["draft", "published", "missing"],
    newStatus: "draft", guard: "Only archived modules can be restored.",
    success: (title: string) => `${title} was restored as a draft.`,
    fallback: "Unable to restore the reading module.",
  },
] as const;

for (const c of statusCases) {
  test(`${c.action} refuses ${c.refused.join(", ")} modules without calling the service`, async () => {
    const m = await mount();
    for (const id of c.refused) {
      const result = plain(await m.value()[c.action](id));
      assert.deepEqual(result, { ok: false, message: c.guard }, id);
      assert.deepEqual(m.feedback(), { kind: "error", message: c.guard }, id);
    }
    assert.deepEqual(m.calls, []);
    assert.deepEqual(m.modules(), loaded);
  });

  test(`${c.action} calls the service, replaces the module and reports success`, async () => {
    const m = await mount();
    const result = plain(await m.value()[c.action](c.allowed));
    const message = c.success(RETURNED_TITLE);
    assert.deepEqual(m.calls, [[c.service, c.allowed]]);
    assert.equal(result.ok, true);
    assert.equal(result.message, message);
    assert.deepEqual(result.module, { id: c.allowed, title: RETURNED_TITLE, status: c.newStatus });
    assert.deepEqual(m.feedback(), { kind: "success", message });
    assert.deepEqual(
      m.modules(),
      loaded.map((module) => module.id === c.allowed ? { id: c.allowed, title: RETURNED_TITLE, status: c.newStatus } : module),
    );
  });

  test(`${c.action} reports a failure, or its fallback, without changing the list`, async () => {
    let failure: unknown = new Error("boom");
    const m = await mount({ [c.service]: () => { throw failure; } });
    assert.deepEqual(plain(await m.value()[c.action](c.allowed)), { ok: false, message: "boom" });
    assert.deepEqual(m.feedback(), { kind: "error", message: "boom" });
    failure = "not an Error";
    assert.deepEqual(plain(await m.value()[c.action](c.allowed)), { ok: false, message: c.fallback });
    assert.deepEqual(m.feedback(), { kind: "error", message: c.fallback });
    assert.deepEqual(m.modules(), loaded);
  });
}

test("deleteModule refuses a module that is not in the loaded list", async () => {
  const m = await mount();
  const message = "This module is no longer in the loaded list. Refresh the list before deleting.";
  assert.deepEqual(plain(await m.value().deleteModule("missing")), { ok: false, message });
  assert.deepEqual(m.feedback(), { kind: "error", message });
  assert.deepEqual(m.calls, []);
  assert.deepEqual(m.modules(), loaded);
});

test("deleteModule with a soft outcome removes the module and explains what was kept", async () => {
  const m = await mount({ delete: () => "soft" });
  const message = "Published Story was removed from active catalogs. Existing assignments and reading history were preserved.";
  const result = plain(await m.value().deleteModule("published"));
  assert.deepEqual(m.calls, [["delete", "published"]]);
  assert.deepEqual(result, { ok: true, module: loaded[1], message });
  assert.deepEqual(m.feedback(), { kind: "success", message });
  assert.deepEqual(m.modules().map((module) => module.id), ["draft", "archived"]);
});

test("deleteModule with a permanent outcome removes the module", async () => {
  const m = await mount({ delete: () => "permanent" });
  const message = "Draft Story was permanently deleted.";
  const result = plain(await m.value().deleteModule("draft"));
  assert.deepEqual(result, { ok: true, module: loaded[0], message });
  assert.deepEqual(m.feedback(), { kind: "success", message });
  assert.deepEqual(m.modules().map((module) => module.id), ["published", "archived"]);
});

test("deleteModule reports a failure, or its fallback, without changing the list", async () => {
  let failure: unknown = new Error("blocked by assignments");
  const m = await mount({ delete: () => { throw failure; } });
  assert.deepEqual(plain(await m.value().deleteModule("draft")), { ok: false, message: "blocked by assignments" });
  failure = "not an Error";
  assert.deepEqual(plain(await m.value().deleteModule("draft")), { ok: false, message: "Unable to delete the reading module." });
  assert.deepEqual(m.feedback(), { kind: "error", message: "Unable to delete the reading module." });
  assert.deepEqual(m.modules(), loaded);
});
