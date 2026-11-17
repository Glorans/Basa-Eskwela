import type { RefObject } from "react";
import { Menu } from "lucide-react";
import ProfileDropdown from "./ProfileDropdown";
import ImagePlaceholder from "./ImagePlaceholder";
import { BASA_IMAGES } from "../../assets/basaImages";
import "./BasaHeader.css";

interface BasaHeaderProps {
  onMenuClick: () => void;
  xp?: number;
  onProfileOpen?: () => void;
  menuExpanded: boolean;
  menuLabel: string;
  menuRef: RefObject<HTMLButtonElement>;
}

export default function BasaHeader({ onMenuClick, xp, onProfileOpen, menuExpanded, menuLabel, menuRef }: BasaHeaderProps) {
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
        <ProfileDropdown settingsPath="/dashboard/settings" onOpen={onProfileOpen} />
      </div>
    </header>
  );
}
