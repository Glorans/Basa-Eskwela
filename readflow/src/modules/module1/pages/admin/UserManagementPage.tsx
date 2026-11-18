import { Link, useSearchParams } from "react-router-dom";
import { confirmReadFlow } from "../../../../components/ReadFlowDialog";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../../../auth/useAuth";
import {
  getAdminUserError,
  getManagedAccounts,
  setManagedUserStatus,
  type AccountPermissions,
  type ManagedUser,
} from "../../services/adminUsers";
import {
  APP_ROLES,
  isAppRole,
  ROLE_LABELS,
} from "../../utils/authOnboarding";
import {
  accountStatusView,
  canChangeManagedUserStatus,
  filterManagedUsers,
  getManagedUserDisplayName,
  isPendingTeacher,
  type UserRoleFilter,
  type UserStatusFilter,
} from "./userManagementFilters";
import "../../../../pages/admin/UserManagementPage.css";
import "./UserManagementCategories.css";
import "./SchoolAdminUserManagement.css";

const NO_PERMISSIONS: AccountPermissions = {
  role: "", visibleRoles: [], deletableRoles: [], statusRoles: [], canCreateSchoolAdmin: false,
};

// M1 F6 (view user roles) and F7 (deactivate/reactivate user account) for the System Admin and the School Admin.
// Deactivation is reversible and keeps the account and its records. The server decides which accounts are listed
// and which may be changed; this page only reflects it.
export default function UserManagementPage() {
  const { user: currentUser } = useAuth();
  const [params] = useSearchParams();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [permissions, setPermissions] = useState<AccountPermissions>(NO_PERMISSIONS);
  const [loading, setLoading] = useState(true);
  const [pendingUserId, setPendingUserId] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<UserRoleFilter>("");
  const [statusFilter, setStatusFilter] = useState<UserStatusFilter>("");
  const [schoolTab, setSchoolTab] = useState<"admin" | "teacher" | "student">("admin");
  const [schoolSearch, setSchoolSearch] = useState("");
  const [schoolStatus, setSchoolStatus] = useState<UserStatusFilter>("");
  const [schoolPage, setSchoolPage] = useState(1);
  const [learnerSearch, setLearnerSearch] = useState("");
  const [learnerStatus, setLearnerStatus] = useState<UserStatusFilter>("");
  const [learnerPage, setLearnerPage] = useState(1);
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
  const isSystemAdmin = permissions.role === "system_admin";
  const section = isSystemAdmin ? params.get("section") || "all" : "all";
  const schoolAdmins = users.filter((user) => user.role === "admin");
  const teachers = users.filter((user) => user.role === "teacher");
  const students = users.filter((user) => user.role === "student");
  const learners = users.filter((user) => user.role === "general_user");
  const schoolView = isSchoolAdmin || (isSystemAdmin && section === "school");
  const independentView = isSystemAdmin && section === "independent";
  const schoolTabs = [
    { role: "admin" as const, title: "School Admins", users: schoolAdmins },
    { role: "teacher" as const, title: "Teachers", users: teachers },
    { role: "student" as const, title: "Students", users: students },
  ].filter((tab) => !isSchoolAdmin || tab.role !== "admin");
  const activeSchoolTab = isSchoolAdmin && schoolTab === "admin" ? "teacher" : schoolTab;
  const selectedTab = schoolTabs.find((tab) => tab.role === activeSchoolTab)!;
  const matchingSchoolUsers = filterManagedUsers(selectedTab.users, { searchQuery: schoolSearch, role: "", status: schoolStatus });
  const schoolPageCount = Math.max(1, Math.ceil(matchingSchoolUsers.length / 10));
  const currentSchoolPage = Math.min(schoolPage, schoolPageCount);
  const schoolPageStart = (currentSchoolPage - 1) * 10;
  const matchingLearners = filterManagedUsers(learners, { searchQuery: learnerSearch, role: "", status: learnerStatus });
  const learnerPageCount = Math.max(1, Math.ceil(matchingLearners.length / 10));
  const currentLearnerPage = Math.min(learnerPage, learnerPageCount);
  const learnerPageStart = (currentLearnerPage - 1) * 10;
  const paginatedView = schoolView || independentView;
  const currentPage = schoolView ? currentSchoolPage : currentLearnerPage;
  const pageCount = schoolView ? schoolPageCount : learnerPageCount;
  const pageStart = schoolView ? schoolPageStart : learnerPageStart;
  const matchingCount = schoolView ? matchingSchoolUsers.length : matchingLearners.length;
  const setPage = schoolView ? setSchoolPage : setLearnerPage;
  const groups = schoolView
    ? [{ title: selectedTab.title, users: matchingSchoolUsers.slice(schoolPageStart, schoolPageStart + 10) }]
    : independentView
      ? [{ title: "Independent Learner Accounts", users: matchingLearners.slice(learnerPageStart, learnerPageStart + 10) }]
      : [{ title: isSystemAdmin ? "All Registered Users" : "", users: filteredUsers }];
  const showRoleFilter = !schoolView && !independentView;
  const showVerification = schoolView ? activeSchoolTab === "teacher" : !independentView;
  const activeSearch = schoolView ? schoolSearch : independentView ? learnerSearch : searchQuery;
  const activeStatus = schoolView ? schoolStatus : independentView ? learnerStatus : statusFilter;
  const categoryHasFilters = schoolView ? Boolean(schoolSearch.trim() || schoolStatus)
    : independentView ? Boolean(learnerSearch.trim() || learnerStatus) : hasActiveFilters;

  // Category navigation starts at the default school tab; no additional API request.
  useEffect(() => {
    setSchoolTab("admin");
    setSchoolSearch("");
    setSchoolStatus("");
    setSchoolPage(1);
    setLearnerSearch("");
    setLearnerStatus("");
    setLearnerPage(1);
  }, [section]);

  // Clamp after refresh or a status action removes the last row on the current page.
  useEffect(() => {
    setSchoolPage((page) => Math.min(page, schoolPageCount));
  }, [schoolPageCount]);
  useEffect(() => {
    setLearnerPage((page) => Math.min(page, learnerPageCount));
  }, [learnerPageCount]);

  function selectSchoolTab(role: "admin" | "teacher" | "student") {
    setSchoolTab(role);
    setSchoolPage(1);
  }

  const scopeNote = permissions.role === "system_admin"
    ? "You can view every account. You can deactivate and reactivate Independent Learner and School Admin accounts."
    : isSchoolAdmin
      ? "You can view, deactivate and reactivate Teacher and Student accounts."
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

  async function handleStatusChange(user: ManagedUser) {
    if (pendingUserId || !canChangeManagedUserStatus(permissions, user, currentUser?.id)) return;
    const name = getManagedUserDisplayName(user);
    const view = accountStatusView(user);
    const deactivate = view.target === "inactive";
    const confirmed = await confirmReadFlow(
      view.needsRetry
        ? deactivate
          ? `${name} is deactivated, but sign-in is not blocked yet. Block sign-in now? Their account and records are kept.`
          : `${name} is active, but sign-in is still blocked. Restore sign-in now? Their account and records are kept.`
        : deactivate
          ? `Deactivate ${name}? They will be signed out and unable to sign in until an administrator reactivates the account. ${user.role === "admin" ? "They will lose administrator access while deactivated. " : ""}Their account, records and learning history are kept.`
          : `Reactivate ${name}? They can sign in again with the same account, role and records.${user.role === "teacher" ? " Teacher verification is unchanged." : ""}`,
      { confirm: view.action, cancel: "Cancel" },
    );
    if (!confirmed) return;

    setPendingUserId(user.id);
    setError("");
    setSuccess("");

    try {
      const result = await setManagedUserStatus(user.id, deactivate ? "inactive" : "active");
      setUsers((current) => current.map((item) => (item.id === user.id
        ? { ...item, status: result.account.status, signInBlocked: result.account.status === "inactive" }
        : item)));
      setSuccess(deactivate ? `${name} was deactivated.` : `${name} was reactivated.`);
    } catch (statusError) {
      setError(getAdminUserError(statusError));
    } finally {
      setPendingUserId("");
    }
  }

  function clearFilters() {
    if (schoolView) {
      setSchoolSearch("");
      setSchoolStatus("");
      setSchoolPage(1);
      return;
    }
    if (independentView) {
      setLearnerSearch("");
      setLearnerStatus("");
      setLearnerPage(1);
      return;
    }
    setSearchQuery("");
    setRoleFilter("");
    setStatusFilter("");
  }

  return (
    <section className={`admin-users-page${isSchoolAdmin ? " school-admin-users" : ""}`}>
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
        <>
          {isSystemAdmin && (
            <>
              <nav className="admin-users-categories" aria-label="Account categories">
                <article className="admin-users-category">
                  <h2>School Accounts</h2>
                  <p>Current School Environment</p>
                  <dl>
                    <div><dt>School Admins</dt><dd>{schoolAdmins.length}</dd></div>
                    <div><dt>Teachers</dt><dd>{teachers.length}</dd></div>
                    <div><dt>Students</dt><dd>{students.length}</dd></div>
                  </dl>
                  <Link to="?section=school" aria-current={section === "school" ? "page" : undefined}>View School Accounts</Link>
                </article>
                <article className="admin-users-category">
                  <h2>Independent Learner Accounts</h2>
                  <p className="admin-users-total">{learners.length} <span>Independent Learners</span></p>
                  <p>Manage accounts. Reading and comprehension analytics remain in Independent Learners.</p>
                  <Link to="?section=independent" aria-current={section === "independent" ? "page" : undefined}>View Independent Learner Accounts</Link>
                </article>
                <article className="admin-users-category">
                  <h2>All Registered Users</h2>
                  <p className="admin-users-total">{users.length} <span>registered users</span></p>
                  <p>Search and filter all registered roles across the platform.</p>
                  <Link to="?section=all" aria-current={showRoleFilter ? "page" : undefined}>View All Registered Users</Link>
                </article>
              </nav>
            </>
          )}
          {isSchoolAdmin && (
            <div className="school-admin-users-summary" aria-label="Registered account totals">
              {schoolTabs.map((tab) => (
                <article key={tab.role}>
                  <h2>{tab.title}</h2>
                  <strong>{tab.users.length}</strong>
                  <p>Total registered accounts</p>
                </article>
              ))}
            </div>
          )}
              {schoolView && (
                <div className="admin-users-tabs" role="tablist" aria-label="School account roles">
                  {schoolTabs.map((tab, index) => (
                    <button
                      key={tab.role}
                      id={`school-tab-${tab.role}`}
                      type="button"
                      role="tab"
                      aria-selected={activeSchoolTab === tab.role}
                      aria-controls="school-account-panel"
                      tabIndex={activeSchoolTab === tab.role ? 0 : -1}
                      onClick={() => selectSchoolTab(tab.role)}
                      onKeyDown={(event) => {
                        const nextIndex = event.key === "ArrowRight" ? (index + 1) % schoolTabs.length
                          : event.key === "ArrowLeft" ? (index + schoolTabs.length - 1) % schoolTabs.length
                          : event.key === "Home" ? 0 : event.key === "End" ? schoolTabs.length - 1 : -1;
                        if (nextIndex < 0) return;
                        event.preventDefault();
                        selectSchoolTab(schoolTabs[nextIndex].role);
                        const buttons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
                        buttons?.[nextIndex].focus();
                      }}
                    >
                      {tab.title} <span>({tab.users.length})</span>
                    </button>
                  ))}
                </div>
              )}
          {groups.map((group) => (
        <div className={`admin-users-table-wrap${paginatedView ? " admin-users-paginated" : ""}`} key={schoolView ? "school" : group.title}
          id={schoolView ? "school-account-panel" : undefined}
          role={schoolView ? "tabpanel" : undefined}
          aria-labelledby={schoolView ? `school-tab-${activeSchoolTab}` : undefined}>
          {schoolView && !isSchoolAdmin && (
            <div className="admin-users-section-heading admin-users-tab-toolbar">
              {schoolTab === "admin"
                ? <p>Manage School Admin accounts in the current school environment.</p>
                : <p>Managed by School Admin</p>}
              {schoolTab === "admin" && permissions.canCreateSchoolAdmin && (
                <Link className="admin-users-primary" to="/system-admin/school-admins/new">Create School Admin</Link>
              )}
            </div>
          )}
          {group.title && !schoolView && <h2 className="admin-users-group-heading">{group.title}</h2>}
          <div className="admin-users-controls">
            <label className="admin-users-control admin-users-search">
              <span>Search users</span>
              <input
                type="search"
                aria-label="Search users"
                placeholder="Search name or email"
                value={activeSearch}
                onChange={(event) => {
                  if (schoolView) { setSchoolSearch(event.target.value); setSchoolPage(1); }
                  else if (independentView) { setLearnerSearch(event.target.value); setLearnerPage(1); }
                  else setSearchQuery(event.target.value);
                }}
              />
            </label>

            {showRoleFilter && <label className="admin-users-control">
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
            </label>}

            <label className="admin-users-control">
              <span>Status</span>
              <select
                aria-label="Status filter"
                value={activeStatus}
                onChange={(event) => {
                  if (schoolView) { setSchoolStatus(event.target.value as UserStatusFilter); setSchoolPage(1); }
                  else if (independentView) { setLearnerStatus(event.target.value as UserStatusFilter); setLearnerPage(1); }
                  else setStatusFilter(event.target.value as UserStatusFilter);
                }}
              >
                <option value="">All Statuses</option>
                <option value="active">Active</option>
                <option value="inactive">{paginatedView && !isSchoolAdmin ? "Inactive" : "Deactivated"}</option>
              </select>
            </label>

            {categoryHasFilters && (
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
            {paginatedView
              ? `Showing ${matchingCount ? pageStart + 1 : 0} - ${Math.min(pageStart + 10, matchingCount)} of ${matchingCount} matching accounts`
              : `Showing ${filteredUsers.length} of ${users.length} users`}
          </p>

          <div className="admin-users-table-scroll" tabIndex={0} role="region" aria-label={group.title || "User accounts"}>
            <table className="admin-users-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                {!independentView && !isSchoolAdmin && <th>Role</th>}
                <th>{isSchoolAdmin ? "Account Status" : "Status"}</th>
                <th>{isSchoolAdmin ? "Registration Date" : "Registered"}</th>
                {showVerification && <th>Teacher Verification</th>}
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {group.users.map((user) => {
                const isSelf = user.id === currentUser?.id;
                const canChangeStatus = canChangeManagedUserStatus(permissions, user, currentUser?.id);
                const statusView = accountStatusView(user);
                const isPending = user.id === pendingUserId;
                const roleLabel = isAppRole(user.role)
                  ? ROLE_LABELS[user.role]
                  : user.role || "\u2014";

                return (
                  <tr key={user.id}>
                    <td>{getManagedUserDisplayName(user)}{isSelf ? " (You)" : ""}</td>
                    <td>{user.email || "\u2014"}</td>
                    {!independentView && !isSchoolAdmin && <td>
                      <span className="admin-users-role-readonly">{roleLabel}</span>
                    </td>}
                    <td>
                      <span className="admin-users-role-readonly" data-account-status={user.status === "inactive" ? "deactivated" : "active"}>
                        {statusView.label}
                      </span>
                    </td>
                    <td>{new Date(user.createdAt).toLocaleDateString()}</td>
                    {showVerification && <td>{user.role === "teacher" ? user.teacherStatus ?? "Unavailable" : "Not required"}</td>}
                    <td>
                      {isSchoolAdmin && isPendingTeacher(user) && (
                        <Link to="/admin/teacher-invitations?tab=pending">Review in Teacher Invitations</Link>
                      )}
                      {isSystemAdmin && !canChangeStatus ? (
                        <span className="admin-users-managed-note">{user.role === "teacher" || user.role === "student" ? "Managed by School Admin" : isSelf ? "Your account" : "View only"}</span>
                      ) : <button
                        type="button"
                        className={statusView.target === "active" ? "admin-users-clear admin-users-reactivate" : "admin-users-delete admin-users-deactivate"}
                        disabled={!canChangeStatus || (isSystemAdmin ? Boolean(pendingUserId) : isPending)}
                        title={canChangeStatus ? undefined : "This account is outside the accounts you can manage."}
                        aria-label={`${statusView.action} ${getManagedUserDisplayName(user)}`}
                        onClick={() => void handleStatusChange(user)}
                      >
                        {isPending ? "Working…" : statusView.action}
                      </button>}
                    </td>
                  </tr>
                );
              })}
              {group.users.length === 0 && (
                <tr>
                  <td className="admin-users-empty" colSpan={isSchoolAdmin ? showVerification ? 6 : 5 : independentView ? 5 : showVerification ? 7 : 6}>
                    {schoolView || independentView
                      ? categoryHasFilters ? "No accounts match your search or filters." : "No accounts in this category yet."
                      : users.length === 0 ? "No user profiles were found." : "No users match your search or filters."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          </div>
          {paginatedView && (
            <nav className="admin-users-pagination" aria-label={schoolView ? "School accounts pagination" : "Independent Learner accounts pagination"}>
              <span aria-live="polite">Page {currentPage} of {pageCount}</span>
              <button type="button" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Previous</button>
              <button type="button" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>Next</button>
            </nav>
          )}
        </div>
          ))}
        </>
      )}
    </section>
  );
}
