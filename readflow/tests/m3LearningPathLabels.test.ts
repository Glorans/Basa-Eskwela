import assert from "node:assert/strict";
import test from "node:test";
import { difficultyTierMismatch, learningPathDescription, learningPathOptionLabel } from "../src/modules/module3/utils/learningPathLabels.ts";

const path = { id: "p", name: "English Foundations", language: "en" as const, readingLevel: "Frustration" as const, difficultyTier: "Easy" as const };

test("learning-path labels keep the saved name and show language, reading level and tier", () => {
  assert.equal(learningPathOptionLabel(path), "English Foundations — English · Frustration reading level · Easy tier");
  assert.equal(
    learningPathOptionLabel({ ...path, name: "Filipino Malayang Mambabasa", language: "fil", readingLevel: "Independent", difficultyTier: "Hard" }),
    "Filipino Malayang Mambabasa — Filipino · Independent reading level · Hard tier",
  );
  assert.match(learningPathDescription(path), /Frustration reading level in English/);
});

test("module difficulty is compared with the path tier without changing either", () => {
  assert.equal(difficultyTierMismatch(path, "Easy"), null);
  assert.equal(difficultyTierMismatch(undefined, "Hard"), null);
  assert.match(difficultyTierMismatch(path, "Hard") ?? "", /difficulty \(Hard\) differs from the learning path's Easy tier/);
});
