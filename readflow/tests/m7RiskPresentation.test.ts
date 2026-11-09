import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isActiveWarning, matchesSupportFilter, recoveryNote, RISK_RULES, RISK_RULES_INTRO } from "../src/modules/module7/services/studentSupportClassification.ts";

import { passageProgressText } from "../src/modules/module7/services/scoreDisplay.ts";

const source = (name: string) => readFileSync(new URL(`../src/modules/module7/${name}`, import.meta.url), "utf8");

test("the threshold guidance states the rules, the benchmark and that they are project-defined", () => {
  assert.match(RISK_RULES_INTRO, /75%/);
  assert.match(RISK_RULES_INTRO, /not a DepEd classification/);
  const rules = new Map<string, string>(RISK_RULES);
  assert.deepEqual([...rules.keys()], ["On Track", "Early Warning", "At Risk", "Needs Support", "Recovery", "No assessment data"]);
  assert.match(rules.get("On Track")!, /80%/);
  assert.match(rules.get("Early Warning")!, /not a failure/);
  assert.match(rules.get("Needs Support")!, /below 60%, or two scores in a row below 75%/);
  assert.match(rules.get("Recovery")!, /two scores in a row.*One higher score does not clear/);
  assert.match(rules.get("No assessment data")!, /not a low score/);
});

test("Teachers and Admins see the same guidance; old thresholds are gone from every M7 screen", () => {
  assert.match(source("M7Pages.tsx"), /<RiskGuidance\/>/);
  assert.match(source("AdminStudentPerformancePage.tsx"), /<RiskGuidance \/>/);
  assert.match(source("components/AdminAnalyticsSections.tsx"), /<RiskGuidance \/>/);
  for (const file of ["M7Pages.tsx", "AdminStudentPerformancePage.tsx", "components/AdminAnalyticsSections.tsx", "services/studentSupportClassification.ts"]) {
    assert.doesNotMatch(source(file), /three give At Risk|Three below 60|Two consecutive scores below 75% give/, file);
  }
});

test("Teacher support removes notification UI but keeps alert and recovery history", () => {
  const page = source("M7Pages.tsx");
  assert.doesNotMatch(page, /Notifications \(|No unread alerts|Background notifications are not active yet|View performance analytics|View weekly reports/);
  assert.match(page, /Alert and recovery history/);
  assert.match(page, /Current classification does not depend on saved alert history/);
});

test("recovery progress, and duplicates shown as not counted", () => {
  assert.equal(recoveryNote(1), "Recovery in progress: 1 of 2 scores at 75% or above.");
  assert.equal(recoveryNote(0), "");
  assert.equal(recoveryNote(undefined), "");
  assert.match(source("M7Pages.tsx"), /Other saved results \(not counted\)/);
  assert.match(source("AdminStudentPerformancePage.tsx"), /<NotCountedQuizzes quizzes=\{detail\.historicalQuizzes\} \/>/);
});

test("support filters: No assessment data is not an active warning", () => {
  for (const label of ["Early Warning", "At Risk", "Needs Support"]) assert.equal(isActiveWarning(label), true);
  for (const label of ["On Track", "No assessment data", "Evaluation unavailable"]) assert.equal(isActiveWarning(label), false);
  assert.equal(matchesSupportFilter({ classification: "No assessment data", history: [] }, "active"), false);
  assert.equal(matchesSupportFilter({ classification: "At Risk", history: [] }, "active"), true);
});

test("Independent Learners have no classroom section; module activities link to their Learning Room", () => {
  const page = source("M7Pages.tsx");
  assert.match(page, /role === 'student' && <section><h2>Activity progress/);
  assert.match(page, /a\.kind === 'module' \? `\/dashboard\/learning-rooms\/\$\{a\.roomId\}`/);
  assert.match(page, /passageProgressText\(a\)/);
});

test("quiz tables show no Hints column: M6 no longer records hints", () => {
  const page = source("M7Pages.tsx");
  const table = page.slice(page.indexOf("function QuizTable"), page.indexOf("\n", page.indexOf("function QuizTable")));
  assert.match(table, /<th>Activity<\/th><th>Completed \(PHT\)<\/th><th>First-answer score<\/th><\/tr>/);
  assert.doesNotMatch(table, /Hints|hintsUsed/);
  // The same table serves Supporting quiz history, the not-counted results and learner progress.
  assert.match(page, /<h2>Quiz History<\/h2><QuizTable/);
  assert.match(page, /Other saved results \(not counted\)<\/h3><p>\{NOT_COUNTED_NOTE\}<\/p><QuizTable/);
  assert.match(table, /className="m7-scroll"/, "the responsive table wrapper is kept");
  // Teacher Analytics > Student Performance > Comprehension history: scores remain.
  const analytics = source("TeacherAnalyticsPage.tsx");
  assert.doesNotMatch(analytics, /Hints Used|hintsUsed|hints and/i);
  assert.match(analytics, /<th>First-answer score<\/th>/);
  assert.match(analytics, /score\(result.scorePercentage\)/);
  assert.match(analytics, /result.correctAnswers.*result.totalQuestions/);
});

test("module progress reads as passages completed; other activities add nothing", () => {
  assert.equal(passageProgressText({ kind: "module", passagesCompleted: 4, passagesTotal: 6 }), "4 of 6 passages completed");
  assert.equal(passageProgressText({ kind: "module", passagesCompleted: 0, passagesTotal: 0 }), "No passages available");
  assert.equal(passageProgressText({}), "");
  assert.match(source("AdminStudentPerformancePage.tsx"), /passageProgressText\(a\)/);
  assert.match(source("M7Pages.tsx"), /Assigned reading progress/);
});
