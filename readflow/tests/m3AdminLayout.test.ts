import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Admin M3 keeps the viewport shell fixed and scrolls only main content", async () => {
  const styles = await readFile(
    new URL("../src/modules/module3/styles/module3.css", import.meta.url),
    "utf8",
  );

  assert.match(
    styles,
    /\.m3-shell--admin,[\s\S]*height: 100dvh;[\s\S]*min-height: 0;/,
  );
  assert.match(
    styles,
    /\.m3-shell--admin \.m3-sidebar,[\s\S]*height: 100dvh;/,
  );
  assert.match(
    styles,
    /\.m3-shell--admin \.m3-workspace,[\s\S]*height: 100dvh;[\s\S]*overflow: hidden;/,
  );
  assert.match(
    styles,
    /\.m3-shell--admin \.m3-content \{[\s\S]*min-height: 0;[\s\S]*overflow-x: hidden;[\s\S]*overflow-y: auto;/,
  );
});

test("published-module helper omits the redundant Admin-only explanation", async () => {
  const catalog = await readFile(
    new URL("../src/modules/module3/pages/ModuleCatalogPage.tsx", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(catalog, /Module creation and publishing remain Admin-only\./);
  assert.match(catalog, /description="Browse published Basa Eskwela modules\."/);
});
