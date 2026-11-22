import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { getRoleHomePath } from "../src/modules/module1/utils/authOnboarding.ts";

const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("System Admin lands on its Dashboard; User Management stays a separate page", () => {
  assert.equal(getRoleHomePath("system_admin"), "/system-admin/dashboard");
  const app = read("App.tsx");
  const start = app.indexOf('<Route element={<RequireRole allowedRoles={["system_admin"]} />}>');
  const block = app.slice(start, app.indexOf("{/* Admin (School Admin) routes */}"));
  assert.ok(start > 0, "System Admin routes stay behind RequireRole system_admin");
  assert.match(block, /<Route index element=\{<Navigate to="dashboard" replace \/>\} \/>/);
  assert.match(block, /<Route path="dashboard" element=\{<SystemAdminDashboard \/>\} \/>/);
  assert.match(block, /<Route path="users" element=\{<UserManagementPage \/>\} \/>/);
  assert.equal(app.match(/<SystemAdminDashboard \/>/g)?.length, 1, "mounted only for the System Admin");
});

test("System Admin sidebar: Dashboard first, every existing item kept", () => {
  const layout = read("modules/module3/components/M3Layout.tsx");
  const block = layout.slice(layout.indexOf('if (role === "system_admin")'), layout.indexOf("return [{ label: \"Dashboard\""));
  const labels = [...block.matchAll(/label: "([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(labels, ["Dashboard", "Content Management", "Reading Materials", "Reading Practice",
    "Practice History", "User Management", "Schools", "Platform Analytics", "Independent Learners"]);
  assert.match(block, /\{ label: "Dashboard", to: getRoleHomePath\(role\), icon: House, end: true \}/);
});

test("Dashboard uses only the existing System Admin-authorized sources and shows platform totals only", () => {
  const page = read("pages/dashboard/SystemAdminDashboard.tsx");
  assert.match(page, /m7Request<PlatformOverview>\("\/system-admin\/overview"\)/);
  assert.match(page, /useLoad\(listSchools, \[\]\)/);
  // No per-Student or per-learner record endpoints, no direct table reads, no invented numbers.
  assert.doesNotMatch(page, /independent-learners\/|admin\/students|supabase\.from|oral_reading|diagnostic/);
  assert.doesNotMatch(page, /value=\{?["']?\d/, "every card value comes from a source");
  for (const to of ["/system-admin/schools", "/system-admin/users", "/system-admin/content", "/system-admin/analytics", "/system-admin/independent-learners"]) {
    assert.ok(page.includes(`to: "${to}"`) || page.includes(`to="${to}"`), to);
  }
});
