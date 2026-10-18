import assert from "node:assert/strict";
import test from "node:test";
import { getPublishedStudentModules, getPublishedStudentModule } from "../src/modules/module3/state/studentModuleState.ts";
import {
  buildCreateModulePayload,
  loadMappedModules,
  mapModuleRow,
  mapLearningPathRow,
  toStudentReadingModule,
  ModuleDataError,
  type ModuleQueryRow,
} from "../src/modules/module3/services/moduleModel.ts";

const livePathId = "9ec9f4e8-63de-48ea-8c93-8576844278a2";

for (const [language, expected] of [["en", "en"], ["English", "en"], ["fil", "fil"], ["Filipino", "fil"], [" Tagalog ", "fil"]] as const) {
  for (const readingLevel of ["Independent", "Instructional", "Frustration"] as const) {
    for (const difficultyTier of ["Easy", "Medium", "Hard"] as const) {
      test(`maps and preserves ${language}/${readingLevel}/${difficultyTier} through both student access paths`, () => {
        const row = { ...moduleRow, difficulty: "Hard", learning_paths: { ...moduleRow.learning_paths!, language, reading_level: readingLevel, difficulty_tier: difficultyTier } };
        const path = mapLearningPathRow(row.learning_paths);
        const module = mapModuleRow(row);
        assert.equal(path.language, expected);
        assert.equal(path.readingLevel, readingLevel);
        assert.equal(path.difficultyTier, difficultyTier);
        for (const mapped of [module, toStudentReadingModule(module), getPublishedStudentModules([module])[0], getPublishedStudentModule([module], module.id)!]) {
          assert.equal(mapped.language, expected);
          assert.equal(mapped.readingLevel, readingLevel);
          assert.equal(mapped.difficultyTier, difficultyTier);
          assert.equal(mapped.difficulty, "Hard");
        }
      });
    }
  }
}

for (const [field, invalid, message] of [["language", "Spanish", /unsupported language/], ["reading_level", "Advanced", /unsupported reading-level/], ["difficulty_tier", "Extreme", /unsupported difficulty-tier/]] as const) {
  test(`rejects invalid learning-path ${field} in path and module mapping`, () => {
    const path = { ...moduleRow.learning_paths!, [field]: invalid };
    for (const map of [() => mapLearningPathRow(path), () => mapModuleRow({ ...moduleRow, learning_paths: path })]) {
      assert.throws(map, error => error instanceof ModuleDataError && message.test(error.message));
    }
  });
}

const moduleRow: ModuleQueryRow = {
  id: "3909e019-7a84-4d77-8b36-9ff1e2289462",
  path_id: livePathId,
  title: "River Watchers",
  difficulty: "Medium",
  status: "published",
  collection_revision: 1,
  created_by: "a3c82184-ad20-49ac-a4c4-8c1a43831fbb",
  created_at: "2026-09-30T08:00:00.000Z",
  published_at: "2026-09-30T09:00:00.000Z",
  passage: "Learners observed the river after the rain.",
  source_material_id: null,
  updated_at: "2026-09-30T09:00:00.000Z",
  learning_paths: {
    id: livePathId,
    path_name: "English Instructional",
    language: "English",
    reading_level: "Instructional",
    difficulty_tier: "Medium",
    description: null,
  },
  comprehension_questions: [{ count: 6 }],
};

test("maps a generated database row into the ReadingModule model", () => {
  const module = mapModuleRow(moduleRow);

  assert.equal(module.id, moduleRow.id);
  assert.equal(module.learningPathId, livePathId);
  assert.equal(module.learningPath, "English Instructional");
  assert.equal(module.difficulty, "Medium");
  assert.equal(module.status, "published");
  assert.equal(module.questionCount, 6);
  assert.equal(module.passage, moduleRow.passage);
});

test("rejects unsupported generated difficulty and status values", () => {
  assert.throws(
    () => mapModuleRow({ ...moduleRow, difficulty: "Impossible" }),
    /unsupported difficulty/i,
  );
  assert.throws(
    () => mapModuleRow({ ...moduleRow, status: "removed" }),
    /unsupported status/i,
  );
});

test("builds an Admin insert with the selected live learning-path UUID", () => {
  const payload = buildCreateModulePayload(
    {
      title: "  A New Module  ",
      learningPathId: livePathId,
      difficulty: "Easy",
      passage: "  A saved passage.  ",
    },
    "a3c82184-ad20-49ac-a4c4-8c1a43831fbb",
    moduleRow.learning_paths,
  );

  assert.equal(payload.path_id, livePathId);
  assert.equal(payload.title, "A New Module");
  assert.equal(payload.passage, "A saved passage.");
  assert.equal(payload.status, "draft");
});

test("a data-source failure rejects instead of returning mock modules", async () => {
  await assert.rejects(
    () => loadMappedModules(async () => Promise.reject(new Error("database unavailable"))),
    /database unavailable/,
  );
});
