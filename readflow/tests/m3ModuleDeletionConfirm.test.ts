import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { moduleDeletionMessage } from "../src/modules/module3/utils/moduleDeletionMessage.ts";

test("delete confirmation explains permanent deletion and hiding for a never-published draft", () => {
  const message = moduleDeletionMessage({ title: "Module 1", status: "draft", publishedAt: undefined });
  assert.match(message, /^Delete "Module 1"\?/);
  assert.match(message, /never been published/);
  assert.match(message, /permanently deleted\. This cannot be undone\./);
  assert.match(message, /hidden from active catalogs instead.*reading history and results are kept/s);
});

test("delete confirmation warns that published modules may have protected records", () => {
  for (const module of [
    { title: "Forest", status: "published" as const, publishedAt: "2026-10-01" },
    { title: "Old draft", status: "draft" as const, publishedAt: "2026-09-01" },
    { title: "River", status: "archived" as const, publishedAt: undefined },
  ]) {
    const message = moduleDeletionMessage(module);
    assert.match(message, /has been published, so rooms or learners may have records/);
    assert.doesNotMatch(message, /never been published/);
  }
});

test("Content Management asks for confirmation before calling the delete RPC", async () => {
  const page = await readFile(new URL("../src/modules/module3/pages/Module3Page.tsx", import.meta.url), "utf8");
  const confirmAt = page.indexOf("confirmReadFlow(moduleDeletionMessage(target))");
  const deleteAt = page.indexOf('action === "delete" ? deleteModule(moduleId)');
  assert.ok(confirmAt > 0 && deleteAt > confirmAt, "confirmation must come before deleteModule");
  // Cancelling returns before the pending flag is taken, so Archive/Restore stay usable.
  assert.match(page, /!\(await confirmReadFlow\(moduleDeletionMessage\(target\)\)\)\)\) return;/);
});
