import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("System Admin sidebar keeps M3 Content Management and adds M7 Platform Analytics and Independent Learners", () => {
  const layout = read("modules/module3/components/M3Layout.tsx");
  const block = layout.slice(layout.indexOf('if (role === "system_admin")'), layout.indexOf("return [{ label: \"Dashboard\""));
  for (const [label, to] of [["Content Management", "/system-admin/content"], ["Create Module", "/system-admin/content/modules/new"],
    ["Reading Materials", "/system-admin/content/materials"], ["Upload Material", "/system-admin/content/materials/upload"],
    ["User Management", "/system-admin/users"], ["Platform Analytics", "/system-admin/analytics"], ["Independent Learners", "/system-admin/independent-learners"]]) {
    assert.ok(block.includes(`label: "${label}", to: "${to}"`), label);
  }
  // School Admin and Teacher navigation are untouched by the System Admin M7 links.
  assert.equal(layout.match(/\/system-admin\/analytics/g)?.length, 1);
});

test("System Admin M7 routes live only under /system-admin and use the System Admin-only API", () => {
  const app = read("App.tsx");
  const systemAdmin = app.slice(app.indexOf('<Route path="/system-admin"'), app.indexOf('</Route>', app.indexOf('<Route path="/system-admin"')));
  assert.match(systemAdmin, /<Route path="analytics" element=\{<SystemAdminOverviewPage \/>\} \/>/);
  assert.match(systemAdmin, /<Route path="independent-learners" element=\{<SystemAdminLearnerPerformancePage \/>\} \/>/);
  assert.equal(app.match(/SystemAdminOverviewPage \/>/g)?.length, 1, "not mounted for any other role");
  const page = read("modules/module7/SystemAdminAnalyticsPage.tsx");
  assert.deepEqual([...page.matchAll(/'(\/system-admin\/[^'`]*)/g)].map(m => m[1]), ["/system-admin/overview", "/system-admin/suggestions", "/system-admin/independent-learners"]);
  assert.match(page, /`\/system-admin\/independent-learners\/\$\{encodeURIComponent\(selected\)\}`/);
  assert.doesNotMatch(page, /profile\.role|useAuth|role ===/, "no client-side role decisions: the server authorizes");
});
