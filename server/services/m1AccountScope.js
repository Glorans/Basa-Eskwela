// M1 account-management scope for the two administrator roles (Appendix N F6 view roles, F7 delete, F8 create
// School Admin). One policy for the server; the browser only displays what the server allows.
//
// Roles in profiles.role: system_admin (System Admin, platform level), admin (School Admin, the existing Admin),
// teacher, student, general_user (Independent Learner). A null role is an account that has not finished onboarding.
//
// School scope: the database has NO school relationship (no schools table, no profiles.school_id). Basa Eskwela is
// one school, so "the School Admin's school" is every school-associated account: Teachers and Students. Real
// multi-school isolation needs the relationship in docs/M1_SCHOOL_ISOLATION_PROPOSAL.md; it is not implemented here.
//
// Deny by default: a role or action that is not listed below is refused.

const SCHOOL_ROLES = Object.freeze(["teacher", "student"]);

const SCOPES = Object.freeze({
  // Platform level: sees every account; deletes platform-level accounts; creates School Admins.
  system_admin: Object.freeze({
    view: "all",
    deletable: Object.freeze(["general_user", "admin"]),
    canCreateSchoolAdmin: true,
  }),
  // School level: only school-associated accounts. Never Independent Learners, administrators or unassigned accounts.
  admin: Object.freeze({
    view: SCHOOL_ROLES,
    deletable: SCHOOL_ROLES,
    canCreateSchoolAdmin: false,
  }),
});

function getAccountScope(role) {
  return Object.prototype.hasOwnProperty.call(SCOPES, role) ? SCOPES[role] : null;
}

function isAccountManager(role) {
  return getAccountScope(role) !== null;
}

function canViewAccount(managerRole, targetRole) {
  const scope = getAccountScope(managerRole);
  if (!scope) return false;
  return scope.view === "all" || scope.view.includes(targetRole);
}

function canDeleteAccount({ managerRole, managerId, targetRole, targetId }) {
  const scope = getAccountScope(managerRole);
  if (!scope || !managerId || !targetId || managerId === targetId) return false;
  return scope.deletable.includes(targetRole);
}

/** What the signed-in manager may do, sent to the browser so it shows only allowed actions. */
function describePermissions(managerRole) {
  const scope = getAccountScope(managerRole);
  if (!scope) return null;
  return {
    role: managerRole,
    visibleRoles: scope.view === "all" ? ["system_admin", "admin", "teacher", "student", "general_user"] : [...scope.view],
    deletableRoles: [...scope.deletable],
    canCreateSchoolAdmin: scope.canCreateSchoolAdmin,
  };
}

module.exports = { SCHOOL_ROLES, canDeleteAccount, canViewAccount, describePermissions, getAccountScope, isAccountManager };
