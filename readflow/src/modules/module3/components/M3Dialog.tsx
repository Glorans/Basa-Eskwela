import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import "./M3Dialog.css";

const FOCUSABLE = [
  "a[href]", "button:not([disabled])", "input:not([disabled]):not([type=hidden])", "select:not([disabled])",
  "textarea:not([disabled])", "[tabindex]:not([tabindex='-1'])",
].join(",");

/**
 * Shared centered M3 dialog (question editor, Student preview, publish problems, Trash). Rendered in place inside the
 * role's shell, so each role keeps its theme (the System Admin shell restyles it through `.system-admin-ui`).
 * Escape and the X button call `onRequestClose`, which the caller may refuse (e.g. to confirm discarding edits).
 * A backdrop click never closes it, so typed work cannot be lost by a stray click. The body scrolls internally.
 */
export default function M3Dialog({ title, subtitle, onRequestClose, children, footer, size = "large", role = "dialog", closeLabel = "Close" }: {
  title: string;
  subtitle?: ReactNode;
  onRequestClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: "small" | "large";
  role?: "dialog" | "alertdialog";
  closeLabel?: string;
}) {
  const id = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const requestClose = useRef(onRequestClose);
  requestClose.current = onRequestClose;

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Focus the first form control or button, so keyboard users start inside the dialog.
    const first = panelRef.current?.querySelector<HTMLElement>(".m3-dialog__body " + FOCUSABLE.split(",").join(", .m3-dialog__body "))
      ?? panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); requestClose.current(); return; }
      if (event.key !== "Tab" || !panelRef.current) return;
      const items = [...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((item) => item.offsetParent !== null);
      if (!items.length) return;
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      if (event.shiftKey && document.activeElement === firstItem) { event.preventDefault(); lastItem.focus(); }
      else if (!event.shiftKey && document.activeElement === lastItem) { event.preventDefault(); firstItem.focus(); }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      opener?.focus();
    };
  }, []);

  return (
    <div className="m3-dialog-backdrop">
      <div ref={panelRef} className={`m3-dialog m3-dialog--${size}`} role={role} aria-modal="true"
        aria-labelledby={`${id}-title`} aria-describedby={subtitle ? `${id}-subtitle` : undefined}>
        <header className="m3-dialog__header">
          <div>
            <h2 id={`${id}-title`}>{title}</h2>
            {subtitle && <div id={`${id}-subtitle`} className="m3-dialog__subtitle">{subtitle}</div>}
          </div>
          <button type="button" className="m3-dialog__close" aria-label={closeLabel} onClick={() => requestClose.current()}>
            <X size={20} aria-hidden="true" />
          </button>
        </header>
        <div className="m3-dialog__body">{children}</div>
        {footer && <footer className="m3-dialog__footer">{footer}</footer>}
      </div>
    </div>
  );
}
