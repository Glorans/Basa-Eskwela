const comparable = (text: string) =>
  text.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/**
 * Display only: turns saved passage text into paragraphs for the story box.
 * Extracted PDF/OCR text can break lines mid-sentence, so single line breaks
 * become spaces and blank lines start a new paragraph. A first line that
 * repeats the story title is dropped (the title is shown above the box), and a
 * short first line without ending punctuation, such as a heading, stays on its
 * own line instead of merging into the first sentence.
 * Scoring never uses this; it receives the saved passage unchanged.
 */
export function storyParagraphs(text: string, title = "") {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const first = lines.findIndex((line) => line.trim());
  if (first >= 0) {
    const heading = lines[first].trim();
    const next = lines.slice(first + 1).find((line) => line.trim())?.trim() ?? "";
    // A heading has no punctuation and the story starts a new sentence after it;
    // a mid-sentence OCR break usually continues in lower case.
    const looksLikeHeading = Boolean(next) && heading.split(/\s+/).length <= 8
      && !/[.!?…:;,]/u.test(heading) && /^["'“‘(]?[\p{Lu}\p{N}]/u.test(next);
    const shownTitle = title.trim();
    if (shownTitle && comparable(heading) === comparable(shownTitle)) {
      lines.splice(first, 1);
    } else if (shownTitle && heading.toLocaleLowerCase().startsWith(`${shownTitle.toLocaleLowerCase()} `)
      && /^["'“‘(]?[\p{Lu}\p{N}]/u.test(heading.slice(shownTitle.length).trim())) {
      // The title was extracted on the same line as the first sentence.
      lines[first] = heading.slice(shownTitle.length).trim();
    } else if (looksLikeHeading) {
      lines.splice(first + 1, 0, "");
    }
  }
  return lines.join("\n").split(/\n[ \t]*\n+/)
    .map((paragraph) => paragraph.replace(/[ \t]*\n[ \t]*/g, " ").trim())
    .filter(Boolean);
}
