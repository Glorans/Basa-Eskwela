import { ArrowLeft } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import AdminStudentAssessmentModal from "../components/AdminStudentAssessmentModal";
import {
  getAdminStudentReadings,
  getAdminStudents,
  type AdminStudentSummary,
  type OwnOralReadingSummary,
} from "../services/oralReadingService";
import { numberHistoryReadings } from "../services/savedAttemptOrder";

const CARD_CLASS = "block w-full cursor-pointer rounded-2xl border-2 border-[#dce8e7] bg-white p-5 text-left transition hover:border-[#173f3b] focus-visible:border-[#173f3b] focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-[#f7cf4a]";

/**
 * Admin M5 F5/F7: read-only review of students' saved oral-reading assessments.
 * The server enforces who is in scope (accounts with the "student" role); the
 * Admin's own practice readings stay in Reading History. Choose a student, then
 * a reading; its assessment opens in a modal and the URL does not change.
 */
export default function AdminStudentReadingAssessmentsPage() {
  const [students, setStudents] = useState<AdminStudentSummary[]>([]);
  const [studentsLoading, setStudentsLoading] = useState(true);
  const [studentsFailed, setStudentsFailed] = useState(false);
  const [studentsRevision, setStudentsRevision] = useState(0);
  const [search, setSearch] = useState("");

  const [student, setStudent] = useState<AdminStudentSummary | null>(null);
  const [readings, setReadings] = useState<OwnOralReadingSummary[]>([]);
  const [readingsLoading, setReadingsLoading] = useState(false);
  const [readingsFailed, setReadingsFailed] = useState(false);
  const [readingsRevision, setReadingsRevision] = useState(0);

  // The one open assessment, and the card to refocus when it closes.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const lastSelected = useRef<string | null>(null);
  const cards = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    let active = true;
    setStudentsLoading(true);
    setStudentsFailed(false);
    void getAdminStudents()
      .then((rows) => { if (active) setStudents(rows); })
      .catch(() => { if (active) setStudentsFailed(true); })
      .finally(() => { if (active) setStudentsLoading(false); });
    return () => { active = false; };
  }, [studentsRevision]);

  const studentId = student?.id;
  useEffect(() => {
    if (!studentId) return undefined;
    let active = true;
    setReadings([]);
    setReadingsLoading(true);
    setReadingsFailed(false);
    void getAdminStudentReadings(studentId)
      .then((result) => { if (active) setReadings(result.attempts); })
      .catch(() => { if (active) setReadingsFailed(true); })
      .finally(() => { if (active) setReadingsLoading(false); });
    return () => { active = false; };
  }, [studentId, readingsRevision]);

  // Closing the assessment returns keyboard focus to the card that opened it.
  useEffect(() => {
    if (selectedId === null && lastSelected.current) cards.current.get(lastSelected.current)?.focus();
  }, [selectedId]);

  const openStudent = (next: AdminStudentSummary) => {
    lastSelected.current = null;
    setSelectedId(null);
    setStudent(next);
  };
  const openReading = (id: string) => { lastSelected.current = id; setSelectedId(id); };

  const query = search.trim().toLocaleLowerCase();
  const shownStudents = query ? students.filter((row) => row.name.toLocaleLowerCase().includes(query)) : students;
  const numbers = numberHistoryReadings(readings);
  const ordered = [...readings].sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt) || (a.id < b.id ? 1 : -1));
  const selected = selectedId ? readings.find((reading) => reading.id === selectedId) : undefined;

  return (
    <section className="m-4 rounded-3xl bg-white p-6 text-[#173f3b] md:m-8">
      <h1 className="text-3xl font-extrabold">Student Reading Assessments</h1>
      <p className="my-3">Review students' saved oral-reading assessments. These results are read-only. Your own practice readings are in Reading History.</p>

      {!student ? (
        studentsLoading ? (
          <p role="status" className="my-4">Loading students…</p>
        ) : studentsFailed ? (
          <div role="alert" className="my-4">
            <p>Student reading assessments could not be loaded.</p>
            <button type="button" className="mt-3 rounded-xl bg-[#f7cf4a] px-4 py-2 font-bold" onClick={() => setStudentsRevision((value) => value + 1)}>Retry</button>
          </div>
        ) : students.length === 0 ? (
          <p role="status" className="my-4">No students have saved oral-reading assessments yet.</p>
        ) : (
          <>
            <label className="my-4 block font-bold">
              Search students
              <input
                type="search"
                className="mt-1 block w-full rounded-xl border-2 border-[#dce8e7] p-2 font-normal md:w-96"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            {shownStudents.length === 0 ? (
              <p role="status">No students match your search.</p>
            ) : (
              <ul className="space-y-4">
                {shownStudents.map((row) => (
                  <li key={row.id}>
                    <button type="button" className={CARD_CLASS} onClick={() => openStudent(row)}>
                      <span className="block text-xl font-bold">{row.name}</span>
                      <span className="block">{row.readingCount === 1 ? "1 saved reading" : `${row.readingCount} saved readings`}</span>
                      <span className="block">Latest: <time dateTime={row.latestCompletedAt}>{new Date(row.latestCompletedAt).toLocaleString()}</time></span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )
      ) : (
        <>
          <button type="button" className="my-3 inline-flex items-center gap-2 font-bold underline" onClick={() => setStudent(null)}>
            <ArrowLeft size={17} aria-hidden="true" /> All students
          </button>
          <h2 className="text-2xl font-bold">{student.name}</h2>
          {readingsLoading ? (
            <p role="status" className="my-4">Loading saved readings…</p>
          ) : readingsFailed ? (
            <div role="alert" className="my-4">
              <p>This student's readings could not be loaded.</p>
              <button type="button" className="mt-3 rounded-xl bg-[#f7cf4a] px-4 py-2 font-bold" onClick={() => setReadingsRevision((value) => value + 1)}>Retry</button>
            </div>
          ) : ordered.length === 0 ? (
            <p role="status" className="my-4">This student has no saved oral-reading assessments.</p>
          ) : (
            <ul className="my-4 space-y-4">
              {ordered.map((reading) => {
                const number = numbers.get(reading.id);
                return (
                  <li key={reading.id}>
                    <button
                      type="button"
                      ref={(element) => { if (element) cards.current.set(reading.id, element); else cards.current.delete(reading.id); }}
                      className={CARD_CLASS}
                      aria-haspopup="dialog"
                      onClick={() => openReading(reading.id)}
                    >
                      <span className="block text-xl font-bold">{reading.passageTitle || reading.moduleTitle}{number !== undefined && <> — Reading {number}</>}</span>
                      <span className="block">
                        <time dateTime={reading.completedAt}>{new Date(reading.completedAt).toLocaleString()}</time>
                        {reading.language && <> · {reading.language === "fil" ? "Filipino" : "English"}</>}
                      </span>
                      <span className="my-3 block">Reading accuracy: {Math.round(reading.pronunciationAccuracy)}% · Speed: {Math.round(reading.readingSpeedWpm)} WPM</span>
                      <span className="my-3 block">
                        Pronunciation Accuracy: {reading.pronunciationCheck && reading.pronunciationCheck.accuracy !== null ? `${reading.pronunciationCheck.accuracy} out of 100` : "Not assessed"}
                      </span>
                      <span className="block font-bold underline">Review saved assessment</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      {student && selected && (
        <AdminStudentAssessmentModal
          key={selected.id}
          studentName={student.name}
          summary={selected}
          readingNumber={numbers.get(selected.id)}
          onClose={() => setSelectedId(null)}
        />
      )}
    </section>
  );
}
