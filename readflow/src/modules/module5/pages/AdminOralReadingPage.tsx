import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { activityLanguageState } from "../../../pages/reading-activity/activityLanguage";
import { getAdminReadingPassages, type AdminReadingPassage } from "../services/oralReadingService";
import { readAloudTarget } from "../services/oralReadingNavigation";

export default function AdminOralReadingPage() {
  const [passages, setPassages] = useState<AdminReadingPassage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void getAdminReadingPassages()
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
  }, [revision]);
  return (
    <section className="m-4 rounded-3xl bg-white p-6 text-[#173f3b] md:m-8">
      <h1 className="text-3xl font-extrabold">Oral Reading</h1>
      <p className="my-3">
        Choose a published passage, record your reading, and receive feedback. Your recordings and
        results are saved to your admin account only.
      </p>
      <Link className="font-bold underline" to="/admin/reading-history">
        My Reading History
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
        <p role="status" className="my-4">No published reading passages are available.</p>
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
                to={readAloudTarget("admin", passage.moduleId, { passageId: passage.passageId })}
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
