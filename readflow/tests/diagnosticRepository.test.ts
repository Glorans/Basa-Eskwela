import { passageResult, perfectResult } from "./fixtures/diagnosticPassage.ts";
import { getLearnerPlacement } from "../src/modules/module3/services/learnerPlacement.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/database.types.ts";
import {
  createDiagnosticRepository,
  DiagnosticDatabaseError,
  type DiagnosticSubmission,
  type DiagnosticSubmissionResponse,
} from "../src/modules/module2/services/diagnosticRepository.ts";
import { diagnosticAssessmentRegistry, getNextDiagnosticLanguage, getRequiredDiagnosticLanguages } from "../src/modules/module2/data/diagnosticData.ts";
import type { DiagnosticLanguage } from "../src/modules/module2/types/diagnostic.ts";

type Row = Record<string, unknown>;

// Stands in for POST /api/diagnostic/results: the backend decides the scores.
function verifiedRow(submission: DiagnosticSubmission, overrides: Row = {}): Row {
  return {
    id: `reader:${submission.language}`, user_id: "reader", assessment_type: "initial", language: submission.language,
    assessment_id: submission.assessmentId, assessment_version: submission.assessmentVersion,
    orv_score: 95, comprehension_score: 83.33, reading_level: "Instructional", difficulty_tier: "Medium",
    reading_speed_wpm: null, transcript: "server transcript", stt_confidence: null,
    oral_reading_metrics: { comprehensionAnswers: submission.answers },
    completed_at: "2026-10-23T00:00:00.000Z", created_at: "2026-10-23T00:00:00.000Z", updated_at: "2026-10-23T00:00:00.000Z",
    verification_status: "server_verified", verification_method: "server_stt_receipt_v1",
    verification_recording_id: "00000000-0000-4000-8000-000000000001", verified_at: "2026-10-23T00:00:00.000Z",
    ...overrides,
  };
}

function fixture(respond?: (submission: DiagnosticSubmission) => DiagnosticSubmissionResponse | Promise<DiagnosticSubmissionResponse>) {
  const failures: unknown[] = [];
  const rows: Row[] = [];
  const submissions: DiagnosticSubmission[] = [];
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: "reader" } } }) },
    from: () => {
      const filters: [string, unknown][] = [];
      const matching = () => rows.filter(row => filters.every(([key, value]) => row[key] === value));
      const query = {
        select: () => query,
        eq(key: string, value: unknown) { filters.push([key, value]); return query; },
        maybeSingle: async () => ({ data: matching()[0] ?? null }),
        then(resolve: (value: unknown) => unknown) {
          return Promise.resolve({ data: matching() }).then(resolve);
        },
      };
      return query;
    },
  };
  const repository = createDiagnosticRepository(client as unknown as SupabaseClient<Database>, {
    submit: async (submission) => {
      submissions.push(structuredClone(submission));
      const response = respond
        ? await respond(submission)
        : { status: 201, result: verifiedRow(submission) as never };
      if (response.result) rows.push(response.result as Row);
      return response;
    },
    onSaveError: failure => failures.push(failure),
  });
  return { rows, submissions, failures, repository };
}

test("saves send only identity, answers, receipts and duration; local scores and transcripts never leave the browser", async () => {
  const { repository, submissions } = fixture();
  const local = passageResult("en", { miscues: 3, correct: 5 });
  await repository.saveInitialDiagnosticResult({ ...local, orvScore: 100, readingLevel: "Independent", difficultyTier: "Hard" });
  assert.deepEqual(Object.keys(submissions[0]).sort(),
    ["answers", "assessmentId", "assessmentVersion", "language", "recordingDurationSeconds", "transcriptReceipts"]);
  assert.deepEqual(submissions[0].transcriptReceipts, ["test-receipt-en"]);
  assert.deepEqual(submissions[0].answers, local.comprehensionAnswers);
  assert.doesNotMatch(JSON.stringify(submissions), /orvScore|readingLevel|difficultyTier|Independent|transcript"|zz0/);
});

test("the saved result is the backend's verified row, not the browser's preview", async () => {
  const { repository } = fixture(submission => ({ status: 201, result: verifiedRow(submission, {
    orv_score: 80, comprehension_score: 50, reading_level: "Frustration", difficulty_tier: "Easy" }) as never }));
  const saved = await repository.saveInitialDiagnosticResult({ ...perfectResult("en"), readingLevel: "Independent", difficultyTier: "Hard" });
  assert.equal(saved.result.readingLevel, "Frustration");
  assert.equal(saved.result.difficultyTier, "Easy");
  assert.equal(saved.result.verificationStatus, "server_verified");
});

test("a reading without receipts or answers is never submitted", async () => {
  const { repository, submissions } = fixture();
  await assert.rejects(repository.saveInitialDiagnosticResult({ ...perfectResult("en"), transcriptReceipts: [] }));
  await assert.rejects(repository.saveInitialDiagnosticResult({ ...perfectResult("en"), transcriptReceipts: undefined }));
  await assert.rejects(repository.saveInitialDiagnosticResult({ ...perfectResult("en"), comprehensionAnswers: undefined }));
  await assert.rejects(repository.saveInitialDiagnosticResult({ ...perfectResult("en"), assessmentId: undefined }));
  assert.equal(submissions.length, 0);
});

for (const [response, code] of [
  [{ status: 409, code: "DIAGNOSTIC_ALREADY_COMPLETED" }, "ALREADY_COMPLETED"],
  [{ status: 422, code: "READING_NOT_VERIFIED" }, "READING_NOT_VERIFIED"],
  [{ status: 422, code: "NO_SPEECH" }, "READING_NOT_VERIFIED"],
  [{ status: 409, code: "ASSESSMENT_CHANGED" }, "ASSESSMENT_CHANGED"],
  [{ status: 401, code: "AUTH_REQUIRED" }, "AUTH_REQUIRED"],
  [{ status: 403, code: "DIAGNOSTIC_FORBIDDEN" }, "SAVE_FAILED"],
  [{ status: 429, code: "DIAGNOSTIC_RATE_LIMITED" }, "SAVE_FAILED"],
  [{ status: 500, code: "DIAGNOSTIC_SAVE_FAILED" }, "SAVE_FAILED"],
  [{ status: 0 }, "SAVE_FAILED"],
] as const) {
  test(`backend ${response.status} ${"code" in response ? response.code : "network"} maps to ${code}`, async () => {
    const { repository, rows } = fixture(() => response);
    await assert.rejects(repository.saveInitialDiagnosticResult(perfectResult("en")), error => {
      assert.ok(error instanceof DiagnosticDatabaseError);
      assert.equal(error.code, code);
      return true;
    });
    assert.equal(rows.length, 0);
  });
}

test("a success response must carry a server-verified row for the submitted language", async () => {
  for (const overrides of [{ verification_status: "unverified" }, { language: "fil" }]) {
    const { repository } = fixture(submission => ({ status: 201, result: verifiedRow(submission, overrides) as never }));
    await assert.rejects(repository.saveInitialDiagnosticResult(perfectResult("en")), /couldn't save/);
  }
  const { repository } = fixture(() => { throw new Error("network down"); });
  await assert.rejects(repository.saveInitialDiagnosticResult(perfectResult("en")), /couldn't save/);
});

test("save failures log only status, code and payload field names", async () => {
  const { repository, failures } = fixture(() => ({ status: 500, code: "DIAGNOSTIC_SAVE_FAILED" }));
  await assert.rejects(repository.saveInitialDiagnosticResult(perfectResult("en")));
  assert.deepEqual(Object.keys(failures[0] as object).sort(), ["code", "payloadFieldNames", "status"]);
  assert.doesNotMatch(JSON.stringify(failures), /test-receipt|en-question|"a"/);
});

test("English and Filipino results are submitted and read separately", async () => {
  const { repository, submissions } = fixture();
  for (const language of ["en", "fil"] as const) await repository.saveInitialDiagnosticResult(perfectResult(language));
  assert.deepEqual(submissions.map(item => [item.language, item.assessmentId]),
    [["en", diagnosticAssessmentRegistry.en!.id], ["fil", diagnosticAssessmentRegistry.fil!.id]]);
  assert.equal((await repository.getInitialDiagnosticResult("fil"))?.result.language, "fil");
  assert.equal(await repository.hasCompletedInitialDiagnostic("en"), true);
  assert.equal(await repository.hasCompletedInitialDiagnostic(), true);
});

function activeRow(language: DiagnosticLanguage, verificationStatus: string, overrides: Row = {}): Row {
  const active = diagnosticAssessmentRegistry[language]!;
  return { user_id: "reader", assessment_type: "initial", language, assessment_id: active.id, assessment_version: active.version,
    orv_score: 100, comprehension_score: 100, reading_level: "Independent", difficulty_tier: "Hard",
    verification_status: verificationStatus, ...overrides };
}

test("unverified rows written before DT1 are kept but never count as completed or as placement", async () => {
  const { repository, rows } = fixture();
  rows.push(activeRow("en", "unverified"), activeRow("fil", "unverified"));
  const before = structuredClone(rows);
  assert.deepEqual(await repository.getCompletedDiagnosticLanguages(), []);
  assert.equal(await repository.hasCompletedInitialDiagnostic(), false);
  assert.equal(await repository.getInitialDiagnosticResult("en"), null);
  assert.deepEqual(await getLearnerPlacement("en", repository), { status: "missing", language: "en" });
  assert.deepEqual(rows, before);
  // A verified row for the same version is a separate record; the legacy row stays.
  rows.push(activeRow("en", "server_verified", { reading_level: "Frustration", difficulty_tier: "Easy" }));
  assert.equal((await repository.getInitialDiagnosticResult("en"))?.result.readingLevel, "Frustration");
  assert.deepEqual(await repository.getCompletedDiagnosticLanguages(), ["en"]);
});

test("Module 3 placement is ready for a verified v3.0 result and missing for a v2.0 result", async () => {
  const { repository, rows } = fixture();
  rows.push({ ...activeRow("en", "server_verified"), assessment_id: "grade5-en-sentences-v2", assessment_version: "2.0" });
  assert.deepEqual(await getLearnerPlacement("en", repository), { status: "missing", language: "en" });
  await repository.saveInitialDiagnosticResult(passageResult("en", { miscues: 3, correct: 5 }));
  assert.deepEqual(await getLearnerPlacement("en", repository), { status: "ready", language: "en",
    readingLevel: "Instructional", difficultyTier: "Medium", assessmentId: "grade5-en-passage-v3", assessmentVersion: "3.0" });
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

test("DT1 keeps historical rows, revokes client writes and never upgrades them in place", async () => {
  const sql = await readFile(new URL("../../supabase/migrations/20261025_m2_trusted_diagnostics.sql", import.meta.url), "utf8");
  assert.match(sql, /add column verification_status text not null default 'unverified'/i);
  assert.match(sql, /revoke insert, update, delete, truncate, references, trigger, maintain\s+on table public\.diagnostic_results from public, anon, authenticated/i);
  assert.doesNotMatch(sql, /\b(?:delete from|truncate public|drop table|update public\.diagnostic_results)\b/i);
  assert.doesNotMatch(sql, /set verification_status/i);
});

for (const language of ["en", "fil"] as const) {
  for (const kind of ["current", "old-id", "wrong-version", "missing-metadata", "other-language-id"] as const) {
    test(language + " completion checks active metadata: " + kind, async () => {
      const { repository, rows } = fixture();
      const active = diagnosticAssessmentRegistry[language]!;
      const assessmentId = kind === "old-id" ? "retired-assessment" : kind === "missing-metadata" ? undefined
        : kind === "other-language-id" ? diagnosticAssessmentRegistry[language === "en" ? "fil" : "en"]!.id : active.id;
      const assessmentVersion = kind === "wrong-version" ? "0.9" : kind === "missing-metadata" ? undefined : active.version;
      rows.push(activeRow(language, "server_verified", { assessment_id: assessmentId, assessment_version: assessmentVersion,
        orv_score: 95, comprehension_score: 80 }));
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
    const { repository, rows } = fixture();
    for (const [language, current] of [["en", englishCurrent], ["fil", filipinoCurrent]] as const) {
      rows.push(activeRow(language, "server_verified", current ? {} : { assessment_id: "retired-" + language }));
    }
    const completed = await repository.getCompletedDiagnosticLanguages();
    assert.deepEqual(completed, expected);
    assert.equal(getNextDiagnosticLanguage(completed), next);
    assert.equal(await repository.hasCompletedInitialDiagnostic(), englishCurrent && filipinoCurrent);
    assert.equal(await repository.hasCompletedInitialDiagnostic("en"), englishCurrent);
    assert.equal(await repository.hasCompletedInitialDiagnostic("fil"), filipinoCurrent);
  });
}
