import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { activityLanguageState } from "../../../pages/reading-activity/activityLanguage";
import { getPracticeReadingPassages, type AdminReadingPassage } from "../services/oralReadingService";
import { PRACTICE_PATHS, comprehensionPreviewTarget, readAloudTarget } from "../services/oralReadingNavigation";
import type { PracticeRole } from "../types/oralReading";

/**
 * Staff practice passage list (System Admin, School Admin, approved Teacher): the published reading modules the
 * account may use. A School Admin or Teacher sees their school's modules and platform modules; the System Admin sees
 * every published module. Never another school's. Own practice results only.
 */
export default function AdminOralReadingPage({ role = "admin" }: { role?: PracticeRole }) {
  const [passages, setPassages] = useState<AdminReadingPassage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void getPracticeReadingPassages()
      .then((rows) => {
        if (active) setPassages(rows);
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : "Unable to load passages.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [revision, role]);
  return (
    <section className="m-4 rounded-3xl bg-white p-6 text-[#173f3b] md:m-8">
      <h1 className="text-3xl font-extrabold">{role === "admin" ? "Oral Reading" : "Reading Practice"}</h1>
      <p className="mt-2">
        {role === "system_admin"
          ? "Try reading aloud and answering comprehension questions on any published reading module, in every school."
          : "Try reading aloud and answering comprehension questions on your school's published reading modules and the platform's."}
        {" "}Your practice results are private to you, are not part of any classroom and never count as Student results.
      </p>
      <Link className="mt-3 inline-block font-bold underline" to={PRACTICE_PATHS[role].history}>
        My Practice History
      </Link>
      {loading ? (
        <p role="status" className="my-4">Loading passages...</p>
      ) : error ? (
        <div role="alert" className="my-4">
          <p>{error}</p>
          <button
            type="button"
            className="mt-3 rounded-xl bg-[#f7cf4a] px-4 py-2 font-bold"
            onClick={() => setRevision((value) => value + 1)}
          >
            Retry
          </button>
        </div>
      ) : passages.length === 0 ? (
        <p role="status" className="my-4">No published reading modules to practise yet.</p>
      ) : (
        <ul className="my-4 space-y-4">
          {passages.map((passage) => (
            <li
              key={`${passage.moduleId}/${passage.passageId ?? "legacy"}`}
              className="rounded-2xl border border-[#dce8e7] p-5"
            >
              <h2 className="text-xl font-bold">{passage.moduleTitle}</h2>
              <p>
                {passage.passageTitle} · {passage.language === "fil" ? "Filipino" : "English"}
              </p>
              <Link
                className="mt-3 inline-block rounded-xl bg-[#f7cf4a] px-4 py-2 font-bold"
                to={readAloudTarget(role, passage.moduleId, { passageId: passage.passageId })}
                state={activityLanguageState(passage.language)}
              >
                Start Read-Aloud<span className="sr-only">: {passage.passageTitle}</span>
              </Link>
              {passage.passageId && (
                // M6 F5: read-only preview of this passage's comprehension questions (never the answers).
                <Link
                  className="ml-3 mt-3 inline-block rounded-xl border border-[#173f3b] px-4 py-2 font-bold"
                  to={comprehensionPreviewTarget(role, passage.moduleId, { passageId: passage.passageId })}
                >
                  Preview Questions<span className="sr-only">: {passage.passageTitle}</span>
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
