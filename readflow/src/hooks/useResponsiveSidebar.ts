import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";

/** Shell-only state: mobile modal drawer and independent desktop rail preference. */
export default function useResponsiveSidebar() {
  const [mobile, setMobile] = useState(() => window.matchMedia("(max-width: 999px)").matches);
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const location = useLocation();
  const drawerOpen = mobile && open;
  const close = useCallback(() => setOpen(false), []);
  const toggle = () => mobile ? setOpen(value => !value) : setCollapsed(value => !value);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 999px)");
    let focusFrame = 0;
    const resize = () => {
      const hidingFocusedLink = media.matches && sidebarRef.current?.contains(document.activeElement);
      setMobile(media.matches);
      setOpen(false);
      if (hidingFocusedLink) {
        focusFrame = requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
      }
    };
    media.addEventListener("change", resize);
    return () => { media.removeEventListener("change", resize); cancelAnimationFrame(focusFrame); };
  }, []);

  useEffect(close, [location.pathname, location.search, close]);

  useLayoutEffect(() => {
    if (sidebarRef.current) sidebarRef.current.inert = mobile && !open;
    if (workspaceRef.current) workspaceRef.current.inert = drawerOpen;
  }, [mobile, open, drawerOpen]);

  useEffect(() => {
    if (!drawerOpen) return;
    // The drawer stays mounted while closed, so it would reopen wherever it was last scrolled, with the brand
    // and close button out of view. Every opening starts at the top, with the current page's link in view.
    const aside = sidebarRef.current;
    const links = aside?.querySelector<HTMLElement>(".rf-sidebar-scroll");
    if (aside) aside.scrollTop = 0;
    if (links) {
      links.scrollTop = 0;
      const active = links.querySelector<HTMLElement>('[aria-current="page"]');
      const activeBottom = active ? active.offsetTop + active.offsetHeight : 0;
      if (activeBottom > links.clientHeight) links.scrollTop = activeBottom - links.clientHeight;
    }
    const previousBodyOverflow = document.body.style.overflow;
    const previousRootOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    // Wait for the off-screen drawer's visibility transition to enter its visible frame.
    let focusFrame = requestAnimationFrame(() => {
      focusFrame = requestAnimationFrame(() => closeRef.current?.focus({ preventScroll: true }));
    });
    const focusable = () => Array.from(sidebarRef.current?.querySelectorAll<HTMLElement>(
      'a[href],button:not(:disabled),[tabindex="0"]',
    ) ?? []).filter(element => element.getClientRects().length > 0);
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
      if (event.key !== "Tab") return;
      const items = focusable();
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || !sidebarRef.current?.contains(document.activeElement))) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !sidebarRef.current?.contains(document.activeElement))) {
        event.preventDefault(); first?.focus();
      }
    };
    document.addEventListener("keydown", keydown, true);
    return () => {
      cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", keydown, true);
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousRootOverflow;
      triggerRef.current?.focus({ preventScroll: true });
    };
  }, [drawerOpen, close]);

  return { mobile, drawerOpen, collapsed, close, toggle, sidebarRef, workspaceRef, triggerRef, closeRef,
    expanded: mobile ? open : !collapsed,
    toggleLabel: mobile ? (open ? "Close navigation" : "Open navigation") : (collapsed ? "Expand sidebar" : "Collapse sidebar"),
    shellClasses: `rf-shell${!mobile && collapsed ? " rf-shell--collapsed" : ""}${drawerOpen ? " rf-shell--drawer-open" : ""}`,
  };
}
