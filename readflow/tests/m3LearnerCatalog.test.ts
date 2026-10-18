import assert from "node:assert/strict";
import test from "node:test";
import { filterLearnerCatalog } from "../src/modules/module3/state/learnerCatalog.ts";
import type { StudentReadingModule } from "../src/modules/module3/types/content";

test("full catalog filters language and optional module difficulty, not diagnostic tier", () => {
  const modules: StudentReadingModule[] = (["en", "fil"] as const).flatMap(language => (["Easy", "Medium", "Hard"] as const).map(difficulty => ({
    id: `${language}-${difficulty}`, title: "Story", language, difficulty, learningPath: "Path", passage: "Text",
    readingLevel: "Instructional", difficultyTier: "Medium",
  })));
  for (const language of ["en", "fil"] as const) {
    assert.equal(filterLearnerCatalog(modules, language, "All").length, 3);
    for (const difficulty of ["Easy", "Medium", "Hard"] as const) {
      assert.deepEqual(filterLearnerCatalog(modules, language, difficulty).map(m => m.id), [`${language}-${difficulty}`]);
    }
  }
});
