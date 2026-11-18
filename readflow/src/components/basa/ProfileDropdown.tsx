import { useEffect, useId, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Settings, User } from "lucide-react";
import useAuthenticatedProfile from "../../hooks/useAuthenticatedProfile";
import { getProfileDisplayName, getProfileInitials } from "../../modules/module1/utils/profileFields";
import { isAppRole, ROLE_LABELS } from "../../modules/module1/utils/authOnboarding";
import "./ProfileDropdown.css";

/** Header account menu for every role: who is signed in and Settings. Logout is at the bottom of the sidebar. */
export default function ProfileDropdown({ settingsPath, onOpen }: { settingsPath: string; onOpen?: () => void }) {
  const { profile, loading } = useAuthenticatedProfile();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  const location = useLocation();
  const showIdentity = !loading && !!profile;
  const name = getProfileDisplayName(profile);
  const roleLabel = profile && isAppRole(profile.role) ? ROLE_LABELS[profile.role] : "";

  useEffect(() => { setOpen(false); }, [location]);
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  return <div className="profile-dropdown" ref={root} onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false);
  }} onKeyDown={(event) => {
    if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); event.stopPropagation(); }
  }}>
    <button ref={trigger} className="profile-dropdown-trigger" type="button" aria-label="Profile and Account"
      aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => { if (!open) onOpen?.(); setOpen(!open); }}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); onOpen?.(); setOpen(true); }
      }}>
      <span className="profile-dropdown-avatar" aria-hidden="true">{showIdentity ? getProfileInitials(profile) : <User size={20} />}</span>
      {showIdentity && <span className="profile-dropdown-copy"><strong>{name}</strong><small>{roleLabel}</small></span>}
    </button>
    {open && <div className="profile-dropdown-panel">
      <div className="profile-dropdown-identity"><span className="profile-dropdown-avatar" aria-hidden="true">{getProfileInitials(profile)}</span><span><strong>{name}</strong><small>{roleLabel}</small></span></div>
      <div id={id} role="menu" aria-label="Account" ref={menu} onKeyDown={(event) => {
        const items = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
        const index = items.indexOf(document.activeElement as HTMLElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
          : event.key === "ArrowDown" ? (index + 1) % items.length
            : event.key === "ArrowUp" ? (index - 1 + items.length) % items.length : -1;
        if (next >= 0) { event.preventDefault(); items[next]?.focus(); }
      }}>
        <Link role="menuitem" to={settingsPath} onClick={() => setOpen(false)}><Settings size={18} aria-hidden="true" />Settings</Link>
      </div>
    </div>}
  </div>;
}
