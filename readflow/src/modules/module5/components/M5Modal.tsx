import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import "./M5Modal.css";

interface M5ModalProps {
  id: string;
  title: string;
  /** Translated label for the X button. */
  closeLabel: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}

const FOCUSABLE = 'a[href], button:not([disabled]), audio[controls], [tabindex]:not([tabindex="-1"])';

/**
 * Centered floating panel over a dimmed page. A closed modal stays mounted but
 * hidden, so its content (a pronunciation check, a loaded recording) survives
 * being closed and reopened. ESC, the X button or a backdrop click closes it.
 */
export default function M5Modal({ id, title, closeLabel, open, onClose, children }: M5ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const body = document.body;
    const previousOverflow = body.style.overflow;
    // The background page must not scroll while the modal is open.
    body.style.overflow = "hidden";
    closeRef.current?.focus();

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      // Keep keyboard focus inside the open modal.
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKey);

    const dialog = dialogRef.current;
    return () => {
      window.removeEventListener("keydown", handleKey);
      body.style.overflow = previousOverflow;
      // Closing stops any recording that is still playing inside the modal.
      dialog?.querySelectorAll("audio").forEach((audio) => audio.pause());
      opener?.focus();
    };
  }, [open]);

  return (
    <div
      className="m5-modal-backdrop"
      hidden={!open}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="m5-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        id={id}
      >
        <header className="m5-modal-header">
          <h2 id={`${id}-title`}>{title}</h2>
          <button ref={closeRef} type="button" className="m5-modal-close" aria-label={closeLabel} onClick={onClose}>
            <X size={22} aria-hidden="true" />
          </button>
        </header>
        <div className="m5-modal-body">{children}</div>
      </div>
    </div>
  );
}
