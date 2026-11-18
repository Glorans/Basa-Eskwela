const {
  SupabaseAuthenticationError,
  getAuthenticatedSupabaseUser,
  getSupabaseAdmin,
  isBanned,
} = require("./supabaseAdmin");
const { canChangeAccountStatus, canDeleteAccount, canViewAccount, isAccountManager } = require("./m1AccountScope");

class AdminAuthorizationError extends Error {
  constructor(message = "Admin access is required.") {
    super(message);
    this.name = "AdminAuthorizationError";
    this.statusCode = 403;
  }
}

class AdminUserOperationError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.name = "AdminUserOperationError";
    this.statusCode = statusCode;
  }
}

async function authorizeAdminRequest(req, dependencies = {}) {
  const authenticate = dependencies.getAuthenticatedSupabaseUser
    ?? getAuthenticatedSupabaseUser;
  const getAdmin = dependencies.getSupabaseAdmin ?? getSupabaseAdmin;
  const user = await authenticate(req);
  const { data: profile, error } = await getAdmin()
    .from("profiles")
    .select("id, role")
    .eq("id", user.id)
    .single();

  if (error || !profile) {
    throw new SupabaseAuthenticationError();
  }

  if (profile.role !== "admin") {
    throw new AdminAuthorizationError();
  }

  return { user, profile };
}

/**
 * System Admin only (M7 F2 platform analytics, F4 Independent Learner performance). The role is read from the
 * database profile, never from the browser or JWT metadata. School Admins, Teachers and learners are refused.
 */
async function authorizeSystemAdminRequest(req, dependencies = {}) {
  const authenticate = dependencies.getAuthenticatedSupabaseUser ?? getAuthenticatedSupabaseUser;
  const getAdmin = dependencies.getSupabaseAdmin ?? getSupabaseAdmin;
  const user = await authenticate(req);
  const { data: profile, error } = await getAdmin().from("profiles").select("id, role").eq("id", user.id).single();
  if (error || !profile) throw new SupabaseAuthenticationError();
  if (profile.role !== "system_admin") throw new AdminAuthorizationError("System Admin access is required.");
  return { user, profile };
}

/**
 * M1 account management (F6 view roles, F7 delete, F8 create School Admin): a System Admin or a School Admin.
 * The role is always read from the database profile, never from the browser or JWT metadata. Every other
 * Admin feature keeps using authorizeAdminRequest (School Admin only), so a System Admin gains nothing else.
 */
async function authorizeAccountManager(req, dependencies = {}) {
  const authenticate = dependencies.getAuthenticatedSupabaseUser ?? getAuthenticatedSupabaseUser;
  const getAdmin = dependencies.getSupabaseAdmin ?? getSupabaseAdmin;
  const user = await authenticate(req);
  const { data: profile, error } = await getAdmin().from("profiles").select("id, role").eq("id", user.id).single();
  if (error || !profile) throw new SupabaseAuthenticationError();
  if (!isAccountManager(profile.role)) throw new AdminAuthorizationError("Administrator access is required.");
  return { user, profile };
}

async function listAllAuthUsers(supabase) {
  const users = [];
  const perPage = 1000;
  let page = 1;

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) {
      throw new AdminUserOperationError("Unable to load user accounts.");
    }

    const pageUsers = data?.users ?? [];
    users.push(...pageUsers);

    if (pageUsers.length < perPage) break;
    page += 1;
  }

  return users;
}

/**
 * F6: the accounts a manager may see (System Admin: all; School Admin: Teachers and Students only).
 * Fails closed: without a manager role read from the database, nothing is returned.
 */
async function listManagedUsers(dependencies = {}, managerRole) {
  if (!isAccountManager(managerRole)) throw new AdminAuthorizationError("Administrator access is required.");
  const users = (await loadAccountDirectory(dependencies)).filter((user) => canViewAccount(managerRole, user.role));
  if (managerRole !== "system_admin") return users;
  // System Admin only: authorization records and invitation states. School Admins never receive these.
  const supabase = (dependencies.getSupabaseAdmin ?? getSupabaseAdmin)();
  const records = await require("./schoolAdminInvitations").loadInvitationRecords(supabase);
  if (!records) return users.map((user) => ({ ...user, schoolAdminAuthorization: user.role === "admin" ? { state: "unavailable" } : null }));
  const names = new Map(users.map((user) => [user.id, user.fullName]));
  return users.map((user) => {
    const record = records.get(user.id);
    if (record) return { ...user, schoolAdminAuthorization: { ...record, authorizedByName: names.get(record.authorizedBy) || "Unknown System Admin" } };
    // Created before authorization records existed: shown as unavailable, never with an invented approver or date.
    return { ...user, schoolAdminAuthorization: user.role === "admin" ? { state: "unavailable" } : null };
  });
}

// Every Auth account joined to its profile. Internal: callers must apply a manager scope before returning it.
async function loadAccountDirectory(dependencies = {}) {
  const getAdmin = dependencies.getSupabaseAdmin ?? getSupabaseAdmin;
  const supabase = getAdmin();
  const [authUsers, profileResult] = await Promise.all([
    listAllAuthUsers(supabase),
    supabase
      .from("profiles")
      .select("id, full_name, nickname, role, status, created_at, teacher_status")
      .order("created_at", { ascending: false }),
  ]);

  if (profileResult.error) {
    throw new AdminUserOperationError("Unable to load user profiles.");
  }

  const profiles = profileResult.data ?? [];
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const authIds = new Set(authUsers.map((user) => user.id));
  const users = authUsers.map((authUser) => {
    const profile = profileById.get(authUser.id);
    return {
      id: authUser.id,
      email: authUser.email ?? null,
      fullName: profile?.full_name ?? "",
      nickname: profile?.nickname ?? "",
      role: profile?.role ?? "",
      status: profile?.status ?? "",
      // M1 F7 reconciliation: whether Supabase Auth currently refuses sign-in. Normally equal to status "inactive";
      // a mismatch means a deactivation or reactivation stopped part-way and the administrator should retry it.
      signInBlocked: isBanned(authUser),
      teacherStatus: profile?.teacher_status ?? null,
      createdAt: profile?.created_at ?? authUser.created_at,
    };
  });

  for (const profile of profiles) {
    if (!authIds.has(profile.id)) {
      users.push({
        id: profile.id,
        email: null,
        fullName: profile.full_name,
        nickname: profile.nickname ?? "",
        role: profile.role,
        status: profile.status,
        signInBlocked: null,
        teacherStatus: profile.teacher_status ?? null,
        createdAt: profile.created_at,
      });
    }
  }

  return users.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

const ADMINISTRATOR_ROLES = new Set(["admin", "system_admin"]);

/**
 * Permanent deletion: NOT reachable from any route. Removing the Auth user cascades to learning records, so it is
 * reserved for a future, separately approved account/data-deletion process, which must pass the ID of its approved
 * request. Without one this refuses before any lookup. Deactivate/Reactivate never calls this function.
 */
async function deleteManagedUser(requesterId, userId, dependencies = {}, managerRole) {
  const approvedRequest = dependencies.approvedDeletionRequestId;
  if (typeof approvedRequest !== "string" || !approvedRequest.trim()) {
    throw new AdminUserOperationError(
      "Permanent account deletion is disabled. It requires a separately approved data-deletion request.",
      410,
    );
  }
  if (!isAccountManager(managerRole)) throw new AdminAuthorizationError("Administrator access is required.");
  if (requesterId === userId) {
    throw new AdminUserOperationError(
      "You cannot delete your currently signed-in Admin account.",
      409,
    );
  }

  const getAdmin = dependencies.getSupabaseAdmin ?? getSupabaseAdmin;
  const supabase = getAdmin();
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, role")
    .eq("id", userId)
    .maybeSingle();

  if (profileError) {
    throw new AdminUserOperationError("Unable to verify the selected user's role.");
  }

  // F7 scope, checked on the server against the database role (never the browser's list).
  const targetRole = profile?.role ?? null;
  if (!canDeleteAccount({ managerRole, managerId: requesterId, targetRole, targetId: userId })) {
    // A School Admin gets one answer for every out-of-scope ID (Independent Learner, administrator, unassigned or
    // missing), so a guessed ID never reveals what kind of account it is.
    if (managerRole === "system_admin" && ADMINISTRATOR_ROLES.has(targetRole)) {
      throw new AdminUserOperationError(
        targetRole === "system_admin"
          ? "System Admin accounts cannot be deleted through User Management."
          : "School Admin accounts can be deleted only by a System Admin.",
        409,
      );
    }
    throw new AdminUserOperationError("This account is outside the accounts you can manage.", 403);
  }

  const { error } = await supabase.auth.admin.deleteUser(userId);
  if (error) {
    throw new AdminUserOperationError(
      "This account could not be deleted. It may still own protected learning or content records.",
      409,
    );
  }
}

// ---- M1 F7 Deactivate/Reactivate (reversible; replaces routine deletion) ----
// Deactivation keeps the Auth user, profile and every learning record. It bans the Auth user (Supabase Auth then
// refuses sign-in and token refresh), and m1_set_account_status records profiles.status and an audit row in one
// database transaction. The order always fails closed: a deactivation bans first and removes the ban again if the
// database step fails; a reactivation records first and lifts the ban last.
const DEACTIVATION_BAN = "876000h"; // about 100 years; lifted with "none" on reactivation
const ACCOUNT_STATUSES = Object.freeze({ inactive: "deactivate", active: "reactivate" });

function accountStatusDatabaseError(error, undoFailed = false) {
  const text = `${error?.code ?? ""} ${error?.message ?? ""}`;
  // Only a missing function means "not installed"; any other database error (for example permission denied) is a failure.
  if (/PGRST202|Could not find the function/i.test(text)) {
    return new AdminUserOperationError(
      undoFailed
        ? "Account deactivation is not installed yet, and sign-in for this account could not be restored. Retry Reactivate after the update."
        : "Account deactivation needs the M1 account-status database update. No change was made.",
      503,
    );
  }
  if (/m1_last_system_admin/.test(text)) return new AdminUserOperationError("The last active System Admin cannot be deactivated.", 409);
  if (/m1_target_missing/.test(text)) return new AdminUserOperationError("This account is outside the accounts you can manage.", 403);
  return new AdminUserOperationError(
    undoFailed
      ? "The account status could not be saved, and sign-in for this account is still blocked. Retry the action."
      : "The account status could not be saved. No change was made.",
    502,
  );
}

async function setManagedUserStatus(requesterId, userId, status, dependencies = {}, managerRole) {
  if (!isAccountManager(managerRole)) throw new AdminAuthorizationError("Administrator access is required.");
  if (!Object.prototype.hasOwnProperty.call(ACCOUNT_STATUSES, status)) {
    throw new AdminUserOperationError("Choose Deactivate or Reactivate.", 400);
  }
  if (requesterId === userId) {
    throw new AdminUserOperationError("You cannot deactivate or reactivate your own account.", 409);
  }

  const getAdmin = dependencies.getSupabaseAdmin ?? getSupabaseAdmin;
  const supabase = getAdmin();
  const { data: profile, error: profileError } = await supabase
    .from("profiles").select("id, role, status").eq("id", userId).maybeSingle();
  if (profileError) throw new AdminUserOperationError("Unable to verify the selected account.");

  // F7 scope, checked on the server against the database role (never the browser's list).
  const targetRole = profile?.role ?? null;
  if (!profile || !canChangeAccountStatus({ managerRole, managerId: requesterId, targetRole, targetId: userId })) {
    if (managerRole === "system_admin" && targetRole === "system_admin") {
      throw new AdminUserOperationError("System Admin accounts cannot be deactivated through User Management.", 409);
    }
    // One answer for every out-of-scope or unknown ID, so a guessed ID never reveals what kind of account it is.
    throw new AdminUserOperationError("This account is outside the accounts you can manage.", 403);
  }

  const setBan = (duration) => supabase.auth.admin.updateUserById(userId, { ban_duration: duration });
  const record = () => supabase.rpc("m1_set_account_status", { p_actor: requesterId, p_target: userId, p_status: status });

  if (status === "inactive") {
    const banned = await setBan(DEACTIVATION_BAN);
    if (banned.error) throw new AdminUserOperationError("The account could not be deactivated. No change was made.", 502);
    const saved = await record();
    if (saved.error) {
      const undo = await setBan("none");
      throw accountStatusDatabaseError(saved.error, Boolean(undo.error));
    }
    return { id: userId, status, previousStatus: saved.data ?? profile.status };
  }

  const saved = await record();
  if (saved.error) throw accountStatusDatabaseError(saved.error);
  const unbanned = await setBan("none");
  if (unbanned.error) {
    throw new AdminUserOperationError(
      "The account is marked Active, but its sign-in is still blocked. Retry Reactivate.",
      502,
    );
  }
  return { id: userId, status, previousStatus: saved.data ?? profile.status };
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FULL_NAME_MAX_LENGTH = 100;

/** The password-setup link opens the existing Reset Password page on the configured frontend. */
function passwordSetupRedirect(env = process.env) {
  const origin = String(env.FRONTEND_ORIGIN || "").split(",").map((value) => value.trim()).find(Boolean);
  if (!origin || !/^https?:\/\/[^\s/]+$/i.test(origin.replace(/\/$/, ""))) return null;
  return `${origin.replace(/\/$/, "")}/reset-password`;
}

/**
 * F8: a System Admin authorizes and invites a School Admin. The account stays role-less (no access) until the
 * invitee accepts in the setup-link session; see services/schoolAdminInvitations.js and
 * supabase/proposed/m1_school_admin_invitations_PROPOSED.sql. The old path that granted the role at creation is gone.
 */
function createSchoolAdmin(input, dependencies = {}, requester = {}) {
  return require("./schoolAdminInvitations").createSchoolAdmin(input, dependencies, requester);
}

module.exports = {
  AdminAuthorizationError,
  AdminUserOperationError,
  authorizeAccountManager,
  authorizeAdminRequest,
  authorizeSystemAdminRequest,
  createSchoolAdmin,
  deleteManagedUser,
  listAllAuthUsers,
  listManagedUsers,
  setManagedUserStatus,
  passwordSetupRedirect,
};
