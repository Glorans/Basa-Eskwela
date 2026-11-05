import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Archive, ArchiveRestore, MoreVertical, Pencil } from "lucide-react";

type RoomActionsMenuProps = {
  archiveSupported: boolean;
  archived: boolean;
  archiveBusy: boolean;
  onEdit: () => void;
  onToggleArchive: () => void;
};

export default function RoomActionsMenu({
  archiveSupported, archived, archiveBusy, onEdit, onToggleArchive,
}: RoomActionsMenuProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, right: 0, maxHeight: 0 });
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout>>();
  const hoverOnly = useRef(false);
  const pendingFocus = useRef<"first" | "last" | null>(null);

  function cancelLeave() { clearTimeout(leaveTimer.current); }
  function close(restoreFocus = false) {
    cancelLeave();
    pendingFocus.current = null;
    hoverOnly.current = false;
    setOpen(false);
    if (restoreFocus) trigger.current?.focus();
  }
  function items() {
    return Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []);
  }
  function openWithFocus(edge: "first" | "last" = "first") {
    cancelLeave();
    hoverOnly.current = false;
    if (open) {
      const buttons = items();
      (edge === "last" ? buttons.at(-1) : buttons[0])?.focus();
    } else {
      pendingFocus.current = edge;
      setOpen(true);
    }
  }
  function leave() {
    cancelLeave();
    // The portal has its own pointer boundary. Allow time to cross the gap;
    // a keyboard/click-opened menu stays available until explicitly dismissed.
    leaveTimer.current = setTimeout(() => {
      if (hoverOnly.current && !menu.current?.contains(document.activeElement)) close();
    }, 200);
  }

  useEffect(() => () => clearTimeout(leaveTimer.current), []);
  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      setPosition({
        top: rect.bottom,
        right: Math.max(12, document.documentElement.clientWidth - rect.right),
        maxHeight: Math.max(0, window.innerHeight - rect.bottom - 12),
      });
    }
    place();
    const buttons = items();
    if (pendingFocus.current) {
      (pendingFocus.current === "last" ? buttons.at(-1) : buttons[0])?.focus();
      pendingFocus.current = null;
    }
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function outside(event: Event) {
      const target = event.target as Node | null;
      if (!trigger.current?.contains(target) && !menu.current?.contains(target)) close();
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        close(true);
      }
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const itemClass = "flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-bold text-[#173f3b] outline-none transition hover:bg-[#dce8e7] focus-visible:bg-[#dce8e7] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#173f3b] disabled:opacity-60";
  return <>
    <button
      ref={trigger}
      id={`${id}-trigger`}
      type="button"
      aria-label="Learning Room actions"
      aria-haspopup="menu"
      aria-expanded={open}
      aria-controls={open ? `${id}-menu` : undefined}
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-[#173f3b] outline-none transition hover:bg-[#f7cf4a] focus-visible:bg-[#f7cf4a] focus-visible:ring-2 focus-visible:ring-[#173f3b]"
      onPointerEnter={event => {
        cancelLeave();
        if (event.pointerType === "mouse" && window.matchMedia("(hover: hover)").matches && !open) {
          hoverOnly.current = true;
          setOpen(true);
        }
      }}
      onPointerLeave={leave}
      onClick={() => { if (open && !hoverOnly.current) close(true); else openWithFocus(); }}
      onKeyDown={event => {
        if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
          event.preventDefault();
          openWithFocus(event.key === "ArrowUp" ? "last" : "first");
        }
      }}
    >
      <MoreVertical size={24} aria-hidden="true" />
    </button>
    {open && createPortal(
      <div
        ref={menu}
        className="fixed z-50 w-64 max-w-[calc(100vw-24px)] overflow-y-auto pt-2 drop-shadow-xl"
        style={position}
        onPointerEnter={cancelLeave}
        onPointerLeave={leave}
      >
        <div
          id={`${id}-menu`}
          role="menu"
          aria-labelledby={`${id}-trigger`}
          className="rounded-2xl border border-[#dce8e7] bg-white p-2"
          onKeyDown={event => {
            const buttons = items();
            const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
            let next: number | undefined;
            if (event.key === "ArrowDown") next = (index + 1) % buttons.length;
            if (event.key === "ArrowUp") next = (index - 1 + buttons.length) % buttons.length;
            if (event.key === "Home") next = 0;
            if (event.key === "End") next = buttons.length - 1;
            if (next !== undefined) {
              event.preventDefault();
              buttons[next]?.focus();
            } else if (event.key === "Tab") {
              // Resume the page's tab order from the trigger, despite the portal.
              if (event.shiftKey) event.preventDefault();
              close(true);
            }
          }}
        >
          <button type="button" role="menuitem" tabIndex={-1} className={itemClass}
            onClick={() => { close(true); onEdit(); }}>
            <Pencil size={18} aria-hidden="true" /> Edit Learning Room
          </button>
          {archiveSupported && <button type="button" role="menuitem" tabIndex={-1}
            className={itemClass} disabled={archiveBusy} aria-busy={archiveBusy}
            onClick={() => { close(true); onToggleArchive(); }}>
            {archived ? <ArchiveRestore size={18} aria-hidden="true" /> : <Archive size={18} aria-hidden="true" />}
            {archiveBusy ? "Saving..." : archived ? "Restore Learning Room" : "Archive Learning Room"}
          </button>}
        </div>
      </div>, document.body,
    )}
  </>;
}
