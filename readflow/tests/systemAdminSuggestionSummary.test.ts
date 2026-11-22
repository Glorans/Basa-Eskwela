import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { improvingNote, suggestionCategoryCards } from "../src/modules/module7/services/suggestionSummary.ts";

const group = (g: Partial<Record<string, number>>) => ({ learners: 0, withSuggestion: 0, withRepeated: 0, preliminaryOnly: 0, improving: 0, moreDataNeeded: 0, noData: 0, onTrack: 0, ...g });

test("System Admin summary: four mutually exclusive cards add up to the learner total; Improving is not one of them", () => {
  // The Staging counts reported on 2026-11-22 (backend summary values, read-only audit).
  const students = group({ learners: 40, withSuggestion: 31, withRepeated: 4, preliminaryOnly: 27, improving: 3, moreDataNeeded: 2, noData: 5, onTrack: 2 });
  const learners = group({ learners: 12, withSuggestion: 4, withRepeated: 1, preliminaryOnly: 3, improving: 0, moreDataNeeded: 0, noData: 7, onTrack: 1 });
  for (const [g, expected] of [[students, [4, 27, 7, 2]], [learners, [1, 3, 7, 1]]] as const) {
    const cards = suggestionCategoryCards(g);
    assert.deepEqual(cards.map(([label]) => label), ["Repeated learning difficulty", "Preliminary observations only", "More data needed or no results yet", "On track"]);
    assert.deepEqual(cards.map(([, value]) => value), expected);
    assert.equal(cards.reduce((sum, [, value]) => sum + value, 0), g.learners, "the four categories add up to the registered learners");
    assert.ok(!cards.some(([label]) => /Improving/.test(label)));
  }
});

test("System Admin summary: Improving is a separate, overlapping progress indicator", () => {
  assert.equal(improvingNote(3), "3 learners improving (keep monitoring). These learners are also counted in the categories above.");
  assert.equal(improvingNote(1), "1 learner improving (keep monitoring). This learner is also counted in the categories above.");
  assert.match(improvingNote(0), /^No learners currently improving/);
});

test("System Admin page uses the helpers, explains the totals and the multi-row competency table", () => {
  const page = readFileSync(new URL("../src/modules/module7/SystemAdminAnalyticsPage.tsx", import.meta.url), "utf8");
  assert.match(page, /suggestionCategoryCards\(group\)/);
  assert.match(page, /improvingNote\(group\.improving\)/);
  assert.match(page, /The four categories add up to the registered learner total/);
  assert.match(page, /A learner with several practice areas may be counted in multiple rows\./);
  assert.doesNotMatch(page, /'Improving \(keep monitoring\)'/, "Improving is no longer a peer card");
});
