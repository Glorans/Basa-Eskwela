import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { activityLanguageState } from "../../../pages/reading-activity/activityLanguage";
import { getAdminReadingPassages, getPracticeReadingPassages, type AdminReadingPassage } from "../services/oralReadingService";
import { PRACTICE_PATHS, readAloudTarget } from "../services/oralReadingNavigation";
import type { PracticeRole } from "../types/oralReading";

/**
 * Practice passage list. Admin (default): the published modules this Admin created.
 * Approved Teacher: every published module in the shared catalog. Own practice results only.
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
    void (role === "teacher" ? getPracticeReadingPassages() : getAdminReadingPassages())
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
      <h1 className="text-3xl font-extrabold">{role === "teacher" ? "Reading Practice" : "Oral Reading"}</h1>
      {role === "teacher" && (
        <>
          <p className="mt-2">
            Practise reading aloud and answering comprehension questions on any published reading module.
            Your practice results are private to you and are not part of any classroom.
          </p>
          <Link className="mt-3 inline-block font-bold underline" to={PRACTICE_PATHS.teacher.history}>
            My Practice History
          </Link>
        </>
      )}
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
        // Admin practice uses only published modules this Admin created; Teacher practice uses the published catalog.
        <p role="status" className="my-4">
          {role === "teacher"
            ? "No published reading modules to practise yet."
            : "No passages to practise yet. Admin practice uses the published modules you created."}
        </p>
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
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
