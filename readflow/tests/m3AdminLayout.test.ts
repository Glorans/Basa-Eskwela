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
  // Wide content (for example admin tables) scrolls sideways inside main content
  // instead of being clipped, and the page stack may shrink below its content width.
  const adminContent = /\.m3-shell--admin \.m3-content \{([^}]*)\}/.exec(styles)?.[1] ?? "";
  assert.match(adminContent, /min-height: 0;[\s\S]*overflow-x: auto;[\s\S]*overflow-y: auto;/);
  assert.doesNotMatch(adminContent, /overflow-x: hidden/);
  assert.match(styles, /\.m3-page-stack \{[^}]*min-width: 0;/);
});

test("published-module helper omits the redundant Admin-only explanation", async () => {
  const catalog = await readFile(
    new URL("../src/modules/module3/pages/ModuleCatalogPage.tsx", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(catalog, /Module creation and publishing remain Admin-only\./);
  assert.match(catalog, /description="Browse published Basa Eskwela modules\."/);
});
