// M3 placement integration (server). Synthetic data and a minimal fake database only.
const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const express = require("express");
const { getPlacement } = require("../services/currentReadingLevelService");
const { PERMANENT_INITIAL_ASSESSMENTS, isOfficialInitialResult } = require("../services/initialDiagnosticCompletion");
const { createDiagnosticHistoryRouter } = require("../routes/diagnosticHistory");

const U = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
const row = (extra = {}) => ({ id: "i1", user_id: U, assessment_type: "initial", language: "en", assessment_id: "grade5-en-passage-v3",
  assessment_version: "3.0", reading_level: "Frustration", difficulty_tier: "Easy", verification_status: "server_verified", verified_at: "2026-10-01T00:00:00Z", ...extra });

function fakeDb({ rows = [], settings = { data: { placement_follows_reassessment: false }, error: null }, current = null } = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      const filters = [];
      const q = {
        select() { return q; },
        eq(c, v) { filters.push((r) => r[c] === v); return q; },
        maybeSingle() { calls.push(table); return Promise.resolve(settings); },
        then(res, rej) { calls.push(table); return Promise.resolve({ data: rows.filter((r) => filters.every((f) => f(r))), error: null }).then(res, rej); },
      };
      return q;
    },
    rpc(name) { calls.push(name); return Promise.resolve({ data: current ? [current] : [], error: null }); },
  };
}
const REASSESSMENT = { result_id: "r1", assessment_type: "reassessment", reading_level: "Independent", difficulty_tier: "Hard",
  assessment_id: "pkg", assessment_version: "1.0", package_version_id: "v1", verified_at: "2026-11-19T00:00:00Z" };

test("no official initial result -> missing; the pre-verification v2.0 never counts (existing rule kept)", async () => {
  assert.deepEqual(await getPlacement(U, "en", { getAdmin: () => fakeDb() }), { status: "missing", language: "en" });
  const v2 = fakeDb({ rows: [row({ assessment_id: "grade5-en-sentences-v2", assessment_version: "2.0" })] });
  assert.deepEqual(await getPlacement(U, "en", { getAdmin: () => v2 }), { status: "missing", language: "en" });
});

test("switch OFF (default, D1 pending): placement = the latest official initial result, exactly as today", async () => {
  const db = fakeDb({ rows: [row(), row({ id: "o", user_id: OTHER, reading_level: "Independent", difficulty_tier: "Hard" })], current: REASSESSMENT });
  const p = await getPlacement(U, "en", { getAdmin: () => db });
  assert.deepEqual(p, { status: "ready", language: "en", readingLevel: "Frustration", difficultyTier: "Easy", assessmentId: "grade5-en-passage-v3",
    assessmentVersion: "3.0", source: "initial", followsReassessment: false });
  assert.equal(db.calls.includes("m2_current_reading_level"), false, "the reassessment level is not even read while the switch is off");
});

test("switch not installed (column or table missing): today's behaviour; other settings errors fail closed", async () => {
  for (const code of ["42703", "PGRST204", "42P01", "PGRST205"]) {
    const p = await getPlacement(U, "en", { getAdmin: () => fakeDb({ rows: [row()], settings: { data: null, error: { code } } }) });
    assert.deepEqual([p.status, p.source, p.readingLevel], ["ready", "initial", "Frustration"], code);
  }
  await assert.rejects(getPlacement(U, "en", { getAdmin: () => fakeDb({ rows: [row()], settings: { data: null, error: { code: "XX000" } } }) }), /Unable to load/);
});

test("switch ON (only after an approved D1): a recorded reassessment becomes the placement; otherwise the initial stays", async () => {
  const on = { data: { placement_follows_reassessment: true }, error: null };
  const withRe = await getPlacement(U, "en", { getAdmin: () => fakeDb({ rows: [row()], settings: on, current: REASSESSMENT }) });
  assert.deepEqual([withRe.source, withRe.readingLevel, withRe.difficultyTier], ["reassessment", "Independent", "Hard"]);
  const initialOnly = await getPlacement(U, "en", { getAdmin: () => fakeDb({ rows: [row()], settings: on, current: { ...REASSESSMENT, assessment_type: "initial" } }) });
  assert.equal(initialOnly.source, "initial");
  // Completion still comes from the initial diagnostic: a reassessment alone never creates placement.
  assert.deepEqual(await getPlacement(U, "en", { getAdmin: () => fakeDb({ settings: on, current: REASSESSMENT }) }), { status: "missing", language: "en" });
});

test("every version of the initial lineage counts (no forced retake after activation); v2.0 never does", () => {
  assert.equal(isOfficialInitialResult(row()), true);
  assert.equal(isOfficialInitialResult(row({ assessment_version: "4.0" })), true, "any version of the lineage (e.g. an activated 4.0) counts");
  assert.equal(isOfficialInitialResult(row({ assessment_id: "grade5-en-sentences-v2", assessment_version: "2.0" })), false, "v2.0 is not part of the lineage");
  assert.equal(isOfficialInitialResult(row({ assessment_version: "0.9" })), false, "never a version before 3.0");
  assert.equal(isOfficialInitialResult(row({ assessment_version: "3.0-beta" })), false, "never an unrecognised label");
  assert.equal(isOfficialInitialResult(row({ verification_status: "unverified" })), false);
  assert.equal(isOfficialInitialResult(row({ assessment_type: "reassessment" })), false);
  assert.deepEqual(PERMANENT_INITIAL_ASSESSMENTS.map((a) => `${a.language}:${a.id}`), ["en:grade5-en-passage-v3", "fil:grade5-fil-passage-v3"]);
});

test("the server and frontend initial lineage ids are identical", () => {
  const ts = readFileSync(resolve(__dirname, "../../readflow/src/modules/module2/data/permanentInitialAssessments.ts"), "utf8");
  const listed = [...ts.matchAll(/^\s+(en|fil): "([^"]+)",$/gm)].map((m) => `${m[1]}:${m[2]}`);
  assert.deepEqual(listed, PERMANENT_INITIAL_ASSESSMENTS.map((a) => `${a.language}:${a.id}`));
});

test("F7 Practice Mode cannot affect placement: the practice service has no database access", () => {
  const practice = readFileSync(resolve(__dirname, "../services/diagnosticPracticeService.js"), "utf8");
  assert.doesNotMatch(practice, /getSupabaseAdmin|\.from\(|\.rpc\(|insert\(/);
});

async function call(router, path) {
  const app = express();
  app.use("/api/diagnostic-history", router);
  const server = app.listen(0);
  try {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api/diagnostic-history${path}`);
    return { status: r.status, body: await r.json() };
  } finally { server.close(); }
}

test("route: learners only, own placement, valid language", async () => {
  const seen = [];
  const learner = createDiagnosticHistoryRouter({ authorizeLearner: async () => ({ user: { id: U }, profile: { role: "general_user" } }),
    getPlacement: async (user, language) => { seen.push([user, language]); return { status: "missing", language }; } });
  const ok = await call(learner, "/placement/fil?userId=" + OTHER);
  assert.deepEqual([ok.status, ok.body.placement], [200, { status: "missing", language: "fil" }]);
  assert.deepEqual(seen, [[U, "fil"]], "the learner id comes from the session");
  assert.equal((await call(learner, "/placement/es")).status, 400);
  const teacher = createDiagnosticHistoryRouter({ authorizeLearner: async () => ({ user: { id: U }, profile: { role: "teacher" } }), getPlacement: async () => ({}) });
  assert.equal((await call(teacher, "/placement/en")).status, 403);
});
