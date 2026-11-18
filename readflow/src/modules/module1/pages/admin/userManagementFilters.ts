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

// M1 F7: mirrors the server scope for the Deactivate/Reactivate button only; the server re-checks every change.
export function canChangeManagedUserStatus(
  permissions: Pick<AccountPermissions, "statusRoles">,
  user: Pick<ManagedUser, "id" | "role">,
  currentUserId?: string,
) {
  return Boolean(currentUserId) && user.id !== currentUserId && (permissions.statusRoles ?? []).includes(user.role);
}

export const isDeactivated = (user: Pick<ManagedUser, "status">) => user.status === "inactive";

/**
 * M1 F7 status shown to the administrator, and the one action offered. When the stored status and Supabase Auth
 * disagree (a deactivation or reactivation stopped part-way), the label says so and the action re-applies the
 * intended status; the server repeats both steps safely and records the retry.
 */
export function accountStatusView(user: Pick<ManagedUser, "status" | "signInBlocked">) {
  if (user.status === "inactive") {
    return user.signInBlocked === false
      ? { label: "Deactivated (sign-in not blocked)", action: "Block sign-in", target: "inactive" as const, needsRetry: true }
      : { label: "Deactivated", action: "Reactivate", target: "active" as const, needsRetry: false };
  }
  if (user.status === "active") {
    return user.signInBlocked === true
      ? { label: "Active (sign-in still blocked)", action: "Restore sign-in", target: "active" as const, needsRetry: true }
      : { label: "Active", action: "Deactivate", target: "inactive" as const, needsRetry: false };
  }
  return { label: user.status || "\u2014", action: "Deactivate", target: "inactive" as const, needsRetry: false };
}
export const accountStatusLabel = (user: Pick<ManagedUser, "status" | "signInBlocked">) => accountStatusView(user).label;

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
