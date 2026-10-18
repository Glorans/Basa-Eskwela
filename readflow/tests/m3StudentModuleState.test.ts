import assert from "node:assert/strict";
import test from "node:test";
import {
  getPublishedStudentModule,
  getPublishedStudentModules,
  getStudentModuleAction,
} from "../src/modules/module3/state/studentModuleState.ts";
import type { ReadingModule } from "../src/modules/module3/types/content.ts";

const modules: ReadingModule[] = [
  {
    id: "published-module",
    title: "Published Story",
    difficulty: "Easy",
    learningPathId: "path-easy",
    learningPath: "English Foundations",
    language: "en",
    readingLevel: "Instructional",
    difficultyTier: "Easy",
    status: "published",
    createdAt: "2026-09-30",
    publishedAt: "2026-09-30T08:00:00.000Z",
    passage: "This passage is ready for Student reading.",
    questionCount: 3,
  },
  {
    id: "draft-module",
    title: "Draft Story",
    difficulty: "Medium",
    learningPathId: "path-medium",
    learningPath: "English Instructional",
    language: "en",
    readingLevel: "Instructional",
    difficultyTier: "Easy",
    status: "draft",
    createdAt: "2026-09-30",
    passage: "This draft must remain hidden.",
    questionCount: 0,
  },
  {
    id: "archived-module",
    title: "Archived Story",
    difficulty: "Hard",
    learningPathId: "path-hard",
    learningPath: "English Independent",
    language: "en",
    readingLevel: "Instructional",
    difficultyTier: "Easy",
    status: "archived",
    createdAt: "2026-09-30",
    passage: "This archive must remain hidden.",
    questionCount: 5,
  },
];

test("Student receives published modules", () => {
  const publishedModules = getPublishedStudentModules(modules);

  assert.deepEqual(publishedModules.map((module) => module.id), ["published-module"]);
});

test("Student module list excludes draft modules", () => {
  assert.equal(
    getPublishedStudentModules(modules).some((module) => module.id === "draft-module"),
    false,
  );
});

test("Student module list excludes archived modules", () => {
  assert.equal(
    getPublishedStudentModules(modules).some((module) => module.id === "archived-module"),
    false,
  );
});

test("Student module detail loads a published passage", () => {
  const module = getPublishedStudentModule(modules, "published-module");

  assert.equal(module?.title, "Published Story");
  assert.equal(module?.passage, "This passage is ready for Student reading.");
});

test("invalid, draft, and archived module IDs return the safe not-found result", () => {
  assert.equal(getPublishedStudentModule(modules, "missing-module"), undefined);
  assert.equal(getPublishedStudentModule(modules, "draft-module"), undefined);
  assert.equal(getPublishedStudentModule(modules, "archived-module"), undefined);
  assert.equal(getPublishedStudentModule(modules, undefined), undefined);
});

test("Student view data and actions exclude management capabilities", () => {
  const module = getPublishedStudentModule(modules, "published-module");
  const action = getStudentModuleAction("published-module");

  assert.ok(module);
  assert.equal("status" in module, false);
  assert.equal("publishedAt" in module, false);
  assert.equal("questionCount" in module, false);
  assert.deepEqual(action, {
    label: "Read",
    to: "/dashboard/materials/published-module",
  });
  assert.equal("edit" in action, false);
  assert.equal("delete" in action, false);
  assert.equal("publish" in action, false);
  assert.equal("archive" in action, false);
});
