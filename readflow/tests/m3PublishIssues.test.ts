import assert from "node:assert/strict";
import test from "node:test";
import { formatPublishIssues, groupPublishIssues } from "../src/modules/module3/utils/publishIssues.ts";

// The exact list the tester saw: three passages without banks, reported by both validation layers.
const testerIssues = [1, 2, 3].flatMap((n) => [
  `Passage ${n} has no reviewed comprehension questions`,
  `Passage ${n} needs at least 2 literal questions`,
  `Passage ${n} needs at least 2 inferential questions`,
  `Passage ${n} needs at least 2 critical questions`,
]).concat([1, 2, 3].flatMap((n) => [
  `Passage ${n} requires exactly two literal questions`,
  `Passage ${n} requires exactly two inferential questions`,
  `Passage ${n} requires exactly two critical questions`,
]));

test("tester's 21 publication issues collapse to one clear line per passage", () => {
  const grouped = groupPublishIssues(testerIssues);
  assert.deepEqual(grouped.module, []);
  assert.deepEqual(grouped.passages.map((p) => p.passage), [1, 2, 3]);
  for (const { messages } of grouped.passages) {
    assert.deepEqual(messages, ["No question bank yet. Generate and review six questions: 2 literal, 2 inferential and 2 critical."]);
  }
});

test("missing question types are named once, in Skill-Gate order, without duplicates", () => {
  const grouped = groupPublishIssues([
    "Passage 2 requires exactly two critical questions",
    "Passage 2 needs at least 2 critical questions",
    "Passage 2 requires exactly two literal questions",
    "Passage 2 has questions that need review",
  ]);
  assert.deepEqual(grouped.passages, [{
    passage: 2,
    messages: [
      "Needs exactly two literal and critical questions (each passage needs 2 literal, 2 inferential and 2 critical).",
      "Review and save the question bank.",
    ],
  }]);
});

test("module-level, unknown and trigger-joined issues are kept, never dropped", () => {
  const grouped = groupPublishIssues([
    "Module title is required; Passage 1 needs a title",
    "Module title is required",
    "Passage 1 needs reading text",
    "Passage 1 has an unexpected problem",
  ]);
  assert.deepEqual(grouped.module, ["Module title is required"]);
  assert.deepEqual(grouped.passages[0].messages, ["Add a passage title.", "Add the passage text.", "Has an unexpected problem."]);
});

test("formatted message groups by passage on separate lines", () => {
  assert.equal(
    formatPublishIssues(["Passage 2 requires exactly two inferential questions", "Passage 1 has missing or invalid answer keys"]),
    [
      "This module cannot be published yet.",
      "",
      "Passage 1:",
      "• Fix the missing or invalid answer keys.",
      "",
      "Passage 2:",
      "• Needs exactly two inferential questions (each passage needs 2 literal, 2 inferential and 2 critical).",
    ].join("\n"),
  );
});
