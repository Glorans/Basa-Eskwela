import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { getLearnerPlacement } from "../src/modules/module3/services/learnerPlacement.ts";
import { INITIAL_DIAGNOSTIC_LINEAGE } from "../src/modules/module2/data/permanentInitialAssessments.ts";
import { loadComponentModule } from "./helpers/hookRuntime.ts";

// M2 x M3 placement integration (frontend). Synthetic data only; no network.
const require = createRequire(import.meta.url);
const src = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
const savedInitial = { result: { language: "en", readingLevel: "Frustration", difficultyTier: "Easy", assessmentId: "grade5-en-passage-v3", assessmentVersion: "3.0" } };
function legacy(calls: string[]) {
  return {
    hasCompletedInitialDiagnostic: async () => { calls.push("legacy completion"); return true; },
    getInitialDiagnosticResult: async () => { calls.push("legacy result"); return savedInitial as never; },
  };
}
const READY_FROM_SERVER = { status: "ready", language: "en", readingLevel: "Independent", difficultyTier: "Hard",
  assessmentId: "pkg", assessmentVersion: "1.0", source: "reassessment" } as const;

test("server placement is used when valid; the legacy lookup is not called", async () => {
  const calls: string[] = [];
  const placement = await getLearnerPlacement("en", legacy(calls), { getServerPlacement: async () => READY_FROM_SERVER as never });
  assert.equal(placement.status, "ready");
  assert.equal((placement as { readingLevel: string }).readingLevel, "Independent");
  assert.deepEqual(calls, []);
});

test("server 'missing' is respected (a learner without an official initial diagnostic gets no placement)", async () => {
  const calls: string[] = [];
  assert.deepEqual(await getLearnerPlacement("en", legacy(calls), { getServerPlacement: async () => ({ status: "missing", language: "en" }) }),
    { status: "missing", language: "en" });
  assert.deepEqual(calls, []);
});

test("server unavailable, wrong language or invalid -> today's direct lookup (same answer while no policy is approved)", async () => {
  for (const server of [
    { getServerPlacement: async () => { throw new Error("404 not deployed"); } },
    { getServerPlacement: async () => ({ ...READY_FROM_SERVER, language: "fil" }) as never },
    { getServerPlacement: async () => ({ ...READY_FROM_SERVER, difficultyTier: "Impossible" }) as never },
  ]) {
    const calls: string[] = [];
    const placement = await getLearnerPlacement("en", legacy(calls), server);
    assert.deepEqual(placement, { status: "ready", language: "en", readingLevel: "Frustration", difficultyTier: "Easy",
      assessmentId: "grade5-en-passage-v3", assessmentVersion: "3.0" });
    assert.deepEqual(calls, ["legacy completion", "legacy result"]);
  }
});

test("an injected legacy source alone keeps the original behaviour (no server call)", async () => {
  const calls: string[] = [];
  const placement = await getLearnerPlacement("en", legacy(calls));
  assert.equal(placement.status, "ready");
  assert.deepEqual(calls, ["legacy completion", "legacy result"]);
});

test("placement API: the learner's own placement by language; no learner id is sent", async () => {
  const calls: unknown[] = [];
  const mod = loadComponentModule(new URL("../src/modules/module3/services/placementApi.ts", import.meta.url), (id) => {
    if (id.endsWith("/services/api")) return { default: { get: async (url: string, config: unknown) => { calls.push([url, config]); return { data: { placement: { status: "missing", language: "fil" } } }; } } };
    if (id.endsWith("/services/authHeaders")) return { getSessionAuthHeaders: async () => ({ Authorization: "Bearer synthetic" }) };
    return require(id);
  });
  assert.deepEqual(JSON.parse(JSON.stringify(await mod.getServerPlacement("fil"))), { status: "missing", language: "fil" });
  assert.equal((calls[0] as [string])[0], "/api/diagnostic-history/placement/fil");
  assert.doesNotMatch(JSON.stringify(calls), /userId|studentId/);
});

test("initial completion is permanent for every version of the lineage; the pre-verification v2.0 is not part of it", () => {
  assert.deepEqual({ ...INITIAL_DIAGNOSTIC_LINEAGE }, { en: "grade5-en-passage-v3", fil: "grade5-fil-passage-v3" });
  const repo = src("modules/module2/services/diagnosticRepository.ts");
  assert.match(repo, /isOfficialInitialRow\(row\)/);
  assert.match(repo, /row\.assessment_id === INITIAL_DIAGNOSTIC_LINEAGE\[row\.language\]/);
  assert.doesNotMatch(src("modules/module2/data/permanentInitialAssessments.ts"), /sentences-v2|"2\.0"/);
});

test("F7 Practice Mode writes nothing that placement could read", () => {
  const practice = src("modules/module2/services/diagnosticPractice.ts");
  assert.doesNotMatch(practice, /supabase|diagnostic_results|saveInitialDiagnosticResult/);
});
