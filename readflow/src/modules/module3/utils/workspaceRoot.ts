import type { M3Role } from "../types/content";

// URL root of each role's M3 workspace, for building links inside it.
// Route access is enforced by RequireRole in App.tsx, not here.
export function getM3WorkspaceRoot(role: M3Role) {
  if (role === "system_admin") return "/system-admin/content";
  if (role === "admin") return "/m3/admin";
  if (role === "teacher") return "/m3/teacher";
  return "/m3/general";
}
