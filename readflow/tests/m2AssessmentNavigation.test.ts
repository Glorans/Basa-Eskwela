import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { createHookRuntime, loadComponentModule, findAll, textOf, tick } from "./helpers/hookRuntime.ts";
const require = createRequire(import.meta.url);
const source = (name: string) => new URL(`../src/modules/module2/${name}`, import.meta.url);

test("Assessment submenu toggles, highlights a legacy detail URL, and retains distinct destinations", async () => {
  const runtime = createHookRuntime(require("react"));
  let pathname = "/system-admin/assessment-packages/package-1";
  let category = "initial";
  const mod = loadComponentModule(source("components/AssessmentNavigation.tsx"), id => {
    if (id === "react") return runtime.react;
    if (id.endsWith(".css")) return {};
    if (id === "lucide-react") return { ClipboardList: "Icon", ChevronDown: "Icon" };
    if (id === "react-router-dom") return { Link: "Link", useLocation: () => ({ pathname }) };
    if (id.endsWith("/services/assessmentPackages")) return { getAssessmentPackage: async () => ({ package: { category } }) };
    return require(id);
  });
  const render = () => runtime.render(mod.default, { onNavigate() {}, onExpand() {} });
  render(); await tick(); let tree = render();
  assert.equal(findAll(tree, n => n.type === "Link" && n.props["aria-current"] === "page")[0].props.to, "/system-admin/assessment/initial");
  findAll(tree, n => n.type === "button")[0].props.onClick(); tree = render();
  assert.equal(findAll(tree, n => n.props.id === "m2-assessment-submenu")[0].props.hidden, true);
  category = "independent"; pathname = "/system-admin/assessment-packages/package-2";
  render(); await tick(); tree = render();
  assert.equal(findAll(tree, n => n.type === "Link" && n.props["aria-current"] === "page")[0].props.to, "/system-admin/assessment/reassessment");
  assert.equal(findAll(tree, n => n.type === "button")[0].props["aria-expanded"], true);
});

test("dedicated lists separate assessment types and filter language without changing records", async () => {
  for (const section of ["initial", "independent"]) {
    const runtime = createHookRuntime(require("react"));
    let dirty = false;
    const packages = [
      { id: "initial-en", category: "initial", language: "en", title: "Initial English" },
      { id: "initial-fil", category: "initial", language: "fil", title: "Initial Filipino" },
      { id: "reassessment-en", category: "independent", language: "en", title: "Central English" },
    ];
    const mod = loadComponentModule(source("pages/AssessmentPackagesPage.tsx"), id => {
    if (id.endsWith("/utils/initialDiagnosticLabels")) return require(new URL("../src/modules/module2/utils/initialDiagnosticLabels.ts", import.meta.url).pathname.replace(/^\/(\w:)/, "$1"));
      if (id === "react") return runtime.react;
      if (id.endsWith(".css")) return {};
      if (id === "react-router-dom") return { Link: "Link", useNavigate: () => () => {} };
      if (id.endsWith("/hooks/useAssessmentLeaveGuard")) return { useAssessmentLeaveGuard: (value: boolean) => { dirty = value; } };
      if (id.endsWith("/services/assessmentPackages")) return {
        CATEGORY_LABELS: { initial: "Initial Diagnostic", independent: "Reassessment" }, LANGUAGE_LABELS: { en: "English", fil: "Filipino" }, STATUS_LABELS: {},
        listAssessmentPackages: async () => ({ packages, capabilities: { create: ["independent"], importInitial: [] } }),
      };
      return require(id);
    });
    const render = () => runtime.render(mod.default, { role: "system_admin", section });
    render(); await tick(); let tree = render();
    const table = findAll(tree, n => typeof n.type === "function" && n.type.name === "PackageTable")[0];
    assert.ok(table.props.packages.every((p: any) => p.category === section));
    findAll(tree, n => n.props["aria-label"] === "Filter by language")[0].props.onChange({ target: { value: "fil" } });
    tree = render();
    const filtered = findAll(tree, n => typeof n.type === "function" && n.type.name === "PackageTable");
    if (section === "initial") assert.deepEqual(filtered[0].props.packages.map((p: any) => p.id), ["initial-fil"]);
    else {
      assert.equal(filtered.length, 0);
      findAll(tree, n => n.type === "button" && textOf(n) === "Create Package")[0].props.onClick(); tree = render();
      findAll(tree, n => n.type === "input")[0].props.onChange({ target: { value: "Unsaved title" } }); render();
      assert.equal(dirty, true);
    }
    assert.equal(findAll(tree, n => n.type === "Link" && textOf(n).includes("Back to Assessment"))[0].props.to, "/system-admin/assessment-packages");
  }
});

test("practice return destination is retained only for the signed-in staff role's package route", () => {
  for (const [role, path, expected] of [
    ["system_admin", "/system-admin/assessment-packages/p1", "/system-admin/assessment-packages/p1"],
    ["teacher", "/m3/teacher/assessment-packages/p2", "/m3/teacher/assessment-packages/p2"],
    ["admin", "/admin/assessment-packages/p3", "/admin/assessment-packages/p3"],
    ["teacher", "/system-admin/assessment-packages/p1", "/home"],
    ["system_admin", "https://example.com", "/home"],
  ]) {
    const mod = loadComponentModule(source("utils/practiceMode.ts"), id => {
      if (id === "react-router-dom") return { useLocation: () => ({ state: { practiceExitTo: path } }) };
      if (id.endsWith("/auth/useAuth")) return { useAuth: () => ({ profile: { role } }) };
      if (id.endsWith("/utils/authOnboarding")) return { isAppRole: () => true, getRoleHomePath: () => "/home" };
      return require(id);
    });
    assert.equal(mod.usePracticeOptions().exitTo, expected);
  }
});


test("unsaved edits block navigation until discard is confirmed and register reload protection", async () => {
  const runtime = createHookRuntime(require("react"));
  let allow = false;
  const visits: string[] = [];
  const navigator = { push: (path: string) => visits.push(path), replace: (path: string) => visits.push(path) };
  const listeners = new Map();
  const mod = loadComponentModule(source("hooks/useAssessmentLeaveGuard.ts"), id => {
    if (id === "react") return { ...runtime.react, useContext: () => ({ navigator }) };
    if (id === "react-router-dom") return { UNSAFE_NavigationContext: {} };
    if (id.endsWith("/components/ReadFlowDialog")) return { confirmReadFlow: async () => allow };
    return require(id);
  }, { window: { history: { state: { idx: 1 } },
    addEventListener: (name: string, fn: unknown) => listeners.set(name, fn),
    removeEventListener: (name: string) => listeners.delete(name) } });
  const Guard = ({ dirty }: { dirty: boolean }) => { mod.useAssessmentLeaveGuard(dirty); return null; };
  runtime.render(Guard, { dirty: true });
  navigator.push("/system-admin/assessment/reassessment"); await tick();
  assert.equal(visits.length, 0);
  assert.ok(listeners.has("beforeunload"));
  allow = true; navigator.push("/system-admin/assessment/initial"); await tick();
  assert.deepEqual(visits, ["/system-admin/assessment/initial"]);
  runtime.render(Guard, { dirty: false });
  assert.equal(listeners.size, 0);
  navigator.replace("/system-admin/assessment-packages");
  assert.equal(visits.length, 2);
});
