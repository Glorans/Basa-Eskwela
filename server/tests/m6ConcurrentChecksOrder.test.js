// Performance review: M6 read-only checks now run together. Whatever order they finish in, the same
// check must win as in the original one-after-another code, and nothing is written unless all pass.
// Injected fake database only (no network). Each test controls how long each lookup takes and which fail.
const test = require("node:test");
const assert = require("node:assert/strict");
const supabaseAdmin = require("../services/supabaseAdmin");

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ATTEMPT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OTHER_ATTEMPT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ROOM = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const QUESTION = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const REQUEST = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const MODULE = "11111111-1111-4111-8111-111111111111";
const PASSAGE = "22222222-2222-4222-8222-222222222222";
const requester = { user: { id: USER }, profile: { id: USER, role: "student" } };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const owned = {
  id: ATTEMPT, user_id: USER, module_id: MODULE, passage_id: PASSAGE, room_id: ROOM, assignment_id: null,
  material_id: null, activity_assignment_id: null, status: "in_progress", created_at: "2026-11-02T00:00:00Z",
  passage_title: "Story", language: "en",
  question_snapshot: [{ id: QUESTION, type: "literal", questionText: "Who?", options: ["a", "b", "c", "d"], correctOptionIndex: 2, scaffoldingHint: "Look." }],
};

/** scenario[table] = { ms, result | error } per kind of read; writes and RPCs are recorded. */
function fakeDatabase(scenario) {
  const writes = [];
  const respond = async (spec) => {
    await sleep(spec?.ms ?? 0);
    if (spec?.throws) throw spec.throws;
    return spec?.result ?? { data: null, error: null };
  };
  const db = {
    writes,
    rpc: async (name, args) => { writes.push({ rpc: name, args }); return { data: { correct: false, resolved: true }, error: null }; },
    from(table) {
      let single = false;
      let updating = false;
      const query = {
        select() { return query; }, eq() { return query; }, is() { return query; }, in() { return query; },
        order() { return query; }, limit() { return query; },
        update(values) { updating = true; writes.push({ table, update: values }); return query; },
        maybeSingle() { single = true; return query; }, single() { single = true; return query; },
        then(resolve, reject) {
          const kind = updating ? "update" : table === "m6_comprehension_attempts" ? (single ? "owned" : "activity") : table;
          return respond(scenario[kind]).then(resolve, reject);
        },
      };
      return query;
    },
  };
  return db;
}

function load(scenario) {
  const db = fakeDatabase(scenario);
  supabaseAdmin.getSupabaseAdmin = () => db;
  // Fresh service modules bound to this fake (supabaseAdmin itself stays cached, holding the fake).
  const sep = require("node:path").sep;
  for (const key of Object.keys(require.cache)) {
    if (key.includes(`${sep}services${sep}`) && !key.endsWith(`${sep}supabaseAdmin.js`)) delete require.cache[key];
  }
  return { db, action: require("../services/comprehensionActionService"), attempts: require("../services/comprehensionAttemptService") };
}

const base = {
  owned: { result: { data: owned, error: null } },
  rooms: { result: { data: { archived_at: null }, error: null } },
  activity: { result: { data: [owned], error: null } },
  m6_comprehension_responses: { result: { data: [], error: null } },
};
const answer = { action: "answer", questionId: QUESTION, optionIndex: 1, requestId: REQUEST };
const conflict = { result: { data: [{ ...owned, id: OTHER_ATTEMPT, created_at: "2026-11-01T00:00:00Z" }, owned], error: null } };

test("an archived room still wins over a second assessment, even when the archive check finishes last", async () => {
  const { db, action } = load({ ...base, rooms: { ms: 40, result: { data: { archived_at: "2026-11-05T00:00:00Z" }, error: null } }, activity: { ms: 0, ...conflict } });
  await assert.rejects(action.applyComprehensionAction(requester, ATTEMPT, answer), (error) => error.statusCode === 409 && /archived/i.test(error.message));
  assert.deepEqual(db.writes, [], "nothing written");
});

test("a second assessment for the activity is refused before any write, whatever finishes first", async () => {
  for (const [activityMs, responsesMs] of [[0, 30], [30, 0]]) {
    const { db, action } = load({ ...base, activity: { ms: activityMs, ...conflict },
      m6_comprehension_responses: { ms: responsesMs, result: { data: null, error: { message: "down" } } } });
    await assert.rejects(action.applyComprehensionAction(requester, ATTEMPT, answer), /already has a comprehension assessment/);
    assert.deepEqual(db.writes, []);
  }
});

test("a failed archive check fails closed (no answer saved), as before", async () => {
  const { db, action } = load({ ...base, rooms: { ms: 20, result: { data: null, error: { code: "XX000", message: "down" } } } });
  await assert.rejects(action.applyComprehensionAction(requester, ATTEMPT, answer), (error) => error.statusCode === 503);
  assert.deepEqual(db.writes, []);
});

test("a question that already has a final answer is refused without a write (first-answer finality)", async () => {
  const saved = { id: "r1", question_id: QUESTION, first_option_index: 0, first_answer_correct: false, resolved: true, answer_history: [{ requestId: "earlier", optionIndex: 0 }] };
  const { db, action } = load({ ...base, m6_comprehension_responses: { ms: 15, result: { data: [saved], error: null } } });
  await assert.rejects(action.applyComprehensionAction(requester, ATTEMPT, answer), (error) => error.statusCode === 409 && /final answer/.test(error.message));
  assert.deepEqual(db.writes, []);
});

test("all checks passed: exactly one protected RPC, and the returned questions hide unanswered keys", async () => {
  const { db, action } = load(base);
  const result = await action.applyComprehensionAction(requester, ATTEMPT, answer);
  assert.deepEqual(db.writes.map((write) => write.rpc ?? write.table), ["m6_apply_action"]);
  assert.equal(result.outcome.final, true);
  assert.equal(result.attempt.questions[0].correctOptionIndex, null, "the fake saved no answer, so the key stays hidden");
});

test("opening an attempt: the activity lookup error wins over a faster deleted-material failure", async () => {
  const personal = { ...owned, room_id: null, module_id: null, passage_id: null, material_id: MODULE };
  const { attempts } = load({ ...base, owned: { result: { data: personal, error: null } },
    activity: { ms: 40, result: { data: null, error: { message: "down" } } },
    personal_material_state: { ms: 0, result: { data: null, error: { code: "XX000", message: "down" } } } });
  await assert.rejects(attempts.getComprehensionAttempt(requester, ATTEMPT), /Unable to check your comprehension activity/);
});

test("opening an attempt: an answers error wins over a faster deleted-material failure", async () => {
  const personal = { ...owned, room_id: null, module_id: null, passage_id: null, material_id: MODULE };
  const { attempts } = load({ ...base, owned: { result: { data: personal, error: null } }, activity: { result: { data: [personal], error: null } },
    m6_comprehension_responses: { ms: 40, result: { data: null, error: { message: "down" } } },
    personal_material_state: { ms: 0, result: { data: null, error: { code: "XX000", message: "down" } } } });
  await assert.rejects(attempts.getComprehensionAttempt(requester, ATTEMPT), /Unable to load your answers/);
});

test("opening someone else's attempt is refused and the early lookups are discarded", async () => {
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);
  try {
    const { attempts } = load({ ...base, owned: { result: { data: null, error: null } }, rooms: { ms: 5, throws: new Error("late failure") } });
    // `verified` names another user's row: it must not be trusted, and the owner check still refuses.
    await assert.rejects(attempts.getComprehensionAttempt(requester, ATTEMPT, { verified: { ...owned, user_id: "someone-else" } }), (error) => error.statusCode === 404);
    await assert.rejects(attempts.getComprehensionAttempt(requester, ATTEMPT, { verified: owned }), (error) => error.statusCode === 404);
    await sleep(20);
    assert.deepEqual(unhandled, []);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});
