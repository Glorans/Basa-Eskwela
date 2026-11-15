import { Link } from "react-router-dom";
import { confirmReadFlow } from "../../../../components/ReadFlowDialog";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../../../auth/useAuth";
import {
  deleteManagedUser,
  getAdminUserError,
  getManagedAccounts,
  type AccountPermissions,
  type ManagedUser,
} from "../../services/adminUsers";
import {
  APP_ROLES,
  isAppRole,
  ROLE_LABELS,
} from "../../utils/authOnboarding";
import {
  canDeleteManagedUser,
  filterManagedUsers,
  getManagedUserDisplayName,
  isPendingTeacher,
  type UserRoleFilter,
  type UserStatusFilter,
} from "./userManagementFilters";
import "../../../../pages/admin/UserManagementPage.css";

const NO_PERMISSIONS: AccountPermissions = {
  role: "", visibleRoles: [], deletableRoles: [], canCreateSchoolAdmin: false,
};

// M1 F6 (view user roles) and F7 (delete user account) for the System Admin and the School Admin.
// The server decides which accounts are listed and which may be deleted; this page only reflects it.
export default function UserManagementPage() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [permissions, setPermissions] = useState<AccountPermissions>(NO_PERMISSIONS);
  const [loading, setLoading] = useState(true);
  const [pendingUserId, setPendingUserId] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<UserRoleFilter>("");
  const [statusFilter, setStatusFilter] = useState<UserStatusFilter>("");
  const filteredUsers = useMemo(
    () => filterManagedUsers(users, {
      searchQuery,
      role: roleFilter,
      status: statusFilter,
    }),
    [users, searchQuery, roleFilter, statusFilter],
  );
  const hasActiveFilters = Boolean(searchQuery.trim() || roleFilter || statusFilter);
  const filterRoles = APP_ROLES.filter((role) => permissions.visibleRoles === "all" || permissions.visibleRoles.includes(role));
  const isSchoolAdmin = permissions.role === "admin";
  const scopeNote = permissions.role === "system_admin"
    ? "You can view every account. You can delete Independent Learner and School Admin accounts."
    : isSchoolAdmin
      ? "You can view and delete Teacher and Student accounts."
      : "";

  async function loadUsers() {
    setLoading(true);
    setError("");

    try {
      const result = await getManagedAccounts();
      setUsers(result.users);
      setPermissions(result.permissions);
    } catch (loadError) {
      setError(getAdminUserError(loadError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadUsers();
  }, []);

  async function handleDelete(user: ManagedUser) {
    if (pendingUserId || !canDeleteManagedUser(permissions, user, currentUser?.id)) return;
    const confirmed = await confirmReadFlow(
      user.role === "admin"
        ? "Are you sure you want to delete this School Admin account? They will lose all administrator access. This action cannot be undone."
        : "Are you sure you want to delete this user account? This action cannot be undone.",
    );
    if (!confirmed) return;

    setPendingUserId(user.id);
    setError("");
    setSuccess("");

    try {
      await deleteManagedUser(user.id);
      setUsers((current) => current.filter((item) => item.id !== user.id));
      setSuccess("User account deleted.");
    } catch (deleteError) {
      setError(getAdminUserError(deleteError));
    } finally {
      setPendingUserId("");
    }
  }

  function clearFilters() {
    setSearchQuery("");
    setRoleFilter("");
    setStatusFilter("");
  }

  return (
    <section className="admin-users-page">
      <header className="admin-users-header">
        <div>
          <h1>User Management</h1>
          {scopeNote && <p className="admin-users-scope">{scopeNote}</p>}
        </div>
        <button type="button" onClick={() => void loadUsers()} disabled={loading || Boolean(pendingUserId)}>
          Refresh
        </button>
      </header>

      {error && <p className="admin-users-message admin-users-message--error" role="alert">{error}</p>}
      {success && <p className="admin-users-message admin-users-message--success" role="status">{success}</p>}

      {loading ? (
        <p className="admin-users-loading" role="status">Loading users…</p>
      ) : (
        <div className="admin-users-table-wrap">
          <div className="admin-users-controls">
            <label className="admin-users-control admin-users-search">
              <span>Search users</span>
              <input
                type="search"
                aria-label="Search users"
                placeholder="Search name or email"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
              />
            </label>

            <label className="admin-users-control">
              <span>Role</span>
              <select
                aria-label="Role filter"
                value={roleFilter}
                onChange={(event) => setRoleFilter(event.target.value as UserRoleFilter)}
              >
                <option value="">All Roles</option>
                {filterRoles.map((role) => (
                  <option key={role} value={role}>{ROLE_LABELS[role]}</option>
                ))}
              </select>
            </label>

            <label className="admin-users-control">
              <span>Status</span>
              <select
                aria-label="Status filter"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as UserStatusFilter)}
              >
                <option value="">All Statuses</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </label>

            {hasActiveFilters && (
              <button
                className="admin-users-clear"
                type="button"
                aria-label="Clear filters"
                onClick={clearFilters}
              >
                Clear Filters
              </button>
            )}
          </div>

          <p className="admin-users-result-count" aria-live="polite">
            Showing {filteredUsers.length} of {users.length} users
          </p>

          <div className="admin-users-table-scroll">
            <table className="admin-users-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th>Registered</th>
                <th>Teacher Verification</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((user) => {
                const isSelf = user.id === currentUser?.id;
                const canDelete = canDeleteManagedUser(permissions, user, currentUser?.id);
                const isPending = user.id === pendingUserId;
                const roleLabel = isAppRole(user.role)
                  ? ROLE_LABELS[user.role]
                  : user.role || "\u2014";

                return (
                  <tr key={user.id}>
                    <td>{getManagedUserDisplayName(user)}{isSelf ? " (You)" : ""}</td>
                    <td>{user.email || "\u2014"}</td>
                    <td>
                      <span className="admin-users-role-readonly">{roleLabel}</span>
                    </td>
                    <td>{user.status || "\u2014"}</td>
                    <td>{new Date(user.createdAt).toLocaleDateString()}</td>
                    <td>{user.role === "teacher" ? user.teacherStatus ?? "Unavailable" : "Not required"}</td>
                    <td>
                      {isSchoolAdmin && isPendingTeacher(user) && (
                        <Link to="/admin/teacher-invitations?tab=pending">Review in Teacher Invitations</Link>
                      )}
                      <button
                        type="button"
                        className="admin-users-delete"
                        disabled={!canDelete || isPending}
                        title={canDelete ? undefined : "This account is outside the accounts you can delete."}
                        onClick={() => void handleDelete(user)}
                      >
                        {isPending ? "Working…" : "Delete"}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {filteredUsers.length === 0 && (
                <tr>
                  <td className="admin-users-empty" colSpan={7}>
                    {users.length === 0
                      ? "No user profiles were found."
                      : "No users match your search or filters."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </section>
  );
}
