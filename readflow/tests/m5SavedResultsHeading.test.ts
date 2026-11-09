import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// First-time readers have no saved results: the "Your Saved Oral Reading Results" heading
// (Filipino: "Iyong mga Naka-save na Resulta sa Pagbasa nang Malakas") and its empty box are
// not shown until a result exists. A history load error is still shown.

const page = readFileSync(new URL("../src/pages/reading-activity/ReadAloudPage.tsx", import.meta.url), "utf8");

test("the saved-results section renders only with saved results or a load error", () => {
  const section = page.indexOf('<section className="read-aloud-saved-results"');
  assert.ok(section > 0);
  const guard = page.lastIndexOf("{(savedAttempts.length > 0 || historyError) && (", section);
  assert.ok(guard > 0 && section - guard < 400, "the section is wrapped in the saved-results guard");
  assert.match(page, /\{savedAttempts\.length > 0 && \(\s*<div className="read-aloud-saved-grid">/);
  assert.match(page, /t\("Your Saved Oral Reading Results"\)/, "the same translated heading is used");
});
