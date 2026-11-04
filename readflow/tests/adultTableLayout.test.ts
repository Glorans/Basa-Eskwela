import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
const ADULT = ".m3-shell:not(.m3-shell--general) .m3-content";

test("compact table rules apply only to Teacher and Admin workspaces", () => {
  const shared = css("styles/responsive-layout.css");
  // Table scroll areas contain hidden column labels, so they cannot widen the page.
  assert.match(shared, new RegExp(`${ADULT.replace(/[.()]/g, "\\$&")} :where\\([^)]*m5-review-table-scroll[^)]*\\) \\{\\s*position: relative;`));
  // Headers break between words in adult tables only.
  assert.match(shared, new RegExp(`${ADULT.replace(/[.()]/g, "\\$&")} th \\{\\s*overflow-wrap: normal;\\s*word-break: normal;`));
  for (const rule of shared.match(/^[^{}\n]*\bth\b[^{}\n]*\{/gm) ?? []) assert.match(rule, /m3-shell:not\(\.m3-shell--general\)/, rule);
  const m7 = css("modules/module7/m7.css");
  assert.match(m7, /\.m3-shell:not\(\.m3-shell--general\) \.m3-content > \.m7-page \{ max-width: none; padding: 0; \}/);
  assert.match(m7, /^\.m7-page \{[^}]*max-width:1200px;[^}]*padding:clamp\(16px,3vw,32px\);/m, "the student page keeps its measure");
});

test("the Teacher Reading Results table uses sentence-case headings and full-width columns", () => {
  const teacher = css("modules/module5/pages/TeacherOralReading.css");
  assert.match(teacher, /\.m5-teacher-results \.m5-review-table th \{[^}]*letter-spacing: 0;[^}]*text-transform: none;/);
  const page = css("modules/module5/pages/TeacherOralReadingResultsPage.tsx");
  const widths = [...page.matchAll(/<col style=\{\{ width: "(\d+)%" \}\} \/>/g)].map((match) => Number(match[1]));
  assert.equal(widths.length, 8, "one width per column: no column removed");
  assert.equal(widths.reduce((total, width) => total + width, 0), 100);
  for (const heading of ["Learner", "Module", "Transcript-based Accuracy", "Recognized / Legacy Passage WPM",
    "Recognized-word Differences", "Comprehension", "Date Completed"]) assert.match(page, new RegExp(`<th>${heading.replace(/[/]/g, "\\/")}</th>`));
});

test("each M5 function card has its own pastel colour; feedback stays blue and the result yellow", () => {
  const result = css("pages/reading-activity/ReadingResultPage.css");
  assert.match(result, /\.result-panel-card--result \{\s*background: #ffe29a;/);
  assert.match(result, /\.result-panel-card--feedback \{\s*background: #b5d9ef;/);
  assert.match(result, /\.result-panel-card--transcript \{\s*background: #b9df9e;/);
  assert.match(result, /\.result-panel-card--accuracy \{\s*background: #d8cff4;/);
  assert.match(result, /\.result-panel-card--words \{\s*background: #ffd2bd;/);
  assert.doesNotMatch(result, /result-panel-card--saved/);
  assert.match(result, /\.result-panel-card--feedback \.result-panel-card-text \{\s*color: var\(--basa-navy\);/);
});
