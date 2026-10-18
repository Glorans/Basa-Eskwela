// Ignore the legacy signup sentinel without altering persisted profile values.
function usableProfileName(value) {
  if (typeof value !== "string") return "";
  const name = value.trim();
  return name.toLowerCase() === "new user" ? "" : name;
}

function getProfileDisplayName({ role, nickname, fullName }) {
  const preferred = role === "student" || role === "general_user"
    ? [nickname, fullName] : [fullName, nickname];
  return preferred.map(usableProfileName).find(Boolean) || "";
}

module.exports = { getProfileDisplayName };
