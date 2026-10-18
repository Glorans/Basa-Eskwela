export type EditableProfileField = "nickname" | "full_name";

interface ProfileFieldSource {
  role: unknown;
  nickname: string | null;
  full_name: string;
}

export function getEditableProfileField(
  role: unknown,
): EditableProfileField | null {
  switch (role) {
    case "student":
    case "general_user":
      return "nickname";
    case "teacher":
    case "admin":
      return "full_name";
    default:
      return null;
  }
}

export function getEditableProfileValue(profile: ProfileFieldSource) {
  const field = getEditableProfileField(profile.role);
  if (field === "nickname") return usableProfileName(profile.nickname);
  if (field === "full_name") return usableProfileName(profile.full_name);
  return "";
}

// Only this known legacy placeholder is excluded; ordinary names remain valid.
export function isLegacyProfileName(value: unknown) {
  return typeof value === "string" && value.trim().toLowerCase() === "new user";
}

export function usableProfileName(value: unknown): string {
  return typeof value === "string" && !isLegacyProfileName(value) ? value.trim() : "";
}

export function getProfileDisplayName(profile: ProfileFieldSource | null | undefined) {
  if (!profile) return "\u2014";
  const nickname = usableProfileName(profile.nickname);
  const fullName = usableProfileName(profile.full_name);
  return getEditableProfileField(profile.role) === "nickname"
    ? nickname || fullName || "\u2014"
    : fullName || nickname || "\u2014";
}

export function getProfileInitials(profile: ProfileFieldSource | null | undefined) {
  return getProfileDisplayName(profile).split(/\s+/).slice(0, 2)
    .map((part) => part[0]).join("").toUpperCase();
}
