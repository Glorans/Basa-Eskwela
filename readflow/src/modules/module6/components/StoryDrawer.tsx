import { BookOpen, X } from "lucide-react";
import { useId, useRef } from "react";
import { getActivityText } from "../../../pages/reading-activity/activityLanguage";
import type { ComprehensionAttempt } from "../services/comprehensionService";
import "./StoryDrawer.css";

// Read only the authorized attempt snapshot. Opening this dialog makes no requests.
export default function StoryDrawer({ attempt }: { attempt: ComprehensionAttempt }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const dialogId = useId();
  const { t } = getActivityText(attempt.language);
  const available = typeof attempt.passageText === "string" && attempt.passageText.trim().length > 0;

  return <>
    <button ref={trigger} type="button" className="m6-button m6-story-trigger"
      aria-haspopup="dialog" aria-controls={dialogId}
      onClick={() => dialog.current?.showModal()}>
      <BookOpen size={18} aria-hidden="true" />{t("View Story")}
    </button>
    <dialog ref={dialog} id={dialogId} className="m6-story-drawer" lang={attempt.language}
      aria-labelledby={titleId} aria-modal="true"
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const stops = event.currentTarget.querySelectorAll<HTMLElement>("button, [tabindex='0']");
        const first = stops[0];
        const last = stops[stops.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault(); last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault(); first?.focus();
        }
      }}
      onClose={() => trigger.current?.focus({ preventScroll: true })}>
      <header className="m6-story-header">
        <h2 id={titleId}>{attempt.passageTitle?.trim() || t("View Story")}</h2>
        <button type="button" autoFocus className="m6-button m6-story-close"
          aria-label={t("Close story")} onClick={() => dialog.current?.close()}>
          <X size={22} aria-hidden="true" />
        </button>
      </header>
      <div className="m6-story-body" tabIndex={0} role="region" aria-label={t("Reading passage")}>
        {available ? <div className="m6-story-passage">{attempt.passageText}</div>
          : <p>{t("The saved story is unavailable. You can close this panel and continue your assessment.")}</p>}
      </div>
    </dialog>
  </>;
}
