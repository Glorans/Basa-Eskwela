import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("Terms and Privacy pages are public, keep the review status, and match today's data (no age)", () => {
  const app = read("App.tsx");
  assert.match(app, /<Route path="\/terms" element=\{<TermsPage \/>\} \/>/);
  assert.match(app, /<Route path="\/privacy" element=\{<PrivacyPage \/>\} \/>/);
  const privacy = read("pages/PrivacyPage.tsx");
  assert.doesNotMatch(privacy, /your age/, "Age was removed from every role");
  assert.match(privacy, /<KidsPrivacySummary \/>/, "child-friendly summary first");
  assert.match(privacy, /not a parent's or guardian's consent/);
  for (const page of ["pages/PrivacyPage.tsx", "pages/TermsPage.tsx"]) assert.match(read(page), /POLICY_REVIEW_STATUS/);
  assert.match(read("pages/policyStatus.ts"), /DRAFT, AWAITING APPROVAL/);
  assert.match(read("pages/TermsPage.tsx"), /<h1>Terms of Use<\/h1>/);
  assert.match(privacy, /<h1>Privacy Notice<\/h1>/);
});

test("the I Agree step records an acknowledgment only, for the version the database decides", () => {
  const page = read("modules/module1/pages/PolicyAcknowledgmentPage.tsx");
  assert.match(page, /It is not a\s+parent&apos;s or guardian&apos;s consent/);
  assert.match(page, /acknowledgePolicy\(user\.id, status\.version\)/, "sends only the version it was shown");
  const service = read("modules/module1/services/policyAcknowledgment.ts");
  assert.match(service, /"m1_my_policy_status"/);
  assert.match(service, /"m1_acknowledge_policy" as never, \{ p_version: version \} as never/);
  assert.match(service, /state: "unavailable"/, "without the migration, sign-in continues as before");
  const gate = read("components/auth/RequireAuth.tsx");
  assert.match(gate, /onboardingPath === null && location\.pathname !== ACK_PATH/, "after profile setup, never a loop");
});

test("the acknowledgment SQL never creates records automatically and never calls itself consent", () => {
  const sql = readFileSync(new URL("../../supabase/proposed/m1_policy_acknowledgment_v1_PROPOSED.sql", import.meta.url), "utf8");
  assert.match(sql, /NOT\s+(?:--\s+)?verified parent or guardian\s+(?:--\s+)?consent/);
  assert.doesNotMatch(sql, /insert into public\.m1_policy_acknowledgments\s*\(user_id, policy_version\)\s*select/i, "no backfill");
  assert.match(sql, /if v_version is null or p_version is distinct from v_version then/, "only the ACTIVE version");
  assert.match(sql, /INSERT INTO public\.m1_policy_versions \(version, status\) VALUES \('2026-11-draft-1', 'draft'\);/, "draft registered, not activated");
  assert.doesNotMatch(sql, /is_active\s*=\s*true|VALUES \([^)]*true/, "the migration activates nothing");
  assert.match(sql, /policy_status text NOT NULL CHECK \(policy_status IN \('draft', 'approved'\)\)/, "draft and approved acknowledgments kept apart");
  assert.match(sql, /CREATE TRIGGER m1_policy_ack_immutable BEFORE UPDATE/, "acknowledgments are never edited");
});

test("the service never reports a save that the database did not confirm, and the page offers a way out", () => {
  const service = read("modules/module1/services/policyAcknowledgment.ts");
  assert.match(service, /if \(error \|\| !row\?\.acknowledged_at\) \{/);
  assert.doesNotMatch(service, /new Date\(\)\.toISOString\(\)/, "no invented timestamp");
  assert.match(service, /versionStatus: versionStatus\(row\.policy_status\)/);
  const page = read("modules/module1/pages/PolicyAcknowledgmentPage.tsx");
  assert.match(page, /Not now, log out/);
  assert.match(page, /it is not acceptance of an approved policy/, "draft review is labelled as such");
  assert.match(page, /role="alert"/, "save errors are shown");
});

test("the policy text describes today's system (leaderboard choices, speech and question services, school separation)", () => {
  const privacy = read("pages/PrivacyPage.tsx");
  assert.match(privacy, /Microsoft Azure Speech receives oral reading audio/);
  assert.match(privacy, /Google Gemini receives the text of reading materials/);
  assert.match(privacy, /Each Student can choose to show their classroom nickname \(when switched on\), stay a \\"Reader\\", or hide/);
  assert.match(privacy, /Each school's information is kept separate/);
  assert.doesNotMatch(privacy, /show a shortened form of each Student's nickname \(for example/, "old automatic-nickname wording removed");
  assert.match(privacy, /no additional moderation service is used/);
  assert.match(read("pages/KidsPrivacySummary.tsx"), /you can choose to stay a \\"Reader\\" or hide/);
  assert.match(read("pages/TermsPage.tsx"), /This automatic check is preliminary/);
});

test("corrected policy statements match the implementation (2026-11-22 policy review)", () => {
  const terms = read("pages/TermsPage.tsx");
  const privacy = read("pages/PrivacyPage.tsx");
  const kids = read("pages/KidsPrivacySummary.tsx");
  // One name for the notice everywhere.
  for (const text of [terms, privacy, kids]) assert.doesNotMatch(text, /Privacy Policy/);
  // Teacher invitation + School Admin approval (register_teacher_with_invite, review_teacher_registration).
  assert.match(terms, /Teachers, who join with an invitation code from their school and are approved by a School Admin of that school/);
  // Deactivation keeps records; no permanent deletion is promised (DELETE /api/admin/users answers 410).
  assert.match(terms, /its existing records, including learning records and recordings, are kept\. Permanent account deletion is not available/);
  assert.match(privacy, /Deactivating an account stops it from being used but does not delete its existing records/);
  // Independent Learner removal vs staff deletion vs module Trash.
  for (const text of [terms, privacy]) {
    assert.match(text, /can be permanently deleted only if no reading module uses it/);
    assert.match(text, /first moved to the Trash and can be permanently deleted only if no learner has used them/);
  }
  assert.match(terms, /every user is asked to read it and press \\"I Agree\\" once/);
  // Nickname switches are platform-wide and set by the project team, never "the school allows".
  for (const text of [privacy, kids]) assert.doesNotMatch(text, /school (has allowed|allows)/);
  assert.match(privacy, /switches them on for the whole platform after the required approval; this switch is currently off/);
  // System Admin account list and Independent Learner view are disclosed.
  assert.match(privacy, /can see the list of all accounts on the platform \(email address, name or nickname, role and school\)/);
  assert.match(privacy, /not the text or titles of the learner's own uploaded materials/);
  // G1 (verified locally): Teachers see own-classroom work and enrolled Students' diagnostics, never personal practice.
  assert.match(privacy, /Teachers do not see reading or quiz practice that a Student does on their own, outside a Learning Room/);
  // M7 suggestions are rule-based, never described as AI.
  assert.match(privacy, /no AI service is used for them/);
  assert.doesNotMatch(privacy, /AI-generated suggestions|suggestions (are )?generated by AI/);
  // Hashed credentials; Sign Up + first-login acknowledgment; draft never counts.
  assert.match(privacy, /stores passwords only in scrambled, hashed form/);
  assert.match(privacy, /When you create an account, you tick/);
  assert.match(privacy, /Agreeing to a draft version never counts as agreeing to an approved version/);
  // Guardian authorization: neutral, pending, and no claim that consent forms exist.
  assert.doesNotMatch(privacy, /consent forms/);
  for (const text of [terms, privacy]) assert.match(text, /handled separately from (the|this) acknowledgment[^"]*The process for this, and who keeps its records, have not yet been confirmed/);
  assert.match(privacy, /does not give permission to show or publish a child's name, picture, voice or other information/);
  // Retention: no invented period, no promised automatic deletion.
  assert.match(privacy, /no automatic retention or deletion schedule/);
  assert.doesNotMatch(privacy, /\b\d+\s*(days|months|years)\b/, "no retention period invented");
  // No controller invented.
  assert.match(privacy, /have not yet been confirmed\. They will be published here once confirmed and approved/);
});

test("Sign Up has a required, unticked Terms/Privacy checkbox between Confirm Password and Sign Up", () => {
  const page = read("modules/module1/pages/SignupPage.tsx");
  assert.match(page, /const \[agreed, setAgreed\] = useState\(false\);/, "unchecked by default");
  const confirm = page.indexOf('id="confirmPassword"');
  const box = page.indexOf('id="policyAgree"');
  const button = page.indexOf('label="Sign Up"');
  assert.ok(confirm > 0 && confirm < box && box < button, "checkbox sits below Confirm Password and above Sign Up");
  assert.match(page, /I have read and agree to the\{" "\}/);
  assert.match(page, /<a href="\/terms" target="_blank" rel="noreferrer"[^>]*>Terms of Use/, "new tab keeps the typed details");
  assert.match(page, /<a href="\/privacy" target="_blank" rel="noreferrer"[^>]*>Privacy Notice/);
  assert.match(page, /if \(!agreed\) \{\n\s+setAgreeError\(true\);\n\s+setError\(AGREE_MESSAGE\);/, "blocked when unchecked");
  assert.ok(page.indexOf("if (!agreed)") < page.indexOf("await register("), "checked before any account is created");
  assert.match(page, /Please tick the box to show you have read the Terms of Use and Privacy Notice\./);
});

test("the ticked box is saved only through the account's own session, for the version the database says is active", () => {
  const page = read("modules/module1/pages/SignupPage.tsx");
  const noSession = page.indexOf("if (!hasSession)");
  const save = page.indexOf("await acknowledgePolicyAtSignup();");
  assert.ok(noSession > 0 && save > noSession, "no session (email confirmation) -> nothing saved, first login asks");
  const service = read("modules/module1/services/policyAcknowledgment.ts");
  const fn = service.slice(service.indexOf("export async function acknowledgePolicyAtSignup"), service.indexOf("export function forgetPolicyStatus"));
  assert.match(fn, /if \(status\.state !== "required"\) return false;/, "no active version -> nothing recorded");
  assert.match(fn, /await acknowledgePolicy\(userId, status\.version\);/, "only the server's active version");
  assert.match(fn, /catch \{\n\s+return false;/, "a failed save falls back to the first-login screen");
  assert.doesNotMatch(fn, /approved/, "the page never claims a status; the database records draft or approved");
});
