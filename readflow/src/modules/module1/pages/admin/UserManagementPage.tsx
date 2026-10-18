import { Link } from "react-router-dom";
import { confirmReadFlow } from "../../../../components/ReadFlowDialog";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../../../auth/useAuth";
import {
  deleteManagedUser,
  getAdminUserError,
  getManagedUsers,
  type ManagedUser,
} from "../../services/adminUsers";
import {
  ASSIGNABLE_USER_ROLES,
  isAppRole,
  ROLE_LABELS,
} from "../../utils/authOnboarding";
import {
  filterManagedUsers,
  getManagedUserDisplayName,
  isPendingTeacher,
  type UserRoleFilter,
  type UserStatusFilter,
} from "./userManagementFilters";
import "../../../../pages/admin/UserManagementPage.css";

export default function UserManagementPage() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingUserId, setPendingUserId] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<UserRoleFilter>("");
  const [statusFilter, setStatusFilter] = useState<UserStatusFilter>("");
  const [pendingTeachers, setPendingTeachers] = useState(false);
  const filteredUsers = useMemo(
    () => filterManagedUsers(users, {
      searchQuery,
      role: roleFilter,
      status: statusFilter,
      pendingTeachers,
    }),
    [users, searchQuery, roleFilter, statusFilter, pendingTeachers],
  );
  const hasActiveFilters = Boolean(searchQuery.trim() || roleFilter || statusFilter || pendingTeachers);

  async function loadUsers() {
    setLoading(true);
    setError("");

    try {
      setUsers(await getManagedUsers());
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
    if (pendingUserId || user.id === currentUser?.id || user.role === "admin") return;
    const confirmed = await confirmReadFlow(
      "Are you sure you want to delete this user account? This action cannot be undone.",
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
    setPendingTeachers(false);
  }

  return (
    <section className="admin-users-page">
      <header className="admin-users-header">
        <div>
          <h1>User Management</h1>
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
            <button type="button" className="admin-users-clear" aria-pressed={pendingTeachers} onClick={() => {
              const next = !pendingTeachers;
              clearFilters();
              setPendingTeachers(next);
            }}>Pending Teachers</button>
            <label className="admin-users-control admin-users-search">
              <span>Search users</span>
              <input
                type="search"
                aria-label="Search users"
                placeholder="Search nickname, full name or email"
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
                {ASSIGNABLE_USER_ROLES.map((role) => (
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
                const isAdmin = user.role === "admin";
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
                      {isPendingTeacher(user) && (
                        <Link to="/admin/teacher-invitations?tab=pending">Review in Teacher Invitations</Link>
                      )}
                      <button
                        type="button"
                        className="admin-users-delete"
                        disabled={isSelf || isAdmin || isPending}
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
