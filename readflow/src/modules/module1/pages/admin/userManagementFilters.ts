import type { ManagedUser } from "../../services/adminUsers";
import type { AssignableUserRole } from "../../utils/authOnboarding";

import { getProfileDisplayName } from "../../utils/profileFields.ts";

export function getManagedUserDisplayName(user: Pick<ManagedUser, "role" | "nickname" | "fullName">) {
  return getProfileDisplayName({ role: user.role, nickname: user.nickname, full_name: user.fullName });
}

export function isPendingTeacher(user: Pick<ManagedUser, "role" | "teacherStatus">) {
  return user.role === "teacher" && user.teacherStatus === "pending";
}

export type UserRoleFilter = "" | AssignableUserRole;
export type UserStatusFilter = "" | "active" | "inactive";

interface UserFilters {
  searchQuery: string;
  role: UserRoleFilter;
  status: UserStatusFilter;
  pendingTeachers?: boolean;
}

export function filterManagedUsers(users: ManagedUser[], filters: UserFilters) {
  const normalizedQuery = filters.searchQuery.trim().toLocaleLowerCase();

  return users.filter((user) => {
    const matchesSearch = !normalizedQuery
      || (user.nickname ?? "").toLocaleLowerCase().includes(normalizedQuery)
      || user.fullName.toLocaleLowerCase().includes(normalizedQuery)
      || (user.email ?? "").toLocaleLowerCase().includes(normalizedQuery);
    const matchesRole = !filters.role || user.role === filters.role;
    const matchesStatus = !filters.status || user.status === filters.status;

    return matchesSearch && matchesRole && matchesStatus
      && (!filters.pendingTeachers || isPendingTeacher(user));
  });
}
