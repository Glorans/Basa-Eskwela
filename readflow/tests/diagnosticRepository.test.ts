import { passageResult, perfectResult } from "./fixtures/diagnosticPassage.ts";
import { getLearnerPlacement } from "../src/modules/module3/services/learnerPlacement.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/database.types.ts";
import { createDiagnosticRepository } from "../src/modules/module2/services/diagnosticRepository.ts";
import { diagnosticAssessmentRegistry, getNextDiagnosticLanguage, getRequiredDiagnosticLanguages } from "../src/modules/module2/data/diagnosticData.ts";
import { calculateOralReadingMetrics } from "../src/modules/module2/services/diagnosticScoring.ts";

function fixture(saveError: { code: string; message: string; details: string; hint: string; access_token?: string } | null = null) {
  const failures: unknown[] = [];
  const rows: Record<string, unknown>[] = [];
  const conflicts: string[] = [];
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: "reader" } } }) },
    from: () => {
      const filters: [string, unknown][] = [];
      let inserted: Record<string, unknown> | undefined;
      const query = {
        upsert(row: Record<string, unknown>, options: { onConflict: string }) {
          conflicts.push(options.onConflict);
          const existing = rows.find(item => options.onConflict.split(",").every(key => item[key] === row[key]));
          inserted = Object.assign(existing ?? {}, row, { id: `${row.user_id}:${row.language}` });
          if (!existing && !saveError) rows.push(inserted);
          return query;
        },
        select: () => query,
        eq(key: string, value: unknown) { filters.push([key, value]); return query; },
        single: async () => ({ data: saveError ? null : inserted, error: saveError }),
        maybeSingle: async () => ({ data: rows.find(row => filters.every(([key, value]) => row[key] === value)) ?? null }),
        then(resolve: (value: unknown) => unknown) {
          return Promise.resolve({ data: rows.filter(row => filters.every(([key, value]) => row[key] === value)) }).then(resolve);
        },
      };
      return query;
    },
  };
  return { rows, conflicts, failures, repository: createDiagnosticRepository(client as unknown as SupabaseClient<Database>, { onSaveError: failure => failures.push(failure) }) };
}

test("v3 saves preserve historical records, round-trip details and replace duplicate final submissions", async () => {
  const { repository, rows } = fixture();
  await repository.saveInitialDiagnosticResult({ language: "en", assessmentId: "grade5-en-the-gift-v1", assessmentVersion: "1.0",
    orvScore: 80, comprehensionScore: 60, readingLevel: "Frustration", difficultyTier: "Easy" });
  const historical = structuredClone(rows[0]);
  for (const language of ["en", "fil", "en"] as const) {
    const expected = perfectResult(language);
    const saved = await repository.saveInitialDiagnosticResult(expected);
    assert.deepEqual(saved.result, expected);
    assert.equal("sentences" in saved.result, false);
    assert.equal((await repository.getInitialDiagnosticResult(language))?.result.orvScore, 100);
  }
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], historical);
  await assert.rejects(repository.saveInitialDiagnosticResult({ ...perfectResult("en"), transcript: "" }));
  await assert.rejects(repository.saveInitialDiagnosticResult({ ...perfectResult("en"), comprehensionAnswers: {} }));
});

test("v3 saves rescore from the transcript and answers, ignoring submitted scores", async () => {
  const { repository, rows } = fixture();
  const expected = passageResult("en", { miscues: 3, correct: 5 });
  const saved = await repository.saveInitialDiagnosticResult({ ...expected, orvScore: 100, readingLevel: "Independent", difficultyTier: "Hard" });
  assert.equal(saved.result.readingLevel, "Instructional");
  assert.equal(saved.result.difficultyTier, "Medium");
  assert.equal(rows[0].orv_score, 95);
  assert.equal(rows[0].reading_level, "Instructional");
  assert.equal(rows[0].assessment_version, "3.0");
});

test("Module 3 placement is ready for a valid v3.0 result and missing for a v2.0 result", async () => {
  const { repository, rows } = fixture();
  rows.push({ user_id: "reader", assessment_type: "initial", language: "en", assessment_id: "grade5-en-sentences-v2",
    assessment_version: "2.0", orv_score: 100, comprehension_score: 100, reading_level: "Independent", difficulty_tier: "Hard" });
  assert.deepEqual(await getLearnerPlacement("en", repository), { status: "missing", language: "en" });
  await repository.saveInitialDiagnosticResult(passageResult("en", { miscues: 3, correct: 5 }));
  assert.deepEqual(await getLearnerPlacement("en", repository), { status: "ready", language: "en",
    readingLevel: "Instructional", difficultyTier: "Medium", assessmentId: "grade5-en-passage-v3", assessmentVersion: "3.0" });
});

test("upserts and reads separate EN/FIL results with metadata and camelCase serialization", async () => {
  const { repository, rows, conflicts } = fixture();
  for (const language of ["en", "fil", "en", "fil"] as const) {
    await repository.saveInitialDiagnosticResult(perfectResult(language));
  }
  assert.equal(rows.length, 2);
  for (const language of ["en", "fil"] as const) {
    const row = rows.find(item => item.language === language)!;
    assert.equal(row.assessment_id, diagnosticAssessmentRegistry[language]!.id);
    assert.equal(row.assessment_version, "3.0");
    assert.equal(row.assessment_type, "initial");
  }
  assert.ok(conflicts.every(key => key === "user_id,assessment_type,language,assessment_id,assessment_version"));
  assert.equal((await repository.getInitialDiagnosticResult("en"))?.result.orvScore, 100);
  assert.equal((await repository.getInitialDiagnosticResult("fil"))?.result.assessmentId, diagnosticAssessmentRegistry.fil!.id);
  assert.equal(await repository.hasCompletedInitialDiagnostic("fil"), true);
  assert.equal(await repository.hasCompletedInitialDiagnostic(), true);
});

test("serializes every result field and restores optional metrics without visual progress", async () => {
  const { repository, rows } = fixture();
  const metrics = calculateOralReadingMetrics("one day a frog", "one day frog", 5);
  const result = {
    language: "en" as const, assessmentId: "en-assessment", assessmentVersion: "1.0",
    orvScore: metrics.wordReadingScore, comprehensionScore: 100,
    readingLevel: "Instructional" as const, difficultyTier: "Medium" as const,
    readingSpeedWpm: metrics.readingSpeedWpm, transcript: "one day frog",
    googleConfidence: 0.9, oralReadingMetrics: metrics,
  };
  assert.deepEqual((await repository.saveInitialDiagnosticResult(result)).result, result);
  assert.deepEqual(rows[0], {
    id: "reader:en", user_id: "reader", assessment_type: "initial", language: "en",
    assessment_id: "en-assessment", assessment_version: "1.0",
    orv_score: 75, comprehension_score: 100, reading_level: "Instructional", difficulty_tier: "Medium",
    reading_speed_wpm: 36, transcript: "one day frog", stt_confidence: 0.9,
    oral_reading_metrics: metrics, completed_at: rows[0].completed_at, updated_at: rows[0].completed_at,
  });
  assert.ok(Number.isFinite(Date.parse(rows[0].completed_at as string)));
});

test("completion requires both active languages", async () => {
  const { repository } = fixture();
  assert.equal(await repository.hasCompletedInitialDiagnostic(), false);
  await repository.saveInitialDiagnosticResult(perfectResult("en"));
  assert.equal(await repository.hasCompletedInitialDiagnostic(), false);
  assert.equal(await repository.hasCompletedInitialDiagnostic("en"), true);
  assert.equal(await repository.hasCompletedInitialDiagnostic("fil"), false);
  assert.deepEqual(getRequiredDiagnosticLanguages(), ["en", "fil"]);
});

test("both-language sequence activates when approved Filipino data is registered", () => {
  const registry = diagnosticAssessmentRegistry;
  assert.equal(getNextDiagnosticLanguage([], registry), "en");
  assert.equal(getNextDiagnosticLanguage(["en"], registry), "fil");
  assert.equal(getNextDiagnosticLanguage(["fil"], registry), "en");
  assert.equal(getNextDiagnosticLanguage(["en", "fil"], registry), undefined);
});

test("new migration replaces only the old uniqueness constraint and preserves legacy rows", async () => {
  const sql = await readFile(new URL("../../supabase/diagnostic_results_bilingual.sql", import.meta.url), "utf8");
  assert.match(sql, /unique \(user_id, assessment_type, language\)/i);
  assert.match(sql, /add column if not exists assessment_id text/i);
  assert.match(sql, /add column if not exists assessment_version text/i);
  assert.match(sql, /drop constraint if exists diagnostic_results_user_assessment_key/i);
  assert.doesNotMatch(sql, /\b(?:delete from|truncate|drop table|update public\.diagnostic_results)\b/i);
});

test("ordered migrations supply the repository columns and preserve RLS in incremental upgrades", async () => {
  const [base, language, bilingual] = await Promise.all([
    "diagnostic_results.sql", "diagnostic_results_language.sql", "diagnostic_results_bilingual.sql",
  ].map(name => readFile(new URL(`../../supabase/${name}`, import.meta.url), "utf8")));
  assert.match(base, /constraint diagnostic_results_user_assessment_key\s+unique \(user_id, assessment_type\)/i);
  assert.match(base, /enable row level security/i);
  assert.match(language, /add column if not exists language text not null default 'en'/i);
  assert.match(language, /check \(language in \('en', 'fil'\)\)/i);
  for (const sql of [language, bilingual]) {
    assert.match(sql, /begin;[\s\S]*commit;/i);
    assert.doesNotMatch(sql, /\b(?:policy|disable row level security|revoke|grant)\b/i);
  }
  assert.match(bilingual, /assessment_id text/);
  assert.match(bilingual, /assessment_version text/);
  assert.match(bilingual, /unique \(user_id, assessment_type, language\)/i);
});

for (const error of [
  { code: "PGRST204", message: "Could not find the assessment_id column in the schema cache" },
  { code: "42P10", message: "There is no unique or exclusion constraint matching the ON CONFLICT specification" },
]) {
  test(`schema failure ${error.code} is reported without retrying against the old conflict key`, async () => {
    const { repository, conflicts, failures, rows } = fixture({ ...error, details: "", hint: "" });
    await assert.rejects(repository.saveInitialDiagnosticResult({
      language: "en", assessmentId: "en-assessment", assessmentVersion: "1.0",
      orvScore: 95, comprehensionScore: 100, readingLevel: "Instructional", difficultyTier: "Medium",
    }), /We couldn't save your diagnostic result\. Please try again\./);
    assert.deepEqual(conflicts, ["user_id,assessment_type,language,assessment_id,assessment_version"]);
    assert.equal(rows.length, 0);
    assert.equal((failures[0] as { code: string }).code, error.code);
  });
}


test("save diagnostics log only Supabase error fields and payload names while preserving safe UI errors", async () => {
  const error = { code: "42703", message: "column diagnostic_results.assessment_id does not exist", details: "schema mismatch", hint: "Apply the reviewed migration", access_token: "never-log-this" };
  const { repository, failures, rows, conflicts } = fixture(error);
  const result = { language: "en" as const, assessmentId: "assessment", assessmentVersion: "1", orvScore: 90, comprehensionScore: 75,
    readingLevel: "Instructional" as const, difficultyTier: "Medium" as const, transcript: "private reading" };
  for (let attempt = 0; attempt < 2; attempt++) {
    await assert.rejects(repository.saveInitialDiagnosticResult(result), failure => {
      assert.equal((failure as Error).message, "We couldn't save your diagnostic result. Please try again.");
      return true;
    });
  }
  assert.equal(rows.length, 0);
  assert.equal(failures.length, 2);
  assert.deepEqual(conflicts, ["user_id,assessment_type,language,assessment_id,assessment_version", "user_id,assessment_type,language,assessment_id,assessment_version"]);
  const logged = failures[0] as Record<string, unknown>;
  assert.deepEqual(Object.keys(logged).sort(), ["code", "details", "hint", "message", "payloadFieldNames"]);
  assert.equal(logged.code, error.code);
  assert.equal(logged.message, error.message);
  assert.equal(logged.details, error.details);
  assert.equal(logged.hint, error.hint);
  assert.ok((logged.payloadFieldNames as string[]).includes("assessment_id"));
  assert.doesNotMatch(JSON.stringify(failures), /never-log-this|private reading|access_token/);
});


for (const language of ["en", "fil"] as const) {
  for (const kind of ["current", "old-id", "wrong-version", "missing-metadata", "other-language-id"] as const) {
    test(language + " completion checks active metadata: " + kind, async () => {
      const { repository, rows } = fixture();
      const active = diagnosticAssessmentRegistry[language]!;
      const assessmentId = kind === "old-id" ? "retired-assessment" : kind === "missing-metadata" ? undefined
        : kind === "other-language-id" ? diagnosticAssessmentRegistry[language === "en" ? "fil" : "en"]!.id : active.id;
      const assessmentVersion = kind === "wrong-version" ? "0.9" : kind === "missing-metadata" ? undefined : active.version;
      rows.push({ user_id: "reader", assessment_type: "initial", language, assessment_id: assessmentId, assessment_version: assessmentVersion, orv_score: 95, comprehension_score: 80, reading_level: "Independent", difficulty_tier: "Hard" });
      const before = structuredClone(rows);
      assert.deepEqual(await repository.getCompletedDiagnosticLanguages(), kind === "current" ? [language] : []);
      assert.equal(await repository.hasCompletedInitialDiagnostic(language), kind === "current");
      assert.equal(await repository.hasCompletedInitialDiagnostic(), false);
      // Old results remain available with their original metadata, without becoming completion.
      const saved = await repository.getInitialDiagnosticResult(language);
      if (kind === "current") assert.equal(saved?.result.assessmentId, assessmentId);
      else assert.equal(saved, null);
      assert.deepEqual(rows, before);
    });
  }
}

for (const [englishCurrent, filipinoCurrent, expected, next] of [
  [true, true, ["en", "fil"], undefined],
  [true, false, ["en"], "fil"],
  [false, true, ["fil"], "en"],
  [false, false, [], "en"],
] as const) {
  test("mixed saved versions EN=" + englishCurrent + " FIL=" + filipinoCurrent, async () => {
    const { repository } = fixture();
    for (const [language, current] of [["en", englishCurrent], ["fil", filipinoCurrent]] as const) {
      const active = diagnosticAssessmentRegistry[language]!;
      await repository.saveInitialDiagnosticResult({ ...perfectResult(language), language, assessmentId: current ? active.id : "retired-" + language,
        assessmentVersion: active.version, orvScore: 95, comprehensionScore: 80, readingLevel: "Independent", difficultyTier: "Hard" });
    }
    const completed = await repository.getCompletedDiagnosticLanguages();
    assert.deepEqual(completed, expected);
    assert.equal(getNextDiagnosticLanguage(completed), next);
    assert.equal(await repository.hasCompletedInitialDiagnostic(), englishCurrent && filipinoCurrent);
    assert.equal(await repository.hasCompletedInitialDiagnostic("en"), englishCurrent);
    assert.equal(await repository.hasCompletedInitialDiagnostic("fil"), filipinoCurrent);
  });
}
