import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ChevronDown, ClipboardList } from "lucide-react";
import { getAssessmentPackage } from "../services/assessmentPackages";
import "./AssessmentNavigation.css";

export default function AssessmentNavigation({ onNavigate, onExpand }: { onNavigate: () => void; onExpand: () => void }) {
  const { pathname } = useLocation();
  const inAssessment = pathname.startsWith("/system-admin/assessment");
  const [expanded, setExpanded] = useState(inAssessment);
  const [detailSection, setDetailSection] = useState("");
  useEffect(() => {
    if (inAssessment) setExpanded(true);
    setDetailSection("");
    const match = pathname.match(/^\/system-admin\/assessment-packages\/([^/]+)$/);
    let current = true;
    if (match) void getAssessmentPackage(match[1]).then(detail => {
      if (current) setDetailSection(detail.package.category === "initial" ? "initial" : "reassessment");
    }).catch(() => {});
    return () => { current = false; };
  }, [pathname, inAssessment]);
  return <div className="m2-assessment-nav">
    <button className={`m3-nav-item${inAssessment ? " m3-nav-item--active" : ""}`} type="button"
      aria-label="Assessment" title="Assessment" aria-expanded={expanded} aria-controls="m2-assessment-submenu"
      onClick={() => { onExpand(); setExpanded(value => !value); }}>
      <ClipboardList size={19} /><span className="rf-nav-label">Assessment</span><ChevronDown size={16} />
    </button>
    <div id="m2-assessment-submenu" hidden={!expanded}>
      {[["initial", "Initial Diagnostic"], ["reassessment", "Reassessment"]].map(([section, label]) => {
        const active = pathname === `/system-admin/assessment/${section}` || detailSection === section;
        return <Link key={section} to={`/system-admin/assessment/${section}`} onClick={onNavigate}
          title={label} aria-current={active ? "page" : undefined}
          className={`m3-nav-item m2-assessment-subitem${active ? " m3-nav-item--active" : ""}`}>{label}</Link>;
      })}
    </div>
  </div>;
}
