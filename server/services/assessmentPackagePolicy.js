// M2 F6 + F10: who may see and manage which assessment package. Pure functions; roles come from the server-side
// profile (authorizeRequesterRole), never from the browser. Learners (student, general_user) have NO access to any
// package: passages, questions and answer keys are staff-only. The database adds a second wall (RLS, no grants).
//
//   Package type ("category")   kind / audience / scope                 Managed by               Reviewed by
//   initial                     initial / all_learners / platform       System Admin             System Admin
//   independent                 reassessment / independent_learners / platform   System Admin  System Admin
//   school                      reassessment / classroom / school       School Admin             School Admin
//   teacher                     reassessment / classroom / teacher      the owning Teacher only  School Admin
//
// Single-school pilot: there is no school membership in the database, so every School Admin manages the one
// school's packages and reviews every Teacher's packages. No memberships are invented.

const STAFF_ROLES = Object.freeze(["system_admin", "admin", "teacher"]);

const CATEGORIES = Object.freeze({
  initial: Object.freeze({ kind: "initial", audience: "all_learners", scope: "platform" }),
  independent: Object.freeze({ kind: "reassessment", audience: "independent_learners", scope: "platform" }),
  school: Object.freeze({ kind: "reassessment", audience: "classroom", scope: "school" }),
  teacher: Object.freeze({ kind: "reassessment", audience: "classroom", scope: "teacher" }),
});

function categoryOf(pkg) {
  for (const [name, shape] of Object.entries(CATEGORIES)) {
    if (pkg?.kind === shape.kind && pkg?.audience === shape.audience && pkg?.scope === shape.scope) return name;
  }
  return null;
}

const roleOf = (profile) => profile?.role;
const isApprovedTeacher = (profile) => profile?.role === "teacher" && profile?.teacher_status === "approved";
const isStaff = (profile) => profile?.role === "system_admin" || profile?.role === "admin" || isApprovedTeacher(profile);

/**
 * Categories this account may CREATE. Initial packages are never created from scratch: the System Admin imports
 * the code-defined version 3.0 diagnostic, then authors new versions of it (F6 keeps one lineage per language).
 */
function creatableCategories(profile) {
  if (roleOf(profile) === "system_admin") return ["independent"];
  if (roleOf(profile) === "admin") return ["school"];
  if (isApprovedTeacher(profile)) return ["teacher"];
  return [];
}

const canImportInitial = (profile) => roleOf(profile) === "system_admin";

/** May this account see the package (including its passages, questions and answer keys)? */
function canView(profile, pkg) {
  const category = categoryOf(pkg);
  if (!category || !isStaff(profile)) return false;
  if (roleOf(profile) === "system_admin") return category === "initial" || category === "independent";
  if (roleOf(profile) === "admin") return category === "school" || category === "teacher";
  // Teachers: their OWN private packages only. Another Teacher's packages are never visible.
  return category === "teacher" && pkg.owner_id === profile.id;
}

/** May this account edit drafts, create versions, submit, rename and archive? (the package's managers) */
function canManage(profile, pkg) {
  if (!canView(profile, pkg)) return false;
  const category = categoryOf(pkg);
  if (roleOf(profile) === "system_admin") return true;
  if (roleOf(profile) === "admin") return category === "school";
  return category === "teacher" && pkg.owner_id === profile.id;
}

/**
 * May this account approve or return a submitted version? Approval always needs a written educator-review
 * attestation (enforced by the database). Teachers never approve their own packages: a School Admin reviews them.
 * System Admins and School Admins review their own categories (in this pilot there may be only one of each);
 * whether a second reviewer is required is an adviser decision, recorded in the report.
 */
function canReview(profile, pkg) {
  if (!canView(profile, pkg)) return false;
  const category = categoryOf(pkg);
  if (roleOf(profile) === "system_admin") return category === "initial" || category === "independent";
  if (roleOf(profile) === "admin") return category === "school" || category === "teacher";
  return false;
}

/** Publishing or retiring an APPROVED version: the package's managers and its reviewers. */
const canPublish = (profile, pkg) => canManage(profile, pkg) || canReview(profile, pkg);

function permissionsFor(profile, pkg) {
  const archived = Boolean(pkg?.archived_at);
  return {
    view: canView(profile, pkg),
    manage: !archived && canManage(profile, pkg),
    review: !archived && canReview(profile, pkg),
    publish: !archived && canPublish(profile, pkg),
  };
}

module.exports = {
  CATEGORIES,
  STAFF_ROLES,
  canImportInitial,
  canManage,
  canPublish,
  canReview,
  canView,
  categoryOf,
  creatableCategories,
  isStaff,
  permissionsFor,
};
