// Performance: the M6 owned-attempt read starts while the login is verified. It filters by the token's
// unverified subject and is used only when the verified user is that subject; a reload after an action
// always reads again. In-memory fakes only (no network).
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const supabaseAdmin = require("../services/supabaseAdmin");

const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ATTEMPT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const request = (sub, exp = Math.floor(Date.now() / 1000) + 3600) => ({
  get: (name) => (name.toLowerCase() === "authorization" ? `Bearer ${b64({ alg: "none" })}.${b64({ sub, exp })}.unsigned` : undefined),
});

function fresh(rowsByUser) {
  const reads = [];
  supabaseAdmin.getSupabaseAdmin = () => ({
    from(table) {
      const filters = {};
      const query = {
        select() { return query; }, in() { return query; }, is() { return query; },
        eq(key, value) { filters[key] = value; return query; },
        async maybeSingle() {
          if (table !== "m6_comprehension_attempts") return { data: null, error: null };
          reads.push({ ...filters }); const row = rowsByUser[filters.user_id]; return { data: row && row.id === filters.id ? row : null, error: null };
        },
        // List reads (activity lookup, responses): nothing saved.
        then(resolve, reject) { return Promise.resolve({ data: [], error: null }).then(resolve, reject); },
      };
      return query;
    },
  });
  const sep = path.sep;
  for (const key of Object.keys(require.cache)) if (key.includes(`${sep}services${sep}`) && !key.endsWith(`${sep}supabaseAdmin.js`)) delete require.cache[key];
  return { reads, service: require("../services/comprehensionAttemptService") };
}

test("the prefetch reads only the claimed owner's attempt and is reused for that verified owner", async () => {
  const { reads, service } = fresh({ [OWNER]: { id: ATTEMPT, user_id: OWNER } });
  const prefetched = service.prefetchOwnedAttempt(request(OWNER), ATTEMPT);
  assert.ok(prefetched);
  await prefetched.pending;
  assert.deepEqual(reads, [{ id: ATTEMPT, user_id: OWNER }], "same filters as loadOwnedAttempt");
  const row = await service.loadOwnedAttempt({ user: { id: OWNER } }, ATTEMPT, prefetched);
  assert.equal(row.id, ATTEMPT);
  assert.equal(reads.length, 1, "no second read");
});

test("a token claiming another user never lends that user's attempt", async () => {
  // The verified user is OWNER, but the (forged or stale) token names OTHER, who owns the attempt.
  const { reads, service } = fresh({ [OTHER]: { id: ATTEMPT, user_id: OTHER } });
  const prefetched = service.prefetchOwnedAttempt(request(OTHER), ATTEMPT);
  await assert.rejects(service.loadOwnedAttempt({ user: { id: OWNER } }, ATTEMPT, prefetched), (error) => error.statusCode === 404);
  assert.ok(reads.some((read) => read.user_id === OWNER && read.id === ATTEMPT), "read again for the verified user, who owns nothing");
});

test("no prefetch for expired or non-JWT tokens or invalid attempt ids", () => {
  const { service } = fresh({});
  assert.equal(service.prefetchOwnedAttempt(request(OWNER, Math.floor(Date.now() / 1000) - 5), ATTEMPT), null);
  assert.equal(service.prefetchOwnedAttempt({ get: () => "Bearer opaque" }, ATTEMPT), null);
  assert.equal(service.prefetchOwnedAttempt({ get: () => undefined }, ATTEMPT), null);
  assert.equal(service.prefetchOwnedAttempt(request(OWNER), "not-an-id"), null);
});

test("a reload after an action ignores the prefetch and reads the attempt again", async () => {
  const { reads, service } = fresh({ [OWNER]: { id: ATTEMPT, user_id: OWNER, status: "in_progress", question_snapshot: [] } });
  const prefetched = service.prefetchOwnedAttempt(request(OWNER), ATTEMPT);
  await prefetched.pending;
  const before = reads.length;
  // getComprehensionAttempt with `verified` (the post-action reload) must not reuse the pre-action read.
  await service.getComprehensionAttempt({ user: { id: OWNER } }, ATTEMPT, { verified: { id: ATTEMPT, user_id: OWNER }, prefetched }).catch(() => {});
  assert.ok(reads.length > before, "the attempt row was read again");
});
