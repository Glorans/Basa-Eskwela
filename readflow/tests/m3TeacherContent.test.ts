import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createHookRuntime, findAll, loadComponentModule, textOf, tick } from "./helpers/hookRuntime.ts";

// M3 Teacher F1–F5 frontend: the Admin list page and editor are reused with workspace="teacher".
// Permissions themselves are enforced by the database (supabase/tests/m3_teacher_module_management_test.sql).

const require = createRequire(import.meta.url);
const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
const pageUrl = new URL("../src/modules/module3/pages/Module3Page.tsx", import.meta.url);
const editorUrl = new URL("../src/modules/module3/components/AdminCollectionEditor.tsx", import.meta.url);

const base = { learningPathId: "p", learningPath: "Path", difficultyTier: "Easy", passage: "", questionCount: 6, createdAt: "2026-11-09T00:00:00Z" };
const MODULES = [
  { ...base, id: "mine-draft", title: "My Easy Draft", status: "draft", language: "en", readingLevel: "Frustration", difficulty: "Easy", createdBy: "t1" },
  { ...base, id: "mine-pub", title: "My Hard Story", status: "published", language: "fil", readingLevel: "Independent", difficulty: "Hard", createdBy: "t1", publishedAt: "2026-11-09T01:00:00Z" },
  { ...base, id: "other-pub", title: "Someone Else", status: "published", language: "en", readingLevel: "Instructional", difficulty: "Medium", createdBy: "t2", publishedAt: "2026-11-09T01:00:00Z" },
];

function mountList(workspace?: "admin" | "teacher") {
  const runtime = createHookRuntime(require("react"));
  const calls: string[] = [];
  const page = loadComponentModule(pageUrl, (id) => {
    if (id === "react") return runtime.react;
    if (id === "lucide-react") return new Proxy({}, { get: () => "svg" });
    if (id === "react-router-dom") return { Link: "a" };
    if (id.endsWith("/M3ContentContext")) {
      return { useM3Content: () => ({ modules: MODULES, modulesLoading: false, modulesError: null, refreshModules: async () => {},
        feedback: null, clearFeedback: () => {}, deleteModule: async () => ({ ok: true }), archiveModule: async () => ({ ok: true }),
        restoreModule: async () => ({ ok: true }) }) };
    }
    if (id.endsWith("/auth/useAuth")) return { useAuth: () => ({ user: { id: "t1" } }) };
    if (id.endsWith("/services/moduleService")) {
      return { getTrashedModules: async () => { calls.push("trash"); return []; }, purgeTrashedModule: async () => {},
        restoreTrashedModule: async () => {}, trashModule: async () => {} };
    }
    if (id.endsWith("/components/AdminCollectionEditor")) {
      return { editorPaths: (w: string) => w === "teacher"
        ? { list: "/m3/teacher/content", module: "/m3/teacher/content" } : { list: "/m3/admin", module: "/m3/admin/modules" } };
    }
    if (id.endsWith("/ReadFlowDialog")) return { confirmReadFlow: async () => true };
    if (id.endsWith(".css")) return {};
    if (id.startsWith("../components/") || id.startsWith("../utils/")) return new Proxy({}, { get: (_t, key) => key === "default" ? function Stub() { return null; } : () => "" });
    return require(id);
  });
  const render = () => runtime.render(page.default, workspace ? { workspace } : {});
  const titles = () => findAll(render(), (n) => n.type === "article" && n.props?.className === "m3-record-card")
    .map((card) => textOf(findAll(card, (n) => n.type === "h2")[0]));
  const select = (label: string) => findAll(render(), (n) => n.type === "label" && textOf(n).startsWith(label))[0];
  return { render, titles, select, calls, text: () => textOf(render()) };
}

test("Teacher list shows only the Teacher's own modules and links into the Teacher workspace", async () => {
  const m = mountList("teacher");
  m.render(); await tick(); m.render();
  assert.deepEqual(m.titles(), ["My Easy Draft", "My Hard Story"]);
  const tree = m.render();
  const hrefs = findAll(tree, (n) => n.type === "a").map((n) => n.props.to);
  const create = findAll(tree, (n) => n.props?.actions)[0].props.actions.props.to;
  assert.equal(create, "/m3/teacher/content/new");
  assert.ok(hrefs.includes("/m3/teacher/content/mine-draft/edit"));
  assert.ok(hrefs.includes("/m3/teacher/content/mine-pub"));
  assert.ok(hrefs.every((href: string) => !href.startsWith("/m3/admin")));
  assert.equal(findAll(tree, (n) => n.props?.actions)[0].props.title, "My Reading Modules");
  assert.deepEqual(m.calls, [], "Trash is never loaded for Teachers");
  const buttons = findAll(m.render(), (node) => node.type === "button").map((node) => node.props["aria-label"] ?? textOf(node));
  assert.ok(buttons.every((label: string) => !/^(Archive|Restore)/.test(label)), "no Archive/Restore actions for Teachers");
  assert.equal(findAll(m.render(), (node) => node.props?.className === "m3-panel m3-trash").length, 0, "no Trash section");
  assert.deepEqual(buttons.filter((label: string) => label.startsWith("Delete")), ["Delete My Easy Draft", "Delete My Hard Story"]);
});

test("Teacher F2: modules are organized by reading level and difficulty", () => {
  const m = mountList("teacher");
  findAll(m.select("Difficulty"), (n) => n.type === "select")[0].props.onChange({ target: { value: "Hard" } });
  assert.deepEqual(m.titles(), ["My Hard Story"]);
  findAll(m.select("Difficulty"), (n) => n.type === "select")[0].props.onChange({ target: { value: "all" } });
  findAll(m.select("Reading level"), (n) => n.type === "select")[0].props.onChange({ target: { value: "Frustration" } });
  assert.deepEqual(m.titles(), ["My Easy Draft"]);
  const levels = findAll(findAll(m.select("Reading level"), (n) => n.type === "select")[0], (n) => n.type === "option").map((o) => o.props.value ?? o.props.children);
  assert.deepEqual(levels.slice(1), ["Frustration", "Instructional", "Independent"], "only the existing reading levels");
  const difficulties = findAll(findAll(m.select("Difficulty"), (n) => n.type === "select")[0], (n) => n.type === "option").map((o) => o.props.value);
  assert.deepEqual(difficulties.slice(1), ["Easy", "Medium", "Hard"], "only the existing difficulties");
});

test("Admin Content Management is unchanged: every module, Admin links, Trash loaded, no Teacher filters", async () => {
  const m = mountList();
  m.render(); await tick(); m.render();
  assert.deepEqual(m.titles(), ["My Easy Draft", "My Hard Story", "Someone Else"]);
  const tree = m.render();
  const hrefs = findAll(tree, (n) => n.type === "a").map((n) => n.props.to);
  assert.equal(findAll(tree, (n) => n.props?.actions)[0].props.actions.props.to, "/m3/admin/modules/new");
  assert.ok(hrefs.includes("/m3/admin/modules/mine-draft/edit"));
  assert.deepEqual(m.calls, ["trash"]);
  assert.equal(findAll(tree, (n) => n.props?.actions)[0].props.title, "Content Management");
  assert.equal(m.select("Difficulty"), undefined);
  assert.equal(m.select("Reading level"), undefined);
});

test("Teacher routes live inside the approved-Teacher route group and reuse the Admin editor", () => {
  const app = read("App.tsx");
  const teacherBlock = app.slice(app.indexOf('<Route element={<RequireRole allowedRoles={["teacher"]} />}>'), app.indexOf('path="materials"', app.indexOf('allowedRoles={["teacher"]}')));
  for (const route of [
    'path="content"\n              element={<Module3Page workspace="teacher" />}',
    'path="content/new"\n              element={<ModuleFormPage mode="create" workspace="teacher" />}',
    'path="content/:moduleId"\n              element={<ModuleFormPage mode="detail" workspace="teacher" />}',
    'path="content/:moduleId/edit"\n              element={<ModuleFormPage mode="edit" workspace="teacher" />}',
  ]) assert.ok(teacherBlock.includes(route), route);
  assert.match(read("modules/module3/pages/ModuleFormPage.tsx"), /<AdminCollectionEditor mode=\{mode\} workspace=\{workspace\} \/>/);
  assert.match(read("modules/module3/components/M3Layout.tsx"), /label: "My Reading Modules", to: "\/m3\/teacher\/content"/);
  // Admin routes untouched.
  assert.match(app, /<Route index element=\{<Module3Page \/>\} \/>/);
  assert.match(app, /path="modules\/new"\n\s+element=\{<ModuleFormPage mode="create" \/>\}/);
});

function mountEditor(workspace: "admin" | "teacher", mode: "create" | "detail") {
  const runtime = createHookRuntime(require("react"));
  const revisionCalls: string[] = [];
  const editor = loadComponentModule(editorUrl, (id) => {
    if (id === "react") return runtime.react;
    if (id === "react-router-dom") return { Link: "a", useParams: () => (mode === "detail" ? { moduleId: "m1" } : {}), useNavigate: () => () => {}, useLocation: () => ({ pathname: "/x", state: null }) };
    if (id.endsWith("/M3ContentContext")) return { useM3Content: () => ({ learningPaths: [], learningPathsLoading: false, learningPathsError: null, refreshModules: async () => {}, publishModule: async () => ({ ok: true }) }) };
    if (id.endsWith("/adminModuleExtraction")) return { ADMIN_MODULE_FILE_ACCEPT: ".pdf", extractAdminModulePassage: async () => ({}) };
    if (id.endsWith("/adminCollectionService")) {
      return { collectionError: (e: Error) => e.message, getPassageBankSizes: async () => [6], getModuleRevisions: async () => { revisionCalls.push("revisions"); return []; },
        loadCollection: async () => ({ id: "m1", title: "T", learningPathId: "", difficulty: "Easy", passages: [], revision: 1, status: "published", publishedAt: "2026-11-09", language: "en" }),
        passageRepository: { createDraft: async () => {}, getPublishIssues: async () => [] } };
    }
    if (id.endsWith("/auth/useAuth")) return { useAuth: () => ({ user: { id: "t1" } }) };
    if (id.endsWith("/ReadFlowDialog")) return { confirmReadFlow: async () => true };
    if (id.endsWith(".css")) return {};
    if (id.startsWith("./")) return { default: function Stub() { return null; } };
    if (id.startsWith("../utils/")) return require(new URL(`../src/modules/module3/utils/${id.slice(9).replace(/\.ts$/, "")}.ts`, import.meta.url).pathname.replace(/^\/(\w:)/, "$1"));
    return require(id);
  }, { window: { addEventListener() {}, removeEventListener() {} }, document: { addEventListener() {}, removeEventListener() {} } });
  return { render: () => runtime.render(editor.default, { mode, workspace }), revisionCalls, editor };
}

test("the shared editor uses Teacher paths and never requests Admin-only Revisions for Teachers", async () => {
  const teacher = mountEditor("teacher", "detail");
  teacher.render(); await tick(); await tick();
  const tree = teacher.render();
  assert.equal(findAll(tree, (n) => n.props?.className === "m3-editor-back")[0].props.to, "/m3/teacher/content");
  assert.match(textOf(tree), /Teacher Workspace/);
  assert.match(textOf(tree), /Back to My Reading Modules/);
  assert.deepEqual(teacher.revisionCalls, []);
  assert.doesNotMatch(textOf(tree), /Revise Module/);

  const admin = mountEditor("admin", "detail");
  admin.render(); await tick(); await tick();
  const adminTree = admin.render();
  assert.equal(findAll(adminTree, (n) => n.props?.className === "m3-editor-back")[0].props.to, "/m3/admin");
  assert.match(textOf(adminTree), /Admin Workspace/);
  assert.deepEqual(admin.revisionCalls, ["revisions"], "Admin detail still loads Revisions");

  assert.deepEqual(teacher.editor.editorPaths("teacher").module, "/m3/teacher/content");
  assert.deepEqual(teacher.editor.editorPaths("admin").module, "/m3/admin/modules");
});
