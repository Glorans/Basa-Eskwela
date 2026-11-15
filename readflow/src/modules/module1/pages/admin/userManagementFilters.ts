import type { AccountPermissions, ManagedUser } from "../../services/adminUsers";
import type { AppRole } from "../../utils/authOnboarding";

import { getProfileDisplayName } from "../../utils/profileFields.ts";

export function getManagedUserDisplayName(user: Pick<ManagedUser, "role" | "nickname" | "fullName">) {
  return getProfileDisplayName({ role: user.role, nickname: user.nickname, full_name: user.fullName });
}

// Mirrors the server scope for the Delete button only; the server re-checks every delete (M1 F7).
export function canDeleteManagedUser(
  permissions: Pick<AccountPermissions, "deletableRoles">,
  user: Pick<ManagedUser, "id" | "role">,
  currentUserId?: string,
) {
  return Boolean(currentUserId) && user.id !== currentUserId && permissions.deletableRoles.includes(user.role);
}

export function isPendingTeacher(user: Pick<ManagedUser, "role" | "teacherStatus">) {
  return user.role === "teacher" && user.teacherStatus === "pending";
}

export type UserRoleFilter = "" | AppRole;
export type UserStatusFilter = "" | "active" | "inactive";

interface UserFilters {
  searchQuery: string;
  role: UserRoleFilter;
  status: UserStatusFilter;
}

export function filterManagedUsers(users: ManagedUser[], filters: UserFilters) {
  const normalizedQuery = filters.searchQuery.trim().toLocaleLowerCase();

  return users.filter((user) => {
    const matchesSearch = !normalizedQuery
      || user.fullName.toLocaleLowerCase().includes(normalizedQuery)
      || (user.email ?? "").toLocaleLowerCase().includes(normalizedQuery);
    const matchesRole = !filters.role || user.role === filters.role;
    const matchesStatus = !filters.status || user.status === filters.status;

    return matchesSearch && matchesRole && matchesStatus;
  });
}
