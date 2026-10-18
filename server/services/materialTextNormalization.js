function normalizeExtractedText(value) {
  return String(value || "")
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[\t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function hasReadableText(value) {
  return Boolean(value && /[\p{L}\p{N}]/u.test(value));
}

module.exports = {
  hasReadableText,
  normalizeExtractedText,
};
