import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import {
  CATEGORY_LABELS,
  LANGUAGE_LABELS,
  STATUS_LABELS,
  createAssessmentPackage,
  importInitialDiagnostic,
  listAssessmentPackages,
  type PackageCategory,
  type PackageList,
  type PackageSummary,
} from "../services/assessmentPackages";
import { useAssessmentLeaveGuard } from "../hooks/useAssessmentLeaveGuard";
import { INITIAL_STATUS_LABELS, initialAssessmentName } from "../utils/initialDiagnosticLabels";
import type { DiagnosticLanguage } from "../types/diagnostic";
import "../../module7/m7.css";
import "./AssessmentPackages.css";
import AssessmentBackButton from "../components/AssessmentBackButton";
import { getRoleHomePath } from "../../module1/utils/authOnboarding";

export type AssessmentPackageRole = "system_admin" | "admin" | "teacher";

export const ASSESSMENT_PACKAGE_PATHS: Record<AssessmentPackageRole, string> = {
  system_admin: "/system-admin/assessment-packages",
  admin: "/admin/assessment-packages",
  teacher: "/m3/teacher/assessment-packages",
};

const PAGE_COPY: Record<AssessmentPackageRole, { title: string; intro: string; groups: PackageCategory[] }> = {
  system_admin: {
    title: "Assessment Packages",
    intro: "Manage the initial diagnostic for all learners and the central reassessment packages for Independent Learners.",
    groups: ["initial", "independent"],
  },
  admin: {
    title: "Reassessment Packages",
    intro: "Create and publish the school's classroom reassessment packages.",
    groups: ["school"],
  },
  teacher: {
    title: "Reassessment Packages",
    intro: "Create and publish private reassessment packages for Students in your Learning Rooms. Only you can see and change them.",
    groups: ["teacher"],
  },
};

/** M2 F6 + F10: the package list for System Admins, School Admins and approved Teachers. */
export default function AssessmentPackagesPage({ role, section }: { role: AssessmentPackageRole; section?: "initial" | "independent" }) {
  const navigate = useNavigate();
  const copy = section ? { title: section === "initial" ? "Initial Diagnostic" : "Reassessment",
    intro: section === "initial" ? "Manage the English and Filipino initial diagnostics, drafts and published versions."
      : "Manage central reassessment materials for Independent Learners.", groups: [section] } : PAGE_COPY[role];
  const [filter, setFilter] = useState("all");
  const [showCreate, setShowCreate] = useState(false);
  const landing = role === "system_admin" && !section;
  const basePath = ASSESSMENT_PACKAGE_PATHS[role];
  const [list, setList] = useState<PackageList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [title, setTitle] = useState("");
  const [language, setLanguage] = useState<DiagnosticLanguage>("en");
  useAssessmentLeaveGuard(Boolean(title.trim()) && !busy);
  const [category, setCategory] = useState<PackageCategory | "">("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const next = await listAssessmentPackages();
      setList(next);
      setCategory((current) => current || next.capabilities.create[0] || "");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load assessment packages.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const groups = useMemo(() => (landing ? [] : copy.groups).map((group) => ({
    group,
    packages: (list?.packages ?? []).filter((pkg) => pkg.category === group && (filter === "all" || pkg.language === filter)),
  })), [copy.groups, list, filter, landing]);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (!category || busy) return;
    if (!title.trim()) { setFormError("Add a package title."); return; }
    setBusy(true);
    setFormError("");
    try {
      const created = await createAssessmentPackage({ category, language, title: title.trim() });
      navigate(`${basePath}/${created.package.id}`);
    } catch (createError) {
      setFormError(createError instanceof Error ? createError.message : "Unable to create the package.");
    } finally {
      setBusy(false);
    }
  };

  const importInitial = async (lang: DiagnosticLanguage) => {
    if (busy) return;
    setBusy(true);
    setFormError("");
    try {
      const imported = await importInitialDiagnostic(lang);
      navigate(`${basePath}/${imported.package.id}`);
    } catch (importError) {
      setFormError(importError instanceof Error ? importError.message : "Unable to import the diagnostic.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="m7-page m2-packages-page">
      {section && <Link className="m3-back-link" to={basePath}><ArrowLeft size={17} aria-hidden="true" /> Back to Assessment</Link>}
      {role !== "system_admin" && <AssessmentBackButton fallback={getRoleHomePath(role)} />}
      <h1>{landing ? "Assessment" : copy.title}</h1>
      {landing && <div className="m2-assessment-cards">
        <Link to="/system-admin/assessment/initial"><strong>Initial Diagnostic</strong><span>Manage the English and Filipino initial diagnostics.</span></Link>
        <Link to="/system-admin/assessment/reassessment"><strong>Reassessment</strong><span>Manage central reassessment packages for Independent Learners.</span></Link>
      </div>}
      {section && <div className="m2-packages-actions"><label>Language <select aria-label="Filter by language" value={filter} onChange={e => setFilter(e.target.value)}>
        <option value="all">All languages</option><option value="en">English</option><option value="fil">Filipino</option>
      </select></label>{section === "independent" && !!list?.capabilities.create.includes("independent") && <button type="button" aria-expanded={showCreate} onClick={() => setShowCreate(v => !v)}>{showCreate ? "Close Create Package" : "Create Package"}</button>}</div>}
      {!landing && <p className="m2-packages-intro">{copy.intro}</p>}
      {/* System Admin pages keep only actionable text; School Admin and Teacher pages keep their notice. */}
      {role !== "system_admin" && <p className="m2-packages-notice" role="note">
        Publishing a version does not assign it. Assign published packages to Students in Reassessment Assignments;
        Students take them only while reassessment is turned on. Existing results and reading levels are not changed.
      </p>}

      {loading && <p role="status">Loading assessment packages...</p>}
      {error && (
        <div role="alert">
          <p>{error}</p>
          <button type="button" onClick={() => void load()}>Try Again</button>
        </div>
      )}

      {!loading && !error && list && (
        <>
          {!landing && (role !== "system_admin" || section === "initial" || showCreate) && (section === "initial" ? list.capabilities.importInitial.length > 0 : list.capabilities.create.length > 0 || list.capabilities.importInitial.length > 0) && (
            <section className="m2-packages-panel" aria-labelledby="m2-packages-new">
              <h2 id="m2-packages-new">New Package</h2>
              {section !== "independent" && list.capabilities.importInitial.length > 0 && (
                <div className="m2-packages-import">
                  <p>
                    Start the initial diagnostic package from the version learners take today. The current version 3.0 is
                    recorded as published without changes; new versions are then written from it.
                  </p>
                  <div className="m2-packages-actions">
                    {list.capabilities.importInitial.map((lang) => (
                      <button key={lang} type="button" disabled={busy} onClick={() => void importInitial(lang)}>
                        Import {LANGUAGE_LABELS[lang]} Diagnostic 3.0
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {section !== "initial" && list.capabilities.create.length > 0 && (
                <form className="m2-packages-form" onSubmit={(event) => void create(event)}>
                  {list.capabilities.create.length > 1 ? (
                    <label>
                      <span>Package type</span>
                      <select value={category} onChange={(event) => setCategory(event.target.value as PackageCategory)}>
                        {list.capabilities.create.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
                      </select>
                    </label>
                  ) : (
                    <p className="m2-packages-fixed">Package type: {CATEGORY_LABELS[list.capabilities.create[0]]}</p>
                  )}
                  <label>
                    <span>Language</span>
                    <select value={language} onChange={(event) => setLanguage(event.target.value as DiagnosticLanguage)}>
                      <option value="en">English</option>
                      <option value="fil">Filipino</option>
                    </select>
                  </label>
                  <label>
                    <span>Package title</span>
                    <input value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} />
                  </label>
                  <button type="submit" disabled={busy}>Create Package</button>
                </form>
              )}
              {formError && <p role="alert" className="m2-packages-error">{formError}</p>}
            </section>
          )}

          {groups.map(({ group, packages }) => (
            <section key={group} aria-labelledby={`m2-packages-${group}`}>
              <h2 id={`m2-packages-${group}`}>{CATEGORY_LABELS[group]}</h2>
              {packages.length === 0 ? (
                <p className="m2-packages-empty">No packages yet.</p>
              ) : (
                <PackageTable packages={packages} basePath={basePath} showOwner={role === "admin" && group === "teacher"} initial={group === "initial"} />
              )}
            </section>
          ))}
        </>
      )}
    </main>
  );
}

/**
 * `initial`: the System Admin's Initial Diagnostic list uses the assessment's NAME (the stored title may be a passage
 * title) and plain status words. Reassessment lists are unchanged.
 */
function PackageTable({ packages, basePath, showOwner, initial = false }: { packages: PackageSummary[]; basePath: string; showOwner: boolean; initial?: boolean }) {
  const statusLabels = initial ? INITIAL_STATUS_LABELS : STATUS_LABELS;
  return (
    <div className="m2-packages-table-wrap">
      <table className="m2-packages-table">
        <thead>
          <tr>
            <th scope="col">{initial ? "Assessment" : "Title"}</th>
            <th scope="col">Language</th>
            {showOwner && <th scope="col">Teacher</th>}
            <th scope="col">{initial ? "Published version" : "Published in library"}</th>
            <th scope="col">{initial ? "Active version" : "Active for learners"}</th>
            <th scope="col">Latest version</th><th scope="col">Action</th>
          </tr>
        </thead>
        <tbody>
          {packages.map((pkg) => (
            <tr key={pkg.id}>
              <td>
                <Link to={`${basePath}/${pkg.id}`}>{initial ? initialAssessmentName(pkg.language) : pkg.title}</Link>
                {pkg.archived && <span className="m2-packages-tag">Archived</span>}
              </td>
              <td>{LANGUAGE_LABELS[pkg.language]}</td>
              {showOwner && <td>{pkg.ownerName ?? "Teacher"}</td>}
              <td>{pkg.publishedVersion ? `Version ${pkg.publishedVersion}` : "None"}</td>
              <td>{pkg.activeVersion ? `Version ${pkg.activeVersion}` : initial ? "None" : "No"}</td>
              <td>
                {pkg.latestVersion
                  ? <>Version {pkg.latestVersion.versionLabel} <span className="m2-packages-status" data-status={pkg.latestVersion.status}>{statusLabels[pkg.latestVersion.status]}</span></>
                  : "None"}
              </td><td><Link to={`${basePath}/${pkg.id}`}>Open / Manage</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
