import type { ReadingModule } from "../types/content";

// The database decides the outcome (m3_delete_module): unused content is removed
// permanently, content with protected history is only hidden. The browser cannot
// see every protected record, so the confirmation explains both outcomes.
export function moduleDeletionMessage(
  module: Pick<ReadingModule, "title" | "status" | "publishedAt">,
): string {
  const wasPublished = module.status !== "draft" || Boolean(module.publishedAt);
  return [
    `Delete "${module.title}"?`,
    wasPublished
      ? "This module has been published, so rooms or learners may have records for it."
      : "This draft has never been published.",
    "• If no room, learner progress or reading record uses it, the module, its passages and its question banks are permanently deleted. This cannot be undone.",
    "• If it has protected records, it is hidden from active catalogs instead, and existing assignments, reading history and results are kept.",
  ].join("\n\n");
}

// With the Trash installed, "Delete Reading Module" is recoverable.
export function moduleTrashMessage(
  module: Pick<ReadingModule, "title" | "status" | "publishedAt">,
): string {
  const wasPublished = module.status !== "draft" || Boolean(module.publishedAt);
  return [
    `Delete "${module.title}"?`,
    "It moves to the Trash and disappears from active catalogs. Passages, question banks, assignments, results and XP are kept.",
    wasPublished
      ? "You can restore it from the Trash. A module that was published comes back archived and must be published again before learners see it."
      : "You can restore it from the Trash as a draft.",
  ].join("\n\n");
}

export function modulePurgeMessage(title: string): string {
  return [
    `Permanently delete "${title}"?`,
    "Its passages, question banks and answer keys are removed for good. This cannot be undone.",
  ].join("\n\n");
}
