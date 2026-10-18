import {
  Star,
  Flame,
  BookOpenCheck,
  ArrowUpCircle,
  Target,
  Mic,
  Gem,
  GraduationCap,
  type LucideIcon,
} from "lucide-react";
import ImagePlaceholder from "../components/basa/ImagePlaceholder";
import { BASA_IMAGES } from "../assets/basaImages";
import "./MyBadges.css";

const ICONS: Record<string, LucideIcon> = {
  Star,
  Flame,
  BookOpenCheck,
  ArrowUpCircle,
  Target,
  Mic,
  Gem,
  GraduationCap,
};

interface LearnerBadge {
  id: string;
  name: string;
  description: string;
  earned: boolean;
  icon: keyof typeof ICONS;
}

// Populated when a persisted learner-badge source is introduced.
const badges: LearnerBadge[] = [];

export default function MyBadges() {
  return (
    <>
      <h1 className="basa-page-title">My Badges</h1>
      <p className="basa-page-subtitle">Your reading achievements will appear here.</p>

      <div className="basa-badges-card">
        {badges.length === 0 ? (
          <div className="basa-badges-empty">
            <strong>No badges earned yet.</strong>
            <span>Your badges will appear here as you complete reading activities.</span>
          </div>
        ) : (
          <div className="basa-badges-grid">
            {badges.map((badge) => {
              const Icon = ICONS[badge.icon];
              return (
                <div className={`basa-badge-tile ${badge.earned ? "" : "basa-badge-tile--locked"}`} key={badge.id}>
                  <span className="basa-badge-icon">
                    <Icon size={22} />
                  </span>
                  <p className="basa-badge-name">{badge.name}</p>
                  <p className="basa-badge-desc">{badge.description}</p>
                  <span className={`basa-badge-status ${badge.earned ? "basa-badge-status--earned" : ""}`}>
                    {badge.earned ? "Earned" : "Locked"}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        <ImagePlaceholder
          src={BASA_IMAGES.mascotThumbsUp}
          alt="Mascot giving a thumbs up"
          className="basa-badges-mascot"
          width={140}
          height={140}
        />
      </div>
    </>
  );
}
