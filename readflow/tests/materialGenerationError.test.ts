import test from "node:test";
import assert from "node:assert/strict";
import { getQuestionGenerationError, QUESTION_GENERATION_FAILURE } from "../src/modules/module3/services/questionGenerationError.ts";
const failure = (status: number, message: string) => ({ response: { status, data: { message } } });
test("generation failures never forward provider names, payloads or stacks", () => {
 for (const status of [400,409,422,500,502,503,504]) for (const message of ["Gemini timed out", "GEMINI_API_KEY=secret", "gemini-2.0-flash {stack: internal}"])
  assert.equal(getQuestionGenerationError(failure(status,message)),QUESTION_GENERATION_FAILURE);
 assert.equal(getQuestionGenerationError(new Error("provider secret")),QUESTION_GENERATION_FAILURE);
 assert.equal(getQuestionGenerationError(null),QUESTION_GENERATION_FAILURE);
});
test("rate limits and actionable input failures keep their distinctions", () => {
 const limit="Five new question sets are allowed per rolling 24 hours. Reuse a saved set or try later";
 assert.equal(getQuestionGenerationError(failure(409,limit)),limit);
 assert.match(getQuestionGenerationError(failure(429,"raw provider response")),/limit has been reached/);
 const review="Review and confirm the extracted text before practice";
 assert.equal(getQuestionGenerationError(failure(409,review)),review);
 assert.match(getQuestionGenerationError(failure(401,"raw")),/sign in/);
 assert.match(getQuestionGenerationError(failure(403,"raw")),/unavailable to your account/);
 assert.match(getQuestionGenerationError(failure(413,"raw")),/30,000/);
});
test("actionable app messages from both generation routes are shown as sent", () => {
 for (const message of [
  "This question set changed. Reload it before regenerating.",
  "Reload the question set before changing it.",
  "Completed reviewed material text is required before generating questions.",
  "The saved material language must be English or Filipino before generating questions.",
  "The text changed. Review it again",
  "Generation expired or the material changed. Please retry",
  "This material already has an assessment. Use its saved questions and result",
  "Personal practice has started. Upload a corrected copy; saved practice remains unchanged",
  "Material is used by a module",
 ]) assert.equal(getQuestionGenerationError(failure(409,message)),message);
 // Internal database guards stay generic.
 assert.equal(getQuestionGenerationError(failure(409,"Invalid private question bank")),QUESTION_GENERATION_FAILURE);
 assert.equal(getQuestionGenerationError(failure(409,"Unexpected installed definition: personal_material_source(uuid,uuid,boolean)")),QUESTION_GENERATION_FAILURE);
});
test("every allowed message is still sent word for word by the server or database", async () => {
 const { readFile } = await import("node:fs/promises");
 const sources = (await Promise.all([
  "../../server/routes/materials.js",
  "../../server/services/materialQuestionSetService.js",
  "../../server/services/materialPersistenceService.js",
  "../../server/services/personalMaterialService.js",
  "../../supabase/proposed/personal_material_1_sources_PROPOSED.sql",
  "../../supabase/proposed/personal_material_2_questions_PROPOSED.sql",
  "../../supabase/proposed/personal_material_3_text_edits_and_new_questions_PROPOSED.sql",
  "../src/modules/module3/services/materialService.ts",
 ].map(path => readFile(new URL(path, import.meta.url), "utf8")))).join("\n");
 const helper = await readFile(new URL("../src/modules/module3/services/questionGenerationError.ts", import.meta.url), "utf8");
 const allowed = [...helper.split("SAFE_MESSAGES")[1].split("]);")[0].matchAll(/^\s*"([^"]+)",\s*$/gm)].map(m => m[1]);
 assert.ok(allowed.length >= 20);
 for (const message of allowed) assert.ok(sources.includes(message), `not sent by the server any more: ${message}`);
});
