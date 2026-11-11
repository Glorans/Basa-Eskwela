// Performance: the profile read starts alongside Supabase Auth token verification, but only the VERIFIED
// user's profile is ever used. No network: injected fakes only.
const test = require("node:test");
const assert = require("node:assert/strict");
const { authorizeReadingPracticeRequest, authorizeOralReadingRequest } = require("../services/oralReadingAttemptService");

const VERIFIED = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const FUTURE = Math.floor(Date.now() / 1000) + 3600;
const tokenFor = (sub, exp = FUTURE) => `${b64({ alg: "none" })}.${b64({ sub, exp })}.unsigned`;
const request = (authorization) => ({ get: (name) => (name.toLowerCase() === "authorization" ? authorization : undefined) });
const profiles = {
  [VERIFIED]: { id: VERIFIED, role: "student", full_name: "Synthetic Learner" },
  [OTHER]: { id: OTHER, role: "admin", full_name: "Someone Else" },
};

function harness({ verifiedId = VERIFIED, authFails = false, profileThrows = null } = {}) {
  const events = [];
  let releaseAuth;
  const authGate = new Promise((resolve) => { releaseAuth = resolve; });
  const deps = {
    getAuthenticatedSupabaseUser: async () => {
      events.push("auth:start");
      await authGate;
      events.push("auth:done");
      if (authFails) throw Object.assign(new Error("Invalid token"), { statusCode: 401 });
      return { id: verifiedId };
    },
    getSupabaseAdmin: () => ({
      from: (table) => {
        assert.equal(table, "profiles");
        let id;
        const query = {
          select() { return query; },
          eq(column, value) { assert.equal(column, "id"); id = value; return query; },
          async single() { events.push(`profile:${id}`); if (profileThrows) throw profileThrows; return { data: profiles[id] ?? null, error: null }; },
        };
        return query;
      },
    }),
  };
  return { deps, events, releaseAuth };
}

test("the profile read overlaps token verification when the token's subject is the verified user", async () => {
  const { deps, events, releaseAuth } = harness();
  const pending = authorizeReadingPracticeRequest(request(`Bearer ${tokenFor(VERIFIED)}`), deps);
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(events.includes(`profile:${VERIFIED}`), "profile read started before verification finished");
  assert.ok(!events.includes("auth:done"));
  releaseAuth();
  const requester = await pending;
  assert.equal(requester.user.id, VERIFIED);
  assert.equal(requester.profile.role, "student");
  assert.equal(events.filter((event) => event.startsWith("profile:")).length, 1, "one profile read, not two");
});

test("a token claiming another user never lends that user's profile", async () => {
  // Supabase Auth verifies VERIFIED, while the (forged or stale) claim names OTHER, an Admin.
  const { deps, events, releaseAuth } = harness({ verifiedId: VERIFIED });
  const pending = authorizeOralReadingRequest(request(`Bearer ${tokenFor(OTHER)}`), deps);
  releaseAuth();
  const requester = await pending;
  assert.equal(requester.user.id, VERIFIED);
  assert.equal(requester.profile.id, VERIFIED, "the verified user's own profile");
  assert.equal(requester.profile.role, "student", "never the claimed Admin role");
  assert.ok(events.indexOf(`profile:${VERIFIED}`) > events.indexOf("auth:done"), "reloaded for the verified user");
});

test("a rejected token is refused and its early profile read is discarded", async () => {
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);
  try {
    const { deps, releaseAuth } = harness({ authFails: true });
    const pending = authorizeReadingPracticeRequest(request(`Bearer ${tokenFor(OTHER)}`), deps);
    releaseAuth();
    await assert.rejects(pending, /Invalid token/);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(unhandled, []);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});

test("tokens that are not JWTs, or name no valid subject, use the original sequential read", async () => {
  const expired = `Bearer ${tokenFor(VERIFIED, Math.floor(Date.now() / 1000) - 60)}`;
  const noExpiry = `Bearer ${b64({ alg: "none" })}.${b64({ sub: VERIFIED })}.unsigned`;
  for (const authorization of ["Bearer opaque-token", `Bearer ${tokenFor("not-a-uuid")}`, "Bearer a.%%%.c", expired, noExpiry, undefined]) {
    const { deps, events, releaseAuth } = harness();
    const pending = authorizeReadingPracticeRequest(request(authorization), deps);
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(!events.some((event) => event.startsWith("profile:")), `no early read for ${authorization}`);
    releaseAuth();
    assert.equal((await pending).profile.id, VERIFIED);
  }
});

test("a failing early profile read is reported exactly as the sequential read was", async () => {
  const failure = Object.assign(new Error("connection reset"), { statusCode: 503 });
  const { deps, releaseAuth } = harness({ profileThrows: failure });
  const pending = authorizeReadingPracticeRequest(request(`Bearer ${tokenFor(VERIFIED)}`), deps);
  releaseAuth();
  await assert.rejects(pending, (error) => error === failure, "the same error object propagates, not a new 500");
});

test("a valid-looking forged token starts at most one profile read and is refused", async () => {
  const { deps, events, releaseAuth } = harness({ authFails: true });
  const pending = authorizeReadingPracticeRequest(request(`Bearer ${tokenFor(OTHER)}`), deps);
  releaseAuth();
  await assert.rejects(pending, (error) => !("profile" in error) && !/Someone Else|admin/.test(error.message));
  assert.equal(events.filter((event) => event.startsWith("profile:")).length, 1, "bounded: one primary-key read per request");
});
