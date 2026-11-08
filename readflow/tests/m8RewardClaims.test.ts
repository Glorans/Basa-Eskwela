import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { badgeState, claimErrorMessage, milestoneTiers } from "../src/modules/module8/achievements.ts";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

test("badge state: Locked, Ready to claim, Claimed", () => {
  assert.equal(badgeState({ eligible: false, claimed_at: null }), "locked");
  assert.equal(badgeState({ eligible: true, claimed_at: null }), "ready");
  assert.equal(badgeState({ eligible: true, claimed_at: "2026-11-09T01:00:00Z" }), "claimed");
  // A claim stands even if the rule would no longer be met (for example, Graduate after a new module).
  assert.equal(badgeState({ eligible: false, claimed_at: "2026-11-09T01:00:00Z" }), "claimed");
});

test("achievement tiers are independent: reaching never claims, claiming one claims no other", () => {
  const row = { achievement_id: "comprehension_star", bronze_at: "2026-11-01T00:00:00Z", silver_at: "2026-11-05T00:00:00Z", gold_at: null };
  const none = milestoneTiers(row, []);
  assert.deepEqual(none.map((t) => [t.key, t.target, t.state]), [["bronze", 3, "ready"], ["silver", 10, "ready"], ["gold", 25, "locked"]]);
  const silverOnly = milestoneTiers(row, [{ achievement_id: "comprehension_star", tier: "silver", claimed_at: "2026-11-09T00:00:00Z" }]);
  assert.deepEqual(silverOnly.map((t) => t.state), ["ready", "claimed", "locked"]);
  assert.equal(silverOnly[1].claimedAt, "2026-11-09T00:00:00Z");
  // Another achievement's claim does not count.
  const other = milestoneTiers(row, [{ achievement_id: "accurate_reader", tier: "bronze", claimed_at: "2026-11-09T00:00:00Z" }]);
  assert.equal(other[0].state, "ready");
});

test("before claiming is deployed, a reached tier shows as earned with its date", () => {
  const tiers = milestoneTiers({ achievement_id: "accurate_reader", bronze_at: "2026-11-01T00:00:00Z", silver_at: null, gold_at: null }, null);
  assert.deepEqual(tiers.map((t) => t.state), ["claimed", "locked", "locked"]);
  assert.equal(tiers[0].claimedAt, "2026-11-01T00:00:00Z");
});

test("refused claims get learner-friendly messages", () => {
  assert.match(claimErrorMessage({ code: "55000" }), /still locked/);
  assert.match(claimErrorMessage({ code: "42501" }), /Students and Independent Learners/);
  assert.match(claimErrorMessage(new Error("network")), /try again/);
});

test("claims go only through the database functions, and only when the learner presses Claim", async () => {
  const [service, page] = await Promise.all([read("../src/modules/module8/gamificationService.ts"), read("../src/pages/MyBadges.tsx")]);
  for (const rpc of ['"m8_my_badges"', '"m8_claim_badge"', '"m8_my_achievement_claims"', '"m8_claim_achievement"']) assert.ok(service.includes(rpc), rpc);
  assert.doesNotMatch(service, /from\("m8_(badge|achievement)_claims"\)/, "no direct table access");
  assert.doesNotMatch(service, /\.(insert|upsert|update|delete)\(/, "the client writes no reward rows");
  // The claim functions are called from the click handlers only, never while loading.
  const load = page.slice(page.indexOf("async function loadGamification"), page.indexOf("void loadGamification()"));
  assert.doesNotMatch(load, /claimBadge|claimAchievement/);
  assert.match(page, /onClaim: \(\) => void handleClaimBadge\(badge\)/);
  assert.match(page, /onClaim: \(\) => void handleClaimTier\(/);
  // Locked, Claim and Claimed are all shown, and the card updates without a reload.
  assert.match(page, /<span>Locked<\/span>/);
  assert.match(page, /\{busy \? "Claiming\.\.\." : "Claim"\}/);
  assert.match(page, /state: "claimed", claimed_at: claimedAt/);
  assert.match(page, /aria-live="polite"/);
  assert.doesNotMatch(page, /window\.location\.reload|location\.reload/);
  // A rapid double-click sends one claim; a claim refused as locked turns the card back to Locked.
  assert.match(page, /if \(claimInFlight\.current\) return;\s+claimInFlight\.current = true;/);
  assert.match(page, /if \(isLockedError\(err\)\)/);
  // Badges awarded before claiming began show their award date as "Awarded", manual claims as "Claimed".
  assert.match(page, /claiming \? \(badge\.preserved \? "Awarded" : "Claimed"\) : "Earned"/);
});

test("before claiming is deployed, the page keeps the earlier display", async () => {
  const service = await read("../src/modules/module8/gamificationService.ts");
  assert.match(service, /if \(claimResult\.error && !isMissingFunction\(claimResult\.error\)\)/);
  assert.match(service, /state: earnedMap\.has\(badge\.id\) \? "claimed" : "locked"/);
});
