import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_PASSAGE_BANK_SIZE, SIX_ONLY, bankSizeOptionLabel, describeBankRequirement, isBalancedBank,
  parsePassageBankSizes, targetBankSize,
} from "../src/modules/module3/utils/passageBankSize.ts";
import { formatPublishIssues, groupPublishIssues } from "../src/modules/module3/utils/publishIssues.ts";

const bank = (count: number) => Array.from({ length: count }, (_, i) => ({ type: ["literal", "inferential", "critical"][Math.floor(i / (count / 3))] }));

test("six is the default and the only size until the database reports more", () => {
  assert.equal(DEFAULT_PASSAGE_BANK_SIZE, 6);
  for (const value of [null, undefined, "6,9,12", {}, [], [9, 12], [6, 7, 8], [3]]) {
    assert.deepEqual(parsePassageBankSizes(value), SIX_ONLY, JSON.stringify(value));
  }
  assert.deepEqual(parsePassageBankSizes([6, 9, 12]), [6, 9, 12]);
  assert.deepEqual(parsePassageBankSizes([12, 6, 15, 9]), [6, 9, 12], "unknown sizes are ignored, order is fixed");
});

test("balanced banks need an allowed size and equal categories", () => {
  assert.equal(isBalancedBank(bank(6)), true);
  assert.equal(isBalancedBank(bank(9)), false, "nine is not valid while only six is supported");
  assert.equal(isBalancedBank(bank(9), [6, 9, 12]), true);
  assert.equal(isBalancedBank(bank(12), [6, 9, 12]), true);
  assert.equal(isBalancedBank([...bank(6), { type: "literal" }, { type: "literal" }, { type: "literal" }], [6, 9, 12]), false);
  assert.equal(isBalancedBank([], [6, 9, 12]), false);
});

test("a passage keeps its saved size; anything else starts from six", () => {
  assert.equal(targetBankSize(9, [6, 9, 12]), 9);
  assert.equal(targetBankSize(9, SIX_ONLY), 6);
  assert.equal(targetBankSize(0, [6, 9, 12]), 6);
  assert.equal(bankSizeOptionLabel(12), "12 questions (4 Literal, 4 Inferential, 4 Critical)");
  assert.equal(describeBankRequirement(), "six questions: 2 literal, 2 inferential and 2 critical");
  assert.equal(describeBankRequirement([6, 9, 12]), "6, 9 or 12 questions, with equal numbers of literal, inferential and critical questions");
});

// The exact strings the proposed database functions return (disposable restore of staging, Module 1).
const proposedEmpty = [1, 2].flatMap((n) => [
  `Passage ${n} has no reviewed comprehension questions`,
  `Passage ${n} needs at least 2 literal questions`,
  `Passage ${n} needs at least 2 inferential questions`,
  `Passage ${n} needs at least 2 critical questions`,
]).concat(["Passage 2 requires 6, 9 or 12 questions", "Passage 1 requires 6, 9 or 12 questions"]);

test("after the migration, an empty bank is one line naming 6, 9 or 12", () => {
  const grouped = groupPublishIssues(proposedEmpty);
  assert.deepEqual(grouped.passages.map((p) => p.messages), [1, 2].map(() => [
    "No question bank yet. Generate and review 6, 9 or 12 questions, with equal numbers of literal, inferential and critical questions.",
  ]));
});

test("after the migration, wrong sizes and unequal nine/twelve banks are explained", () => {
  assert.deepEqual(groupPublishIssues(["Passage 1 requires 6, 9 or 12 questions", "Passage 1 needs at least 2 critical questions"]).passages[0].messages,
    ["Regenerate this question bank with 6, 9 or 12 questions, with equal numbers of literal, inferential and critical questions."]);
  assert.deepEqual(groupPublishIssues(["Passage 2 requires exactly 3 literal questions", "Passage 2 requires exactly 3 critical questions"]).passages[0].messages,
    ["Needs exactly three literal and critical questions (this 9-question bank needs 3 literal, 3 inferential and 3 critical)."]);
  assert.match(formatPublishIssues(["Passage 3 requires exactly 4 inferential questions"]),
    /Passage 3:\n• Needs exactly four inferential questions \(this 12-question bank needs 4 literal, 4 inferential and 4 critical\)\./);
});

test("before the migration, six-question wording is unchanged", () => {
  assert.deepEqual(groupPublishIssues(["Passage 1 requires exactly two literal questions"]).passages[0].messages,
    ["Needs exactly two literal questions (each passage needs 2 literal, 2 inferential and 2 critical)."]);
});
