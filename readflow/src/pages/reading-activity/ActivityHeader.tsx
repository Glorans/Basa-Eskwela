import { getActivityText, type ActivityLanguage } from "./activityLanguage";
import { ArrowLeft, User } from "lucide-react";
import { useNavigate } from "react-router-dom";
import "./ActivityHeader.css";

interface ActivityHeaderProps {
  title: string;
  language: string;
  uiLanguage?: ActivityLanguage;
  onBack?: () => void;
}

export default function ActivityHeader({ title, language, uiLanguage, onBack }: ActivityHeaderProps) {
  const { t } = getActivityText(uiLanguage);
  const navigate = useNavigate();

  return (
    <header className="activity-header">
      <div className="activity-header-left">
        <button
          className="activity-back-button"
          type="button"
          aria-label={t("Go back")}
          onClick={onBack ?? (() => navigate("/dashboard/materials"))}
        >
          <ArrowLeft size={20} />
        </button>
        <h1>{title}</h1>
        <span className="activity-language">{language}</span>
      </div>

      <div className="activity-header-right">
        <button className="activity-icon-button" type="button" aria-label={t("Account")}>
          <User size={20} />
        </button>
      </div>
    </header>
  );
}
