import assert from "node:assert/strict";
import test from "node:test";
import { createDailyLoginClaimer, isDailyLoginRole, manilaDate } from "../src/services/dailyLoginClaim.ts";

test("only Students and Independent Learners make the call", () => {
  assert.equal(isDailyLoginRole("student"), true);
  assert.equal(isDailyLoginRole("general_user"), true);
  for (const role of ["teacher", "admin", null, undefined, ""]) assert.equal(isDailyLoginRole(role), false);
});

test("the day changes at midnight in Manila, whatever the device's time zone", () => {
  assert.equal(manilaDate(new Date("2026-11-07T15:59:59Z")), "2026-11-07");
  assert.equal(manilaDate(new Date("2026-11-07T16:00:00Z")), "2026-11-08");
});

test("one tab makes one call per user per Manila day; a failure tries again; the date is never sent", async () => {
  let now = new Date("2026-11-07T01:00:00Z");
  const sent: unknown[][] = [];
  let fail = false;
  const claim = createDailyLoginClaimer(async (...args: unknown[]) => {
    sent.push(args);
    if (fail) throw new Error("offline");
  }, () => now);

  await Promise.all([claim("a"), claim("a"), claim("a")]);
  await claim("a");
  assert.equal(sent.length, 1, "duplicates and refreshes in this tab do not repeat the call");

  await claim("b");
  assert.equal(sent.length, 2, "another account on the same tab");

  now = new Date("2026-11-07T16:00:00Z");
  fail = true;
  await assert.doesNotReject(claim("b"), "a failure never reaches the page");
  assert.equal(sent.length, 3);
  fail = false;
  await claim("b");
  assert.equal(sent.length, 4, "tries again after a failure");
  await claim("b");
  assert.equal(sent.length, 4);
  assert.ok(sent.every((args) => args.length === 0), "nothing from the browser goes into the request");
});
