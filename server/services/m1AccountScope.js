// M1 account-management scope for the two administrator roles (Appendix N F6 view roles, F7 delete, F8 create
// School Admin). One policy for the server; the browser only displays what the server allows.
//
// Roles in profiles.role: system_admin (System Admin, platform level), admin (School Admin, the existing Admin),
// teacher, student, general_user (Independent Learner). A null role is an account that has not finished onboarding.
//
// School scope (M1 multi-tenancy): every School Admin, Teacher and school Student has one primary school
// (profiles.school_id). A School Admin sees and manages only the Teachers and Students of their own school; the
// System Admin is platform level (every school). See services/schoolScope.js.
//
// Deny by default: a role or action that is not listed below is refused.

const SCHOOL_ROLES = Object.freeze(["teacher", "student"]);

const SCOPES = Object.freeze({
  // Platform level: sees every account; deletes platform-level accounts; creates School Admins.
  system_admin: Object.freeze({
    view: "all",
    deletable: Object.freeze(["general_user", "admin"]),
    // F7 Deactivate/Reactivate (Appendix N, System Admin): every account in every school except System Admins, which
    // are never deactivated through User Management. Records are never deleted.
    statusManageable: Object.freeze(["general_user", "admin", "teacher", "student"]),
    canCreateSchoolAdmin: true,
  }),
  // School level: only the Teachers and Students of the School Admin's own school. Never Independent Learners,
  // administrators, unassigned accounts or another school's accounts.
  admin: Object.freeze({
    view: SCHOOL_ROLES,
    deletable: SCHOOL_ROLES,
    statusManageable: SCHOOL_ROLES,
    canCreateSchoolAdmin: false,
  }),
});

function getAccountScope(role) {
  return Object.prototype.hasOwnProperty.call(SCOPES, role) ? SCOPES[role] : null;
}

function isAccountManager(role) {
  return getAccountScope(role) !== null;
}

/** School Admins only act inside their own school (both school ids are read from the database). */
function sameSchool(managerRole, managerSchoolId, targetSchoolId) {
  if (managerRole !== "admin") return true;
  return Boolean(managerSchoolId) && targetSchoolId === managerSchoolId;
}

/** Role scope; with school ids given, a School Admin also needs the same school. */
function canViewAccount(managerRole, targetRole, managerSchoolId, targetSchoolId) {
  const scope = getAccountScope(managerRole);
  if (!scope) return false;
  if (managerSchoolId !== undefined && !sameSchool(managerRole, managerSchoolId, targetSchoolId)) return false;
  return scope.view === "all" || scope.view.includes(targetRole);
}

function canDeleteAccount({ managerRole, managerId, targetRole, targetId }) {
  const scope = getAccountScope(managerRole);
  if (!scope || !managerId || !targetId || managerId === targetId) return false;
  return scope.deletable.includes(targetRole);
}

/** F7: may this manager deactivate or reactivate the target? Never their own account; deny by default. */
function canChangeAccountStatus({ managerRole, managerId, targetRole, targetId, managerSchoolId, targetSchoolId }) {
  const scope = getAccountScope(managerRole);
  if (!scope || !managerId || !targetId || managerId === targetId) return false;
  if (!sameSchool(managerRole, managerSchoolId, targetSchoolId)) return false;
  return scope.statusManageable.includes(targetRole);
}

/** What the signed-in manager may do, sent to the browser so it shows only allowed actions. */
function describePermissions(managerRole) {
  const scope = getAccountScope(managerRole);
  if (!scope) return null;
  return {
    role: managerRole,
    visibleRoles: scope.view === "all" ? ["system_admin", "admin", "teacher", "student", "general_user"] : [...scope.view],
    deletableRoles: [...scope.deletable],
    statusRoles: [...scope.statusManageable],
    canCreateSchoolAdmin: scope.canCreateSchoolAdmin,
    // F8 Create School / list schools: System Admin only.
    canManageSchools: managerRole === "system_admin",
  };
}

module.exports = { SCHOOL_ROLES, canChangeAccountStatus, sameSchool, canDeleteAccount, canViewAccount, describePermissions, getAccountScope, isAccountManager };
