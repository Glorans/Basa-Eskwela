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

type TrashRow = { id: string; title: string; statusBefore: string; trashedAt: string; trashedByName: string; everPublished: boolean; hasHistory: boolean };
function mountList(workspace?: "admin" | "teacher" | "system_admin", options: { trash?: TrashRow[] | null; restored?: string; modules?: typeof MODULES } = {}) {
  const runtime = createHookRuntime(require("react"));
  const calls: string[] = [];
  const page = loadComponentModule(pageUrl, (id) => {
    if (id === "react") return runtime.react;
    if (id === "lucide-react") return new Proxy({}, { get: () => "svg" });
    if (id === "react-router-dom") return { Link: "a" };
    if (id.endsWith("/M3ContentContext")) {
      return { useM3Content: () => ({ modules: options.modules ?? MODULES, modulesLoading: false, modulesError: null, refreshModules: async () => {},
        feedback: null, clearFeedback: () => {}, deleteModule: async (id: string) => { calls.push(`delete:${id}`); return { ok: true }; }, archiveModule: async () => ({ ok: true }),
        restoreModule: async () => ({ ok: true }) }) };
    }
    if (id.endsWith("/auth/useAuth")) return { useAuth: () => ({ user: { id: "t1" } }) };
    if (id.endsWith("/services/moduleService")) {
      return { getTrashedModules: async () => { calls.push("trash"); return options.trash === undefined ? [] : options.trash; },
        purgeTrashedModule: async (id: string) => { calls.push(`purge:${id}`); },
        restoreTrashedModule: async (id: string) => { calls.push(`restore:${id}`); return options.restored ?? "draft"; },
        trashModule: async (id: string) => { calls.push(`trashModule:${id}`); return "trashed"; },
        republishModule: async (id: string) => { calls.push(`republish:${id}`); return "published"; } };
    }
    if (id.endsWith("/components/AdminCollectionEditor")) {
      return { editorPaths: (w: string) => w === "system_admin" ? { list: "/system-admin/content", module: "/system-admin/content/modules" } : w === "teacher"
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
  assert.deepEqual(m.calls, ["trash"], "Teachers load their own Trash (the database returns only their modules)");
  const buttons = findAll(m.render(), (node) => node.type === "button").map((node) => node.props["aria-label"] ?? textOf(node));
  assert.ok(buttons.every((label: string) => !/^(Archive|Restore)/.test(label)), "no Archive/Restore actions for Teachers' live modules");
  assert.equal(findAll(m.render(), (node) => node.props?.className === "m3-panel m3-trash").length, 1, "Teacher Trash section");
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
  // A Windows checkout (core.autocrlf) writes CRLF; the route snippets below use LF.
  const app = read("App.tsx").replace(/\r\n/g, "\n");
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

function mountEditor(workspace: "admin" | "teacher" | "system_admin", mode: "create" | "detail") {
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

test("Teachers can find module authoring from every usual entry point, like the School Admin", () => {
  // Root cause of "Teachers cannot create modules": the feature existed but was reachable only through
  // "My Reading Modules". These are the same entry points the School Admin has.
  const layout = read("modules/module3/components/M3Layout.tsx");
  // Sidebar simplification (2026-11-22): Create Module is the button on My Reading Modules / Content Management, which
  // stays highlighted on the create page; the sidebar no longer repeats it.
  assert.match(layout, /\{ label: "My Reading Modules", to: "\/m3\/teacher\/content", icon: FilePlus2, end: true, alsoActive: \["\/m3\/teacher\/content\/new"\] \}/);
  assert.match(layout, /\{ label: "Content Management", to: "\/m3\/admin", icon: Files, end: true, alsoActive: \["\/m3\/admin\/modules\/new"\] \}/);
  assert.doesNotMatch(layout, /label: "Create Module"/);
  assert.match(read("modules/module3/pages/Module3Page.tsx"), /to=\{`\$\{paths\.module\}\/new`\}><PlusCircle[^>]*\/> Create Module<\/Link>/, "the page button remains");

  const dashboard = read("pages/dashboard/TeacherDashboard.tsx");
  assert.match(dashboard, /\{ label: "Create Reading Module", to: "\/m3\/teacher\/content\/new", icon: PlusCircle \}/);
  assert.match(dashboard, /\{ label: "My Reading Modules", to: "\/m3\/teacher\/content", icon: BookOpenCheck, secondary: true \}/);

  const catalog = read("modules/module3/pages/ModuleCatalogPage.tsx");
  assert.match(catalog, /actions=\{role === "teacher" \? <>/, "Create is offered to Teachers only, not Independent Learners");
  assert.match(catalog, /className="m3-button m3-button--coral" to="\/m3\/teacher\/content\/new"><PlusCircle[^>]*\/> Create Module<\/Link>/,
    "same coral Create Module button as the School Admin page");
});

const TRASHED: TrashRow[] = [
  { id: "gone-draft", title: "Gone Draft", statusBefore: "draft", trashedAt: "2026-11-17T01:00:00Z", trashedByName: "Tess Teacher", everPublished: false, hasHistory: false },
  { id: "gone-pub", title: "Gone Story", statusBefore: "published", trashedAt: "2026-11-17T02:00:00Z", trashedByName: "Tess Teacher", everPublished: true, hasHistory: true },
];
const settle = async (m: ReturnType<typeof mountList>) => { for (let i = 0; i < 6; i++) { await tick(); m.render(); } };
const labels = (m: ReturnType<typeof mountList>) => findAll(m.render(), (n) => n.type === "button").map((n) => n.props["aria-label"] ?? textOf(n));

test("Teacher Trash: own trashed modules can be restored, never deleted permanently", async () => {
  const m = mountList("teacher", { trash: TRASHED, restored: "archived" });
  await settle(m);
  const trash = findAll(m.render(), (n) => n.props?.className === "m3-panel m3-trash")[0];
  assert.ok(trash, "Trash section shown on My Reading Modules");
  assert.match(textOf(trash), /Modules you deleted stay here/);
  assert.match(textOf(trash), /until you choose Publish Again/);
  assert.doesNotMatch(textOf(trash), / by Tess Teacher/, "no 'deleted by' name for the Teacher's own Trash");
  assert.ok(labels(m).includes("Restore Gone Draft from the Trash") && labels(m).includes("Restore Gone Story from the Trash"));
  assert.ok(!labels(m).some((l: string) => /permanently/i.test(l)), "no permanent deletion for Teachers");
  const restore = findAll(m.render(), (n) => n.type === "button" && n.props["aria-label"] === "Restore Gone Story from the Trash")[0];
  restore.props.onClick();
  await settle(m);
  assert.ok(m.calls.includes("restore:gone-pub"));
  assert.match(m.text(), /Gone Story was restored as archived\. It stays hidden from learners until you choose Publish Again on the module\./);
  assert.ok(!m.calls.some((c) => c.startsWith("purge:")));
});

test("Teacher Delete moves the module to the Trash (no hard delete) once the Trash is installed", async () => {
  const m = mountList("teacher", { trash: [] });
  await settle(m);
  findAll(m.render(), (n) => n.type === "button" && n.props["aria-label"] === "Delete My Hard Story")[0].props.onClick();
  await settle(m);
  assert.ok(m.calls.includes("trashModule:mine-pub"), "uses m3_trash_module");
  assert.ok(!m.calls.some((c) => c.startsWith("delete:")), "never the hard-delete path");
  assert.match(m.text(), /My Hard Story was moved to the Trash\./);
});

test("Before the migration (Teacher Trash unavailable) the existing Delete is kept and no Trash is shown", async () => {
  const m = mountList("teacher", { trash: null });
  await settle(m);
  assert.equal(findAll(m.render(), (n) => n.props?.className === "m3-panel m3-trash").length, 0);
  findAll(m.render(), (n) => n.type === "button" && n.props["aria-label"] === "Delete My Easy Draft")[0].props.onClick();
  await settle(m);
  assert.ok(m.calls.includes("delete:mine-draft"));
});

test("Admin Trash unchanged: Restore and Delete Permanently, with the remover's name", async () => {
  const m = mountList(undefined, { trash: TRASHED });
  await settle(m);
  const trash = findAll(m.render(), (n) => n.props?.className === "m3-panel m3-trash")[0];
  assert.match(textOf(trash), / by Tess Teacher/);
  assert.ok(labels(m).includes("Delete Gone Draft permanently"), "Admin keeps permanent deletion for modules without history");
  assert.ok(!labels(m).includes("Delete Gone Story permanently"), "never for modules with history");
});

test("Teacher confirmation describes the Teacher's own Publish Again", async () => {
  const { moduleTrashMessage } = await import("../src/modules/module3/utils/moduleDeletionMessage.ts");
  const published = { title: "Story", status: "published" as const, publishedAt: "2026-11-01T00:00:00Z" };
  assert.match(moduleTrashMessage(published, "teacher"), /comes back archived \(hidden from learners\) until you choose Publish Again/);
  assert.match(moduleTrashMessage(published), /must be published again before learners see it/, "Admin wording unchanged");
  assert.match(moduleTrashMessage({ title: "D", status: "draft" as const, publishedAt: undefined }, "teacher"), /restore it from the Trash as a draft/);
});

const ARCHIVED = [...MODULES, { ...MODULES[1], id: "mine-arch", title: "My Restored Story", status: "archived" as const }];

test("Teacher Publish Again: explicit button on own archived modules, confirmed, then the validated database call", async () => {
  const m = mountList("teacher", { trash: [], modules: ARCHIVED });
  await settle(m);
  assert.ok(labels(m).includes("Publish My Restored Story again"));
  assert.ok(!labels(m).some((l: string) => /^Publish (My Easy Draft|My Hard Story) again$/.test(l)), "only archived modules offer it");
  assert.ok(!m.calls.some((c) => c.startsWith("republish:")), "nothing is republished automatically");
  findAll(m.render(), (n) => n.type === "button" && n.props["aria-label"] === "Publish My Restored Story again")[0].props.onClick();
  await settle(m);
  assert.deepEqual(m.calls.filter((c) => c.startsWith("republish:")), ["republish:mine-arch"]);
  assert.match(m.text(), /My Restored Story was published again\./);
});

test("Publish Again is hidden until the Teacher Trash is installed, and never shown to the School Admin", async () => {
  const before = mountList("teacher", { trash: null, modules: ARCHIVED });
  await settle(before);
  assert.ok(!labels(before).some((l: string) => /again$/.test(l)));
  const admin = mountList(undefined, { trash: [], modules: ARCHIVED });
  await settle(admin);
  assert.ok(!labels(admin).some((l: string) => /Publish .* again$/.test(l)), "Admins keep their existing Restore");
  assert.ok(labels(admin).includes("Restore My Restored Story"));
});

test("Publish Again confirmation explains learners will see it and that it is validated again", async () => {
  const { moduleRepublishMessage } = await import("../src/modules/module3/utils/moduleDeletionMessage.ts");
  const text = moduleRepublishMessage({ title: "Story" });
  assert.match(text, /^Publish "Story" again\?/);
  assert.match(text, /checked again before it is published/);
});


test("System Admin reuses the module list: create/view/edit links, difficulty organization and Trash deletion", async () => {
  const m = mountList("system_admin");
  await settle(m);
  assert.deepEqual(m.titles(), ["My Easy Draft", "My Hard Story", "Someone Else"]);
  const tree = m.render();
  assert.equal(findAll(tree, n => n.props?.actions)[0].props.actions.props.to, "/system-admin/content/modules/new");
  const links = findAll(tree, n => n.type === "a").map(n => n.props.to);
  assert.ok(links.includes("/system-admin/content/modules/mine-draft/edit"));
  assert.ok(links.includes("/system-admin/content/modules/mine-pub"));
  findAll(m.select("Difficulty"), n => n.type === "select")[0].props.onChange({ target: { value: "Hard" } });
  assert.deepEqual(m.titles(), ["My Hard Story"]);
  findAll(m.render(), n => n.type === "button" && n.props["aria-label"] === "Delete My Hard Story")[0].props.onClick();
  await settle(m);
  assert.ok(m.calls.includes("trashModule:mine-pub"), "same history-preserving Trash action");
});

test("System Admin detail uses the existing editor and revision workflow with its own links", async () => {
  const m = mountEditor("system_admin", "detail");
  m.render(); await tick(); await tick();
  const tree = m.render();
  assert.equal(findAll(tree, n => n.props?.className === "m3-editor-back")[0].props.to, "/system-admin/content");
  // No decorative workspace label: the module title is the page's only heading.
  assert.doesNotMatch(textOf(tree), /Workspace/);
  assert.equal(findAll(tree, n => n.props?.className === "m3-eyebrow").length, 0);
  assert.deepEqual(m.revisionCalls, ["revisions"]);
});

test("System Admin routes stay in the System Admin guard and reuse all M3 screens", () => {
  const app = read("App.tsx");
  const block = app.slice(app.indexOf('<Route element={<RequireRole allowedRoles={["system_admin"]} />}>'), app.indexOf('{/* Admin (School Admin) routes */}'));
  for (const route of ["content", "content/modules/new", "content/modules/:moduleId", "content/modules/:moduleId/edit", "content/materials", "content/materials/upload", "content/materials/:materialId", "content/materials/:materialId/question-sets/:setId", "content/materials/:materialId/question-sets/:setId/edit"]) assert.ok(block.includes(`path="${route}"`), route);
  for (const component of ["Module3Page", "ModuleFormPage", "MaterialLibraryPage", "UploadMaterialPage", "MaterialDetailPage", "QuestionReviewPage"]) assert.ok(block.includes(`<${component}`));
});

test("System Admin editor: one circular Add Passage Below button per card inserts directly below that passage", async () => {
  const m = mountEditor("system_admin", "create");
  m.render(); await tick();
  const view = () => {
    const tree = m.render();
    const cards = findAll(tree, n => n.type === "section" && n.props?.className === "m3-editor-card m3-editor-passage");
    const titles = cards.map(card => findAll(card, n => n.type === "input" && n.props?.maxLength === 200)[0]);
    const adds = findAll(tree, n => n.type === "button" && n.props?.className === "sa-add-passage");
    return { tree, titles, adds };
  };
  let v = view();
  assert.equal(v.adds.length, v.titles.length, "one add button per passage card");
  assert.equal(findAll(v.tree, n => n.type === "button" && textOf(n).includes("+ Add Passage Below")).length, 0, "old rectangular button removed");
  assert.equal(v.adds[0].props["aria-label"], "Add Passage Below");
  assert.equal(textOf(v.adds[0]).trim(), "Add Passage Below", "tooltip text present for hover and focus");
  v.titles[0].props.onChange({ target: { value: "First" } });
  view().adds[0].props.onClick();
  v = view(); v.titles[1].props.onChange({ target: { value: "Second" } });
  view().adds[0].props.onClick();
  assert.deepEqual(view().titles.map((t: any) => t.props.value), ["First", "", "Second"]);
});

test("School Admin and Teacher editors keep the original Add Passage Below button", async () => {
  for (const workspace of ["admin", "teacher"] as const) {
    const m = mountEditor(workspace, "create");
    m.render(); await tick();
    const tree = m.render();
    assert.equal(findAll(tree, n => n.props?.className === "sa-add-passage").length, 0, workspace);
    assert.ok(findAll(tree, n => n.type === "button" && textOf(n).includes("+ Add Passage Below")).length >= 1, workspace);
  }
});
