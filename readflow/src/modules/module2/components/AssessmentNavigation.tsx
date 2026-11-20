import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ChevronDown, ClipboardList } from "lucide-react";
import { getAssessmentPackage } from "../services/assessmentPackages";
import "./AssessmentNavigation.css";

/**
 * M2 expandable Assessment group in the sidebar.
 *   System Admin:  Assessment > Initial Diagnostic, Reassessment (F6/F7/F10)
 *   School Admin:  Assessment > Packages (F10), Assignments (F9)
 *   Teacher:       Assessment > Packages (F10), Assignments (F9)
 * The group stays open on its own pages; the item for the current page is marked aria-current.
 */
export type AssessmentNavigationRole = "system_admin" | "admin" | "teacher";
type Item = { key: string; label: string; to: string; matches: (pathname: string) => boolean };

const under = (prefix: string) => (pathname: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);
const ROLE_ITEMS: Record<Exclude<AssessmentNavigationRole, "system_admin">, Item[]> = {
  admin: [
    { key: "packages", label: "Packages", to: "/admin/assessment-packages", matches: under("/admin/assessment-packages") },
    { key: "assignments", label: "Assignments", to: "/admin/reassessment-assignments", matches: under("/admin/reassessment-assignments") },
  ],
  teacher: [
    { key: "packages", label: "Packages", to: "/m3/teacher/assessment-packages", matches: under("/m3/teacher/assessment-packages") },
    { key: "assignments", label: "Assignments", to: "/m3/teacher/reassessment-assignments", matches: under("/m3/teacher/reassessment-assignments") },
  ],
};

export default function AssessmentNavigation({ role = "system_admin", onNavigate, onExpand }: {
  role?: AssessmentNavigationRole; onNavigate: () => void; onExpand: () => void;
}) {
  const { pathname } = useLocation();
  const system = role === "system_admin";
  const items = system ? null : ROLE_ITEMS[role];
  const inAssessment = system ? pathname.startsWith("/system-admin/assessment") : items!.some((item) => item.matches(pathname));
  const [expanded, setExpanded] = useState(inAssessment);
  const [detailSection, setDetailSection] = useState("");
  useEffect(() => {
    if (inAssessment) setExpanded(true);
    setDetailSection("");
    if (!system) return undefined;
    const match = pathname.match(/^\/system-admin\/assessment-packages\/([^/]+)$/);
    let current = true;
    if (match) void getAssessmentPackage(match[1]).then(detail => {
      if (current) setDetailSection(detail.package.category === "initial" ? "initial" : "reassessment");
    }).catch(() => {});
    return () => { current = false; };
  }, [pathname, inAssessment, system]);
  const links: { key: string; label: string; to: string; active: boolean }[] = system
    ? [["initial", "Initial Diagnostic"], ["reassessment", "Reassessment"]].map(([section, label]) => ({
      key: section, label, to: `/system-admin/assessment/${section}`,
      active: pathname === `/system-admin/assessment/${section}` || detailSection === section,
    }))
    : items!.map((item) => ({ key: item.key, label: item.label, to: item.to, active: item.matches(pathname) }));
  return <div className="m2-assessment-nav">
    <button className={`m3-nav-item${inAssessment ? " m3-nav-item--active" : ""}`} type="button"
      aria-label="Assessment" title="Assessment" aria-expanded={expanded} aria-controls="m2-assessment-submenu"
      onClick={() => { onExpand(); setExpanded(value => !value); }}>
      <ClipboardList size={19} /><span className="rf-nav-label">Assessment</span><ChevronDown size={16} />
    </button>
    <div id="m2-assessment-submenu" hidden={!expanded}>
      {links.map(({ key, label, to, active }) => <Link key={key} to={to} onClick={onNavigate}
        title={label} aria-current={active ? "page" : undefined}
        className={`m3-nav-item m2-assessment-subitem${active ? " m3-nav-item--active" : ""}`}>{label}</Link>)}
    </div>
  </div>;
}
