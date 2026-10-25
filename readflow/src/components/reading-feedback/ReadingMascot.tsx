import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import cheeringMascot from "../../assets/basa/mascot-thumbsup.png";
import standingMascot from "../../assets/basa/mascot-classroom.png";
import { getActivityText, type ActivityLanguage } from "../../pages/reading-activity/activityLanguage";
import "./ReadingFeedback.css";

export type MascotMood = "encourage" | "celebrate" | "correct" | "tryAgain" | "hint";

interface ReadingMascotProps {
  mood: MascotMood;
  /** Feedback already produced by the page, in the activity language. */
  message: string;
  language: ActivityLanguage;
  eventId?: string;
  live?: boolean;
  placement?: "dock" | "overlay-left";
  /** Phone overlay only: controls the popup must never cover. */
  protectSelector?: string;
  /** Phone overlay only: content the popup should cover as little as possible. */
  avoidSelector?: string;
}

const cheering = new Set<MascotMood>(["celebrate", "correct"]);
export const PHONE_QUERY = "(max-width: 480px)";
const EDGE = 8;

type Box = { top: number; bottom: number; left: number; right: number };

const overlapArea = (top: number, height: number, left: number, right: number, boxes: Box[]) =>
  boxes.reduce((total, box) => total
    + Math.max(0, Math.min(top + height, box.bottom) - Math.max(top, box.top))
    * Math.max(0, Math.min(right, box.right) - Math.max(left, box.left)), 0);

/**
 * Picks the popup's top edge inside the visible panel: never over a protected
 * control, then covering as little of the avoided content as possible, then as
 * close as possible above the protected controls.
 */
export function chooseCompactTop(view: { top: number; bottom: number }, height: number, left: number, right: number,
  protectedBoxes: Box[], avoidedBoxes: Box[]) {
  const last = view.bottom - height;
  if (last < view.top) return view.top;
  // A clear margin around protected controls, which also covers the mascot's small hop.
  protectedBoxes = protectedBoxes.map(box => ({ left: box.left, right: box.right, top: box.top - EDGE * 1.5, bottom: box.bottom + EDGE * 1.5 }));
  const anchorTop = protectedBoxes.length ? Math.min(...protectedBoxes.map(box => box.top)) - EDGE - height : view.top;
  const candidates = new Set<number>([view.top, last]);
  if (anchorTop >= view.top && anchorTop <= last) candidates.add(anchorTop);
  for (let top = view.top; top <= last; top += 4) candidates.add(top);
  let best: { top: number; cost: number; distance: number } | null = null;
  for (const top of candidates) {
    if (overlapArea(top, height, left, right, protectedBoxes) > 0) continue;
    const cost = overlapArea(top, height, left, right, avoidedBoxes);
    const distance = Math.abs(top - anchorTop);
    if (!best || cost < best.cost || (cost === best.cost && distance < best.distance)) best = { top, cost, distance };
  }
  return best?.top ?? view.top;
}

const visibleBoxes = (selector: string | undefined, view: { top: number; bottom: number }): Box[] => selector
  ? Array.from(document.querySelectorAll(selector)).map(element => element.getBoundingClientRect())
    .filter(box => box.width > 0 && box.height > 0 && box.bottom > view.top && box.top < view.bottom)
  : [];

function usePhoneLayout() {
  const [phone, setPhone] = useState(() => typeof window !== "undefined" && window.matchMedia(PHONE_QUERY).matches);
  useEffect(() => {
    const query = window.matchMedia(PHONE_QUERY);
    const update = () => setPhone(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return phone;
}

/** Text-only presentation. Dismissal never changes the activity's data. */
export default function ReadingMascot({
  mood, message, language, eventId, live = false, placement = "dock", protectSelector, avoidSelector,
}: ReadingMascotProps) {
  const anchor = useRef<HTMLSpanElement>(null);
  const overlay = useRef<HTMLElement>(null);
  const dismissed = useRef(new Set<string>());
  const [, redraw] = useState(0);
  const [host, setHost] = useState<Element | null>(null);
  const phone = usePhoneLayout();
  const compact = placement === "overlay-left" && phone;
  const key = eventId ?? `${mood}:${message}`;
  const visible = Boolean(message) && !dismissed.current.has(key);
  const { t } = getActivityText(language);

  useLayoutEffect(() => {
    // A sibling of the scrolling activity reserves space, keeping every control reachable.
    setHost(anchor.current?.closest(".basa-main-shell") ?? null);
  }, []);

  useLayoutEffect(() => {
    if (placement !== "overlay-left" || !visible) return;
    const panel = anchor.current?.closest(".basa-content");
    const popup = overlay.current;
    if (!panel || !popup) return;
    let frame = 0;
    const position = () => {
      const bounds = panel.getBoundingClientRect();
      const view = { top: Math.max(EDGE, bounds.top + EDGE), bottom: Math.min(window.innerHeight, bounds.bottom) - EDGE };
      if (compact) {
        // Phones: a compact popup inside the visible panel that never covers the action buttons.
        const left = Math.max(EDGE, bounds.left + EDGE);
        const right = Math.min(window.innerWidth, bounds.right) - EDGE;
        popup.style.left = `${left}px`;
        popup.style.width = `${right - left}px`;
        popup.style.bottom = "auto";
        const height = popup.offsetHeight;
        popup.style.top = `${chooseCompactTop(view, height, left, right,
          visibleBoxes(protectSelector, view), visibleBoxes(avoidSelector, view))}px`;
        popup.style.visibility = "visible";
        return;
      }
      popup.style.top = "auto";
      const left = Math.max(8, bounds.left + 12);
      const width = Math.min(620, bounds.right - left - 12, window.innerWidth - left - 12);
      popup.style.left = `${left}px`;
      popup.style.width = `${width}px`;
      const bottom = Math.min(window.innerHeight - 12, bounds.bottom - 12);
      popup.style.bottom = `${window.innerHeight - bottom}px`;
      // Short panels: the large popup must still never reach the protected controls.
      const protectedBoxes = visibleBoxes(protectSelector, view);
      const clear = () => {
        const box = popup.getBoundingClientRect();
        return overlapArea(box.top, box.height, box.left, box.right, protectedBoxes) === 0;
      };
      if (protectedBoxes.length && !clear()) {
        // First narrow it so it ends before the controls beside it.
        const box = popup.getBoundingClientRect();
        const beside = protectedBoxes.filter(control => control.bottom > box.top - 4 && control.top < box.bottom + 4);
        const room = Math.min(...beside.map(control => control.left)) - 16 - left;
        if (room >= 360) popup.style.width = `${Math.min(width, room)}px`;
        // Otherwise move it up to the nearest clear space in the visible panel.
        if (!clear()) {
          popup.style.bottom = "auto";
          popup.style.top = `${chooseCompactTop(view, popup.offsetHeight, left, left + popup.offsetWidth + 4,
            protectedBoxes, visibleBoxes(avoidSelector, view))}px`;
        }
      }
      // Feedback remains visible until dismissed; overlap never changes the page layout.
      popup.style.visibility = "visible";
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(position); };
    const observer = new ResizeObserver(schedule);
    observer.observe(panel);
    observer.observe(popup);
    // Content growth (hint, answer review) moves the buttons without resizing the panel.
    if (anchor.current?.parentElement) observer.observe(anchor.current.parentElement);
    window.addEventListener("resize", schedule);
    document.addEventListener("scroll", schedule, true);
    position();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      document.removeEventListener("scroll", schedule, true);
    };
  }, [placement, visible, key, host, message, compact, protectSelector, avoidSelector]);

  useEffect(() => {
    if (!visible) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      // Let an open modal handle its own Escape key first.
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const modalOpen = Array.from(document.querySelectorAll('dialog[open], [aria-modal="true"]'))
        .some(element => element.getClientRects().length > 0);
      if (modalOpen) return;
      dismissed.current.add(key);
      redraw(value => value + 1);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [key, visible]);

  const popup = visible ? (
    <aside ref={overlay} className={`reading-mascot-dock${placement === "overlay-left" ? " reading-mascot-dock--overlay" : ""}${compact ? " reading-mascot-dock--compact" : ""}`} lang={language}>
      <div className={`reading-mascot reading-mascot--${mood}`}>
        <img key={key} className="reading-mascot-image" alt="" aria-hidden="true"
          src={cheering.has(mood) ? cheeringMascot : standingMascot} width={180} height={200} />
        <div className="reading-mascot-bubble">
          <button type="button" className="reading-mascot-close" aria-label={t("Close")}
            onClick={() => {
              dismissed.current.add(key);
              redraw(value => value + 1);
              anchor.current?.focus({ preventScroll: true });
            }}>
            <X size={20} aria-hidden="true" />
          </button>
          <p key={key} tabIndex={placement === "overlay-left" ? 0 : undefined} {...(live ? { role: "status" } : {})}>{message}</p>
        </div>
      </div>
    </aside>
  ) : null;

  return <>
    <span ref={anchor} className="reading-mascot-anchor" tabIndex={-1} />
    {placement === "overlay-left" ? createPortal(popup, document.body) : host ? createPortal(popup, host) : popup}
  </>;
}
