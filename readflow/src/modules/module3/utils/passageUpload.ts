// Client-side checks for "Upload / Extract into this passage". The server repeats
// every check (type, MIME, signature, 25 MB); these only give immediate feedback.

export const PASSAGE_UPLOAD_MAX_BYTES = 25 * 1024 * 1024;

/** Extensions listed in an <input accept> string, e.g. ".pdf,.docx,image/png" -> [".pdf", ".docx"]. */
export function acceptedExtensions(accept: string): string[] {
  return accept
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.startsWith("."));
}

function formatList(extensions: string[]) {
  const names = extensions.map((extension) => extension.slice(1).toUpperCase());
  return names.length > 1
    ? `${names.slice(0, -1).join(", ")} or ${names.at(-1)}`
    : names[0] ?? "a supported";
}

/** A message explaining why this file cannot be extracted, or null when it may be sent. */
export function passageUploadIssue(
  file: { name: string; size: number },
  accept: string,
): string | null {
  const extensions = acceptedExtensions(accept);
  const dot = file.name.lastIndexOf(".");
  const extension = dot > 0 ? file.name.slice(dot).toLowerCase() : "";

  if (!extensions.includes(extension)) {
    return `This file type is not supported. Choose a ${formatList(extensions)} file.`;
  }
  if (file.size === 0) {
    return "The selected file is empty. Choose a file that contains readable text.";
  }
  if (file.size > PASSAGE_UPLOAD_MAX_BYTES) {
    return "The selected file is larger than the 25 MB upload limit.";
  }
  return null;
}

/**
 * A passage title taken from the extracted text's first paragraph, when that
 * paragraph looks like a heading: one short line, not a sentence, followed by
 * more paragraphs. A wrapped first line (PDF/OCR) is not a heading.
 */
export function suggestedPassageTitle(text: string): string | null {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const [first, ...rest] = paragraphs;

  if (!first || !rest.length || first.includes("\n")) return null;
  if (first.length > 100 || first.split(/\s+/).length > 12) return null;
  if (/[.,;:]$/.test(first)) return null;
  return first.slice(0, 200);
}
