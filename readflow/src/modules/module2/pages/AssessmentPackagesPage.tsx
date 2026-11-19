import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
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
import type { DiagnosticLanguage } from "../types/diagnostic";
import "../../module7/m7.css";
import "./AssessmentPackages.css";

export type AssessmentPackageRole = "system_admin" | "admin" | "teacher";

export const ASSESSMENT_PACKAGE_PATHS: Record<AssessmentPackageRole, string> = {
  system_admin: "/system-admin/assessment-packages",
  admin: "/admin/assessment-packages",
  teacher: "/m3/teacher/assessment-packages",
};

const PAGE_COPY: Record<AssessmentPackageRole, { title: string; intro: string; groups: PackageCategory[] }> = {
  system_admin: {
    title: "Assessment Packages",
    intro: "Manage the initial diagnostic for all learners and the centrally approved reassessment packages for Independent Learners.",
    groups: ["initial", "independent"],
  },
  admin: {
    title: "Reassessment Packages",
    intro: "Manage the school's classroom reassessment packages and review the packages Teachers submit.",
    groups: ["school", "teacher"],
  },
  teacher: {
    title: "Reassessment Packages",
    intro: "Create private reassessment packages for Students in your Learning Rooms. Only you and your School Admin can see them.",
    groups: ["teacher"],
  },
};

/** M2 F6 + F10: the package list for System Admins, School Admins and approved Teachers. */
export default function AssessmentPackagesPage({ role }: { role: AssessmentPackageRole }) {
  const navigate = useNavigate();
  const copy = PAGE_COPY[role];
  const basePath = ASSESSMENT_PACKAGE_PATHS[role];
  const [list, setList] = useState<PackageList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [title, setTitle] = useState("");
  const [language, setLanguage] = useState<DiagnosticLanguage>("en");
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

  const groups = useMemo(() => copy.groups.map((group) => ({
    group,
    packages: (list?.packages ?? []).filter((pkg) => pkg.category === group),
  })), [copy.groups, list]);

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
      <h1>{copy.title}</h1>
      <p className="m2-packages-intro">{copy.intro}</p>
      <p className="m2-packages-notice" role="note">
        "Published in library" is not the same as "Active for learner assessment". Learners continue to take the current
        initial diagnostic (version 3.0), reassessment is not available to learners yet, and existing results and
        reading levels are not changed. Official use will require a documented educator endorsement.
      </p>

      {loading && <p role="status">Loading assessment packages...</p>}
      {error && (
        <div role="alert">
          <p>{error}</p>
          <button type="button" onClick={() => void load()}>Try Again</button>
        </div>
      )}

      {!loading && !error && list && (
        <>
          {(list.capabilities.create.length > 0 || list.capabilities.importInitial.length > 0) && (
            <section className="m2-packages-panel" aria-labelledby="m2-packages-new">
              <h2 id="m2-packages-new">New Package</h2>
              {list.capabilities.importInitial.length > 0 && (
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
              {list.capabilities.create.length > 0 && (
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
                <PackageTable packages={packages} basePath={basePath} showOwner={role === "admin" && group === "teacher"} />
              )}
            </section>
          ))}
        </>
      )}
    </main>
  );
}

function PackageTable({ packages, basePath, showOwner }: { packages: PackageSummary[]; basePath: string; showOwner: boolean }) {
  return (
    <div className="m2-packages-table-wrap">
      <table className="m2-packages-table">
        <thead>
          <tr>
            <th scope="col">Title</th>
            <th scope="col">Language</th>
            {showOwner && <th scope="col">Teacher</th>}
            <th scope="col">Published in library</th>
            <th scope="col">Active for learners</th>
            <th scope="col">Latest version</th>
          </tr>
        </thead>
        <tbody>
          {packages.map((pkg) => (
            <tr key={pkg.id}>
              <td>
                <Link to={`${basePath}/${pkg.id}`}>{pkg.title}</Link>
                {pkg.archived && <span className="m2-packages-tag">Archived</span>}
              </td>
              <td>{LANGUAGE_LABELS[pkg.language]}</td>
              {showOwner && <td>{pkg.ownerName ?? "Teacher"}</td>}
              <td>{pkg.publishedVersion ? `Version ${pkg.publishedVersion}` : "None"}</td>
              <td>{pkg.activeVersion ? `Version ${pkg.activeVersion}` : "No"}</td>
              <td>
                {pkg.latestVersion
                  ? <>Version {pkg.latestVersion.versionLabel} <span className="m2-packages-status" data-status={pkg.latestVersion.status}>{STATUS_LABELS[pkg.latestVersion.status]}</span></>
                  : "None"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
