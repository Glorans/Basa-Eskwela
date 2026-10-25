import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// One shared yellow scrollbar for every role, defined once in global CSS.
const read = (path: string) => readFile(new URL(`../src/${path}`, import.meta.url), "utf8");

test("scrollbar colors come from the shared theme tokens", async () => {
  const theme = await read("styles/basa-theme.css");
  assert.match(theme, /--basa-scrollbar-thumb: var\(--basa-yellow\);/);
  assert.match(theme, /--basa-scrollbar-thumb-hover: #[0-9a-f]{6};/i);
});

test("global CSS styles Chrome/Edge scrollbars and limits standard properties to Firefox", async () => {
  const css = await read("index.css");
  assert.match(css, /@import "\.\/styles\/basa-theme\.css";/);
  assert.match(css, /\*::-webkit-scrollbar-thumb \{[^}]*background-color: var\(--basa-scrollbar-thumb\);[^}]*border-radius: 999px;|\*::-webkit-scrollbar-thumb \{[^}]*border-radius: 999px;[^}]*background-color: var\(--basa-scrollbar-thumb\);/s);
  assert.match(css, /\*::-webkit-scrollbar-thumb:hover[^{]*\{[^}]*var\(--basa-scrollbar-thumb-hover\)/s);
  // Chrome 121+ ignores ::-webkit-scrollbar once scrollbar-color is set, so the standard rule is Firefox-only.
  assert.match(css, /@supports not selector\(::-webkit-scrollbar\) \{\s*\* \{\s*scrollbar-width: auto;\s*scrollbar-color: var\(--basa-scrollbar-thumb\) var\(--basa-scrollbar-track\);/);
});

test("reading panels inherit the visible global scrollbar", async () => {
  for (const path of ["pages/reading-activity/ReadAloudPage.css", "modules/module2/pages/DiagnosticReadingPage.css", "modules/module2/pages/DiagnosticQuestionsPage.css"]) {
    assert.doesNotMatch(await read(path), /scrollbar-width|scrollbar-color|::-webkit-scrollbar/);
  }
});
