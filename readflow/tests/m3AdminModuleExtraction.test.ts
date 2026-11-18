import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(relativePath: string) {
  return readFile(new URL(relativePath, import.meta.url), "utf8");
}

test("Admin extraction is a dedicated authenticated endpoint and never finalizes a material", async () => {
  const client = await source("../src/modules/module3/services/adminModuleExtraction.ts");
  const route = await source("../../server/routes/adminModuleExtraction.js");
  const uploadBoundary = await source("../../server/services/materialFileUpload.js");

  assert.match(client, /\/api\/admin\/modules\/extract/);
  assert.match(client, /getMaterialAuthHeaders/);
  assert.ok(route.includes('!["admin", "system_admin"].includes(profile?.role) && !approvedTeacher'));
  assert.match(route, /validateMaterialFileSignature/);
  assert.match(route, /extractReadingMaterial/);
  assert.match(route, /removeUploadedMaterialFile/);
  assert.doesNotMatch(route, /uploaded_materials|registerTemporaryMaterial|createModule|\.insert\(/);
  assert.match(uploadBoundary, /MAX_MATERIAL_FILE_SIZE/);
  assert.match(uploadBoundary, /validateMaterialFile/);
});

test("Student and Independent Learner presentation exposes only published modules", async () => {
  const studentState = await source("../src/modules/module3/state/studentModuleState.ts");
  const learnerCatalog = await source("../src/modules/module3/pages/ModuleCatalogPage.tsx");
  const learnerDetail = await source("../src/modules/module3/pages/ModuleDetailPage.tsx");

  assert.match(studentState, /module\.status === "published"/);
  assert.match(learnerCatalog, /module\.status === "published"/);
  assert.match(learnerDetail, /role !== "admin" && module\.status !== "published"/);
  assert.match(learnerDetail, /role === "general_user"[\s\S]*Start Read-Aloud/);
});

test("legacy M3 policy remains published-only while M5 enforces classroom assignment", async () => {
  const migration = await source("../../supabase/m3_student_published_module_access.sql");
  const oralReading = await source("../../server/services/oralReadingAttemptService.js");

  assert.match(migration, /module_row\.status = 'published'/);
  assert.match(migration, /\('teacher', 'student', 'general_user'\)/);
  const authorizationBody = migration.match(/as \$\$([\s\S]*?)\$\$;/)?.[1] ?? "";
  assert.doesNotMatch(authorizationBody, /enrollments|room_modules/);
  assert.match(oralReading, /moduleRow\.status !== "published"/);
  assert.match(oralReading, /This module must be assigned in a classroom where you are enrolled/);
  assert.match(oralReading, /\.in\("room_id", rooms\)/);
  assert.doesNotMatch(oralReading, /studentCanAccessModule/);
});
