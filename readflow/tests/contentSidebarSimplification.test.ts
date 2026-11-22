import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { loadComponentModule, findAll } from "./helpers/hookRuntime.ts";

// Sidebar simplification: Create Module and Upload Material are reached from the buttons on Content Management /
// Reading Materials, so the System Admin, School Admin and Teacher sidebars no longer repeat them. Their routes are
// unchanged, and the parent entry stays highlighted on those pages. The Independent Learner sidebar is unchanged.
const require = createRequire(import.meta.url);
const read = (name: string) => readFileSync(new URL(`../src/${name}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const layoutUrl = new URL("../src/modules/module3/components/M3Layout.tsx", import.meta.url);

function sidebar(role: string, pathname = "/") {
  const shell = { mobile: false, drawerOpen: false, collapsed: false, close() {}, toggle() {}, sidebarRef: { current: null }, workspaceRef: { current: null },
    triggerRef: { current: null }, closeRef: { current: null }, expanded: true, toggleLabel: "Collapse sidebar", shellClasses: "rf-shell" };
  const module = loadComponentModule(layoutUrl, (id: string) => {
    if (id.endsWith(".css")) return {};
    if (id.endsWith("useResponsiveSidebar")) return { default: () => shell };
    if (id === "react-router-dom") return { Link: "Link", NavLink: "NavLink", Outlet: "Outlet", useLocation: () => ({ pathname }) };
    if (id === "lucide-react") return new Proxy({}, { get: (_t, key) => String(key) });
    if (id.endsWith("mascot.png")) return { default: "mascot.png" };
    if (id.endsWith("/AssessmentNavigation")) return { default: "AssessmentNavigation" };
    if (id.endsWith("ProfileDropdown")) return { default: "ProfileDropdown" };
    if (id.endsWith("SidebarLogout")) return { default: "SidebarLogout" };
    if (id.endsWith("authOnboarding")) return require(new URL("../src/modules/module1/utils/authOnboarding.ts", import.meta.url).pathname.replace(/^\/(\w:)/, "$1"));
    if (id.endsWith("workspaceRoot")) return { getM3WorkspaceRoot: (r: string) => r === "admin" ? "/m3/admin" : r === "teacher" ? "/m3/teacher" : "/m3/general" };
    return require(id);
  });
  const links = findAll(module.default({ role }), (n: any) => n.type === "NavLink");
  return {
    labels: links.map((n: any) => n.props["aria-label"]),
    // What the sidebar highlights when the router itself reports no exact match for this link.
    highlighted: links.filter((n: any) => n.props.className({ isActive: false }).includes("m3-nav-item--active")).map((n: any) => n.props["aria-label"]),
  };
}

test("System Admin, School Admin and Teacher sidebars no longer list Create Module or Upload Material", () => {
  for (const role of ["system_admin", "admin", "teacher"]) {
    const { labels } = sidebar(role);
    assert.ok(!labels.includes("Create Module"), `${role}: Create Module`);
    assert.ok(!labels.includes("Upload Material"), `${role}: Upload Material`);
  }
  assert.ok(sidebar("system_admin").labels.includes("Content Management") && sidebar("system_admin").labels.includes("Reading Materials"));
  assert.ok(sidebar("admin").labels.includes("Content Management"), "School Admin has no Reading Materials item and none is added");
  assert.ok(!sidebar("admin").labels.includes("Reading Materials"));
  assert.ok(sidebar("teacher").labels.includes("My Reading Modules") && sidebar("teacher").labels.includes("Reading Materials"));
});

test("unrelated items stay (Dashboard, practice, users, schools, Learning Rooms...)", () => {
  assert.deepEqual(sidebar("system_admin").labels, ["Dashboard", "Content Management", "Reading Materials", "Reading Practice", "Practice History",
    "User Management", "Schools", "Platform Analytics", "Independent Learners"]);
  for (const label of ["Dashboard", "System Performance", "User Management", "Teacher Invitations", "Learning Rooms", "Diagnostic Results"]) assert.ok(sidebar("admin").labels.includes(label), label);
  for (const label of ["Dashboard", "Reading Modules", "Learning Rooms", "Reading Results", "Reading Practice", "Student Support", "Analytics", "Reports"]) assert.ok(sidebar("teacher").labels.includes(label), label);
});

test("Independent Learner sidebar is unchanged (keeps Upload Material)", () => {
  const { labels } = sidebar("general_user");
  assert.deepEqual(labels.slice(0, 4), ["Dashboard", "Reading Modules", "Reading Materials", "Upload Material"]);
});

test("the parent entry stays highlighted on the create and upload pages (and only there)", () => {
  assert.deepEqual(sidebar("system_admin", "/system-admin/content/modules/new").highlighted, ["Content Management"]);
  assert.deepEqual(sidebar("system_admin", "/system-admin/content/materials/upload").highlighted, ["Reading Materials"]);
  assert.deepEqual(sidebar("admin", "/m3/admin/modules/new").highlighted, ["Content Management"]);
  assert.deepEqual(sidebar("teacher", "/m3/teacher/content/new").highlighted, ["My Reading Modules"]);
  assert.deepEqual(sidebar("teacher", "/m3/teacher/materials/upload").highlighted, ["Reading Materials"]);
  assert.deepEqual(sidebar("system_admin", "/system-admin/users").highlighted, [], "no extra highlight elsewhere");
  assert.deepEqual(sidebar("general_user", "/m3/general/materials/upload").highlighted, [], "Independent Learner keeps exact-match highlighting");
});

test("routes and in-page buttons are unchanged", () => {
  const app = read("App.tsx");
  assert.match(app, /<Route path="content\/modules\/new" element=\{<ModuleFormPage mode="create" workspace="system_admin" \/>\} \/>/);
  assert.match(app, /<Route path="content\/materials\/upload" element=\{<UploadMaterialPage role="system_admin" \/>\} \/>/);
  assert.match(app, /path="modules\/new"/);
  assert.match(app, /path="content\/new"\s*element=\{<ModuleFormPage mode="create" workspace="teacher" \/>\}/);
  assert.equal(app.match(/path="materials\/upload"/g)?.length, 2, "Teacher and Independent Learner upload routes");
  assert.match(read("modules/module3/pages/Module3Page.tsx"), /to=\{`\$\{paths\.module\}\/new`\}><PlusCircle[^>]*\/> Create Module<\/Link>/);
  assert.match(read("modules/module3/pages/MaterialLibraryPage.tsx"), /to=\{`\$\{root\}\/materials\/upload`\}>/);
});
