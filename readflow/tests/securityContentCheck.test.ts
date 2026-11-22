// Pre-defense hardening: the database content check (m3_content_screen_v1) reaches authors as a clear message, and the
// upload review step shows the advisory result. No inappropriate words are used: messages carry categories only.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { loadComponentModule } from "./helpers/hookRuntime.ts";

const require = createRequire(import.meta.url);
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const moduleService = loadComponentModule(new URL("../src/modules/module3/services/moduleService.ts", import.meta.url), (id) => {
  if (id.endsWith("/supabaseClient")) return { supabase: {} };
  // Other project helpers are not needed to build the error class.
  if (id.startsWith(".")) return {};
  return require(id);
}, { Error });

const CHECK = "Content check: this reading module may not be suitable for young learners (a web link). It was first found in the passage, line 2. Please review and edit it before it is published.";

test("module create/update/publish errors show the content-check message instead of the generic text", () => {
  const error = new moduleService.ModuleServiceError("Unable to update the module. Check your access and try again.", { code: "PT422", message: CHECK });
  assert.equal(error.message, CHECK);
  const other = new moduleService.ModuleServiceError("Unable to update the module. Check your access and try again.", { code: "42501", message: "permission denied" });
  assert.equal(other.message, "Unable to update the module. Check your access and try again.");
  assert.equal(moduleService.contentCheckMessage({ code: "PT422", message: "raw text" }), null, "only the check's own message is shown");
});

test("upload review step shows the advisory content check (categories and line only) before saving", () => {
  const form = read("src/modules/module3/components/UploadMaterialForm.tsx");
  assert.match(form, /uploadedMaterial\.contentScreening\?\.flagged && \(/);
  assert.match(form, /role="note"/);
  assert.match(form, /it cannot be saved while it is flagged/);
  const types = read("src/modules/module3/services/materialUpload.ts");
  assert.match(types, /contentScreening\?: \{ checked: boolean; flagged\?: boolean; categories\?: string\[\]; firstLine\?: number \| null \} \| null;/);
});

test("module revision keeps the content-check message", () => {
  assert.match(read("src/modules/module3/services/adminCollectionService.ts"), /\(error\.code === "22023" \|\| error\.code === "PT422"\) && error\.message/);
});
