import type { RefObject } from "react";
import { Menu, User } from "lucide-react";
import { Link } from "react-router-dom";
import useAuthenticatedProfile from "../../hooks/useAuthenticatedProfile";
import { getProfileDisplayName } from "../../modules/module1/utils/profileFields";
import { isAppRole, ROLE_LABELS } from "../../modules/module1/utils/authOnboarding";
import ImagePlaceholder from "./ImagePlaceholder";
import { BASA_IMAGES } from "../../assets/basaImages";
import "./BasaHeader.css";

interface BasaHeaderProps {
  onMenuClick: () => void;
  xp?: number;
  menuExpanded: boolean;
  menuLabel: string;
  menuRef: RefObject<HTMLButtonElement>;
}

export default function BasaHeader({ onMenuClick, xp, menuExpanded, menuLabel, menuRef }: BasaHeaderProps) {
  const { profile, loading } = useAuthenticatedProfile();
  const showIdentity = !loading && !!profile;
  const shouldShowRole = profile?.role === "teacher" || profile?.role === "admin";
  const roleLabel = profile && isAppRole(profile.role) ? ROLE_LABELS[profile.role] : "";
  return (
    <header className="basa-header">
      <div className="basa-header-left">
        <button
          className="basa-icon-button basa-menu-button"
          type="button"
          aria-label={menuLabel}
          title={menuLabel}
          aria-controls="basa-navigation"
          aria-expanded={menuExpanded}
          ref={menuRef}
          onClick={onMenuClick}
        >
          <Menu size={22} />
        </button>
      </div>

      <div className="basa-header-right">
        {typeof xp === "number" && Number.isFinite(xp) && (
          <span className="basa-xp-pill">
            {xp}
            <ImagePlaceholder src={BASA_IMAGES.xpStar} alt="XP star icon" className="basa-xp-star" width={20} height={20} />
          </span>
        )}
        <Link className="basa-account-link" to="/dashboard/settings" aria-label="Profile and Account">
          <span className="basa-icon-button basa-user-button" aria-hidden="true"><User size={20} /></span>
          {showIdentity && (
            <span className="basa-account-copy">
              <strong>{getProfileDisplayName(profile)}</strong>
              {shouldShowRole && <small>{roleLabel}</small>}
            </span>
          )}
        </Link>
      </div>
    </header>
  );
}
