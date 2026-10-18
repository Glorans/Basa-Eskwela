// Read-only validation against existing accounts. Prints aggregate counts, not PII.
require("dotenv").config({ quiet: true });
const assert = require("node:assert/strict");
const { listManagedUsers } = require("../services/adminUserService");
const { getProfileDisplayName: backendName } = require("../services/profileNames");

async function main() {
  const { getProfileDisplayName, isLegacyProfileName } = await import("../../readflow/src/modules/module1/utils/profileFields.ts");
  const { requiresProfileSetup } = await import("../../readflow/src/modules/module1/utils/authOnboarding.ts");
  const { filterManagedUsers, getManagedUserDisplayName } = await import("../../readflow/src/modules/module1/pages/admin/userManagementFilters.ts");
  const users = await listManagedUsers();
  const summary = { accounts: users.length, roles: {}, legacyNames: 0, legacyLearnersRequiringSetup: 0, missingDisplayNames: 0 };
  for (const user of users) {
    const profile = { role: user.role, nickname: user.nickname, full_name: user.fullName };
    const name = getProfileDisplayName(profile);
    assert.equal(isLegacyProfileName(name), false);
    assert.equal(name, backendName(user) || "\u2014");
    assert.equal(name, getManagedUserDisplayName(user));
    for (const searchQuery of [user.nickname, user.fullName, user.email].filter(value => value?.trim())) {
      assert.ok(filterManagedUsers(users, { searchQuery, role: "", status: "" }).some(match => match.id === user.id));
    }
    const legacy = isLegacyProfileName(user.nickname) || isLegacyProfileName(user.fullName);
    const needsSetup = requiresProfileSetup(user.role, user.nickname, user.fullName);
    const role = user.role || "missing";
    summary.roles[role] ??= { count: 0, validPreferredNames: 0, requiresSetup: 0, legacyNames: 0 };
    summary.roles[role].count++;
    if (needsSetup) summary.roles[role].requiresSetup++;
    const preferred = ["student", "general_user"].includes(role) ? user.nickname : user.fullName;
    if (preferred?.trim() && !isLegacyProfileName(preferred)) {
      assert.equal(name, preferred.trim());
      summary.roles[role].validPreferredNames++;
    }
    if (legacy) { summary.legacyNames++; summary.roles[role].legacyNames++; }
    if (legacy && needsSetup && ["student", "general_user"].includes(role)) summary.legacyLearnersRequiringSetup++;
    if (name === "\u2014") summary.missingDisplayNames++;
  }
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
