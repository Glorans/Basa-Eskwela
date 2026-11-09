import { formatScore, formatAnswerCounts } from "./services/scoreDisplay";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CalendarDays,
  Download,
  FileText,
  History,
  RefreshCw,
} from "lucide-react";
import { jsPDF } from "jspdf";

import { supabase } from "../../lib/supabaseClient";
import { getApiUrl } from "../../lib/apiUrl";

import type {
  WeeklyReport,
} from "./services/weeklyReportService";

interface SavedReportHistoryItem {
  id: string;
  periodStart: string;
  periodEnd: string;
  createdAt: string;
}

interface SavedWeeklyReport {
  id: string;
  periodStart: string;
  periodEnd: string;
  createdAt: string;
  report: WeeklyReport;
}

interface WeeklyReportApiResponse {
  success: boolean;
  report?: SavedWeeklyReport;
  reports?: SavedReportHistoryItem[];
  nextCursor?: string | null;
  message?: string;
}

type ReportScope = "teacher" | "admin";
// Teacher reports cover the Teacher's classrooms; Admin reports are school-wide (Admin-only routes).
const reportApiUrl = (scope: ReportScope) =>
  `${getApiUrl().replace(/\/+$/, "")}${scope === "admin" ? "/api/admin/weekly-reports" : "/api/weekly-reports"}`;
const RISK_NOTE = "Status when this report was generated, from each student's full quiz history, using Basa Eskwela's intervention guide (75% benchmark). Not limited to the reporting period.";
const COMPETENCY_LABELS: Record<string, string> = { literal: "Literal", inferential: "Inferential", critical: "Critical" };
const competencyText = (result: { total: number; correct: number | null; score: number | null }) =>
  result.total === 0 ? "No questions" : result.correct === null || result.score === null
    ? "Evaluation unavailable" : `${result.correct}/${result.total} (${formatScore(result.score)})`;

function formatPercentage(value: number | null): string {
  return value === null ? "N/A" : formatScore(value, 2);
}

function formatNumber(value: number | null): string {
  return value === null ? "N/A" : value.toFixed(2);
}

function formatTimestamp(value: string): string {
  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return "Date unavailable";
  }

  return parsed.toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function getCurrentPhilippineWeek(): {
  startDate: string;
  endDate: string;
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const year = Number(
    parts.find((part) => part.type === "year")?.value
  );

  const month = Number(
    parts.find((part) => part.type === "month")?.value
  );

  const day = Number(
    parts.find((part) => part.type === "day")?.value
  );

  const currentDate = new Date(
    Date.UTC(year, month - 1, day)
  );

  const mondayOffset =
    (currentDate.getUTCDay() + 6) % 7;

  const monday = new Date(currentDate);
  monday.setUTCDate(
    currentDate.getUTCDate() - mondayOffset
  );

  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);

  return {
    startDate: monday.toISOString().slice(0, 10),
    endDate: sunday.toISOString().slice(0, 10),
  };
}

async function requestWeeklyReports(
  path = "",
  options: RequestInit = {},
  scope: ReportScope = "teacher"
): Promise<WeeklyReportApiResponse> {
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();

  if (sessionError || !session?.access_token) {
    throw new Error(
      "Your session has expired. Please sign in again."
    );
  }

  const response = await fetch(`${reportApiUrl(scope)}${path}`, {
    ...options,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${session.access_token}`,
    },
  });

  const result: WeeklyReportApiResponse =
    await response.json();

  if (!response.ok || !result.success) {
    throw new Error(
      result.message || "Unable to process weekly reports."
    );
  }

  return result;
}

// ---------------------------------------------------------------------------
// Weekly Performance Report PDF (A4 portrait, table layout). Layout only: every
// value is printed from the saved report snapshot with the existing formatters.
// ---------------------------------------------------------------------------
function downloadWeeklyReportPdf(
  savedReport: SavedWeeklyReport
): void {
  const report = savedReport.report;
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  pdf.setProperties({ title: `${PDF_BRAND} ${PDF_TITLE}`, subject: `${report.period.startDate} to ${report.period.endDate} (PHT)`, creator: PDF_BRAND });
  pdf.setLineHeightFactor(1.3);

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const left = 15;
  const width = pageWidth - 30;
  const contentTop = 19; // below the running header on continuation pages
  const bottom = pageHeight - 18; // above the footer
  const periodText = `${report.period.startDate} to ${report.period.endDate} (PHT)`;
  let y = 14;

  const mm = (points: number) => points * 0.3528;
  const lineHeight = (points: number) => mm(points) * 1.3;
  const style = (points: number, weight: "normal" | "bold" = "normal", color: PdfColor = PDF_TEXT) => {
    pdf.setFont("helvetica", weight);
    pdf.setFontSize(points);
    pdf.setTextColor(...color);
  };
  const wrap = (value: string, available: number) => pdf.splitTextToSize(value, available) as string[];
  const newPage = () => { pdf.addPage(); y = contentTop; };

  const HEADING = 11;
  const NOTE = 8;
  const CELL = 8.5;
  const HEAD = 7.8;
  const PAD_X = 2;
  const PAD_Y = 1.15;
  const SECTION_GAP = 5;
  const headingHeight = lineHeight(HEADING) + 3;

  function noteHeight(value: string | undefined, available = width) {
    if (!value) return 0;
    style(NOTE);
    return wrap(value, available).length * lineHeight(NOTE) + 2;
  }

  function note(value: string | undefined, x = left, available = width, color: PdfColor = PDF_MUTED) {
    if (!value) return;
    style(NOTE, "normal", color);
    const lines = wrap(value, available);
    pdf.text(lines, x, y, { baseline: "top" });
    y += lines.length * lineHeight(NOTE) + 2;
  }

  function heading(title: string, x = left, available = width) {
    style(HEADING, "bold", PDF_GREEN);
    pdf.text(title, x, y, { baseline: "top" });
    y += lineHeight(HEADING) + 1;
    pdf.setDrawColor(...PDF_GREEN);
    pdf.setLineWidth(0.35);
    pdf.line(x, y, x + available, y);
    y += 2;
  }

  // Measures every cell once so rows can be kept whole and headers repeated.
  function measure(table: PdfTable, available: number) {
    const widths = table.columns.map((column) => column.share * available);
    const cells = (values: string[], points: number, weight: "normal" | "bold") => {
      style(points, weight);
      const lines = values.map((value, index) => wrap(value, widths[index] - PAD_X * 2));
      return { lines, height: Math.max(...lines.map((cell) => cell.length)) * lineHeight(points) + PAD_Y * 2 };
    };
    return {
      widths,
      header: cells(table.columns.map((column) => column.header), HEAD, "bold"),
      rows: [
        ...table.rows.map((row) => ({ ...cells(row, CELL, "normal"), total: false })),
        ...(table.totalRow ? [{ ...cells(table.totalRow, CELL, "bold"), total: true }] : []),
      ],
    };
  }
  type Measured = ReturnType<typeof measure>;

  function drawCells(table: PdfTable, measured: Measured, lines: string[][], height: number, x: number, points: number, weight: "normal" | "bold", color: PdfColor) {
    style(points, weight, color);
    let cellX = x;
    lines.forEach((cell, index) => {
      const right = table.columns[index].align === "right";
      pdf.text(cell, right ? cellX + measured.widths[index] - PAD_X : cellX + PAD_X, y + PAD_Y, { baseline: "top", align: right ? "right" : "left" });
      cellX += measured.widths[index];
    });
    y += height;
  }

  function drawHeader(table: PdfTable, measured: Measured, x: number, available: number) {
    pdf.setFillColor(...PDF_HEADER_FILL);
    pdf.rect(x, y, available, measured.header.height, "F");
    drawCells(table, measured, measured.header.lines, measured.header.height, x, HEAD, "bold", PDF_GREEN);
  }

  /** Rows are never split; headers repeat on each page; the last row never sits alone. */
  function drawTable(table: PdfTable, measured: Measured, continuation: string, x = left, available = width) {
    drawHeader(table, measured, x, available);
    let rowsOnPage = 0;
    measured.rows.forEach((row, index) => {
      const next = measured.rows[index + 1];
      const lastPairSplits = index === measured.rows.length - 2 && rowsOnPage > 0 && next && y + row.height + next.height > bottom;
      if (y + row.height > bottom || lastPairSplits) {
        newPage();
        style(NOTE, "bold", PDF_MUTED);
        pdf.text(`${continuation} (continued)`, x, y, { baseline: "top" });
        y += lineHeight(NOTE) + 1.5;
        drawHeader(table, measured, x, available);
        rowsOnPage = 0;
      }
      if (row.total) {
        pdf.setFillColor(...PDF_TOTAL_FILL);
        pdf.rect(x, y, available, row.height, "F");
      }
      drawCells(table, measured, row.lines, row.height, x, CELL, row.total ? "bold" : "normal", PDF_TEXT);
      pdf.setDrawColor(...PDF_RULE);
      pdf.setLineWidth(0.2);
      pdf.line(x, y, x + available, y);
      rowsOnPage += 1;
    });
  }

  // Height needed to keep a block's start together: header plus up to two rows.
  const leadHeight = (measured: Measured) =>
    measured.header.height + measured.rows.slice(0, 2).reduce((sum, row) => sum + row.height, 0);

  /** A titled section: heading, optional note and tables, or an empty message. Headings never sit alone. */
  function section(title: string, tables: PdfTable[], options: { note?: string; empty?: string } = {}) {
    const blocks = tables.filter((table) => table.rows.length || table.totalRow).map((table) => ({ table, measured: measure(table, width) }));
    const empty = blocks.length === 0 ? options.empty ?? "No records." : undefined;
    const lead = headingHeight + noteHeight(options.note) + (blocks[0] ? leadHeight(blocks[0].measured) : noteHeight(empty));
    if (y + lead > bottom) newPage();
    heading(title);
    note(options.note);
    if (empty) note(empty, left, width, PDF_TEXT);
    blocks.forEach(({ table, measured }, index) => {
      if (index > 0) {
        y += 3;
        if (y + leadHeight(measured) > bottom) newPage();
      }
      drawTable(table, measured, title);
    });
    y += SECTION_GAP;
  }

  /** Two small Metric | Result tables side by side. */
  function metricPair(sections: { title: string; table: PdfTable }[]) {
    const gutter = 8;
    const half = (width - gutter) / 2;
    const measured = sections.map(({ table }) => measure(table, half));
    const tallest = Math.max(...measured.map((item) => item.header.height + item.rows.reduce((sum, row) => sum + row.height, 0)));
    if (y + headingHeight + tallest > bottom) newPage();
    const start = y;
    let end = y;
    sections.forEach(({ title, table }, index) => {
      const x = left + index * (half + gutter);
      y = start;
      heading(title, x, half);
      drawTable(table, measured[index], title, x, half);
      end = Math.max(end, y);
    });
    y = end + SECTION_GAP;
  }

  const metricColumns: PdfColumn[] = [{ header: "Metric", share: 0.62 }, { header: "Result", share: 0.38, align: "right" }];
  const wpm = (value: number | null) => value === null ? "N/A" : formatNumber(value);

  // Page 1 header: brand, title and the saved report's metadata.
  const center = left + width / 2;
  style(18, "bold", PDF_GREEN);
  pdf.text(PDF_BRAND, center, y, { baseline: "top", align: "center" });
  y += lineHeight(18);
  style(12, "normal", PDF_TEXT);
  pdf.text(PDF_TITLE, center, y, { baseline: "top", align: "center" });
  y += lineHeight(12) + 3;
  const meta: [string, string, number][] = [
    ["Reporting Period", periodText, 0.33],
    ["Generated", `${formatTimestamp(report.generatedAt)} (PHT)`, 0.3],
    ["Report ID", savedReport.id, 0.37],
  ];
  const metaLines = meta.map(([, value, share]) => { style(8.5, "bold"); return wrap(value, share * width - 6); });
  const metaHeight = 4 + lineHeight(7) + Math.max(...metaLines.map((lines) => lines.length)) * lineHeight(8.5) + 3;
  pdf.setFillColor(...PDF_TOTAL_FILL);
  pdf.setDrawColor(...PDF_RULE);
  pdf.setLineWidth(0.2);
  pdf.roundedRect(left, y, width, metaHeight, 1.5, 1.5, "FD");
  let metaX = left + 3;
  meta.forEach(([label, , share], index) => {
    style(7, "bold", PDF_MUTED);
    pdf.text(label.toUpperCase(), metaX, y + 3, { baseline: "top" });
    style(8.5, "bold", PDF_TEXT);
    pdf.text(metaLines[index], metaX, y + 3 + lineHeight(7) + 0.8, { baseline: "top" });
    metaX += share * width;
  });
  y += metaHeight + 7;

  metricPair([
    { title: "Reading Performance", table: { columns: metricColumns, rows: [
      ["Reading Attempts", String(report.reading.totalAttempts)],
      ["Students With Attempts", String(report.reading.studentsWithAttempts)],
      ["Average Reading Accuracy", formatPercentage(report.reading.averagePronunciationAccuracy)],
      ["Average Reading Speed (WPM)", wpm(report.reading.averageReadingSpeedWpm)],
    ] } },
    { title: "Comprehension Performance", table: { columns: metricColumns, rows: [
      ["Completed Assessments", String(report.comprehension.completedAssessments)],
      ["Students With Assessments", String(report.comprehension.studentsWithAssessments)],
      ["Average Comprehension Score", formatPercentage(report.comprehension.averageScore)],
    ] } },
  ]);

  if (report.scope === "admin") {
    section("Classroom Comparisons", [{
      columns: [
        { header: "Classroom", share: 0.21 }, { header: "Teacher", share: 0.17 },
        { header: "Participating / Enrolled", share: 0.13, align: "right" }, { header: "Readings", share: 0.1, align: "right" },
        { header: "Avg. Reading Accuracy", share: 0.13, align: "right" }, { header: "Assessments", share: 0.14, align: "right" },
        { header: "Avg. Score", share: 0.12, align: "right" },
      ],
      rows: (report.classroomComparisons ?? []).map((room) => [
        room.roomName, room.teacherName, `${room.participatingStudents} / ${room.enrolledStudents}`, String(room.readingAttempts),
        formatPercentage(room.averageReadingAccuracy), String(room.completedAssessments), formatPercentage(room.averageScore),
      ]),
    }], { note: report.learnerScope, empty: "No classrooms." });

    section("Student Performance Summaries", [{
      columns: [
        { header: "Student", share: 0.28 }, { header: "Readings", share: 0.11, align: "right" },
        { header: "Avg. Reading Accuracy", share: 0.15, align: "right" }, { header: "Avg. Reading Speed (WPM)", share: 0.16, align: "right" },
        { header: "Assessments", share: 0.14, align: "right" }, { header: "Avg. Score", share: 0.16, align: "right" },
      ],
      rows: (report.studentSummaries ?? []).map((student) => [
        student.studentName, String(student.readingAttempts), formatPercentage(student.averageReadingAccuracy),
        student.averageReadingSpeedWpm === null ? "N/A" : String(Math.round(student.averageReadingSpeedWpm)),
        String(student.completedAssessments), formatPercentage(student.averageScore),
      ]),
    }], { empty: "No student results during the selected period." });

    section("Competency Results", [{
      columns: [{ header: "Competency", share: 0.5 }, { header: "Result", share: 0.5, align: "right" }],
      rows: Object.entries(report.competency ?? {}).map(([type, result]) => [COMPETENCY_LABELS[type] ?? type, competencyText(result)]),
    }], { empty: "No competency results." });
  }

  if (report.riskClassifications) {
    section("Student Support / Risk Classification", [
      // Category totals on one row: one column per existing classification.
      { columns: Object.keys(report.riskClassifications.counts).map((label, _, labels) => ({ header: label, share: 1 / labels.length, align: "right" as const })),
        rows: Object.keys(report.riskClassifications.counts).length ? [Object.values(report.riskClassifications.counts).map(String)] : [] },
      { columns: [{ header: "Student", share: 0.6 }, { header: "Classification", share: 0.4 }],
        rows: report.riskClassifications.students.map((student) => [student.studentName, student.classification]) },
    ], { note: RISK_NOTE, empty: "No students to classify." });
  }

  const completion = report.currentCompletionSnapshot;
  section("Classroom Completion", [{
    columns: [
      { header: "Classroom", share: 0.46 }, { header: "Total Assignments", share: 0.18, align: "right" },
      { header: "Completed", share: 0.16, align: "right" }, { header: "Completion Rate", share: 0.2, align: "right" },
    ],
    rows: completion.classrooms.map((room) => [room.roomName, String(room.totalAssignments), String(room.completedAssignments), formatPercentage(room.completionRate)]),
    totalRow: completion.classrooms.length
      ? [`All classrooms (${completion.totalClassrooms})`, String(completion.totalAssignments), String(completion.completedAssignments), formatPercentage(completion.completionRate)]
      : undefined,
  }], { empty: "No classroom records available." });

  const recordColumns = (fourth: string, fifth: string): PdfColumn[] => [
    { header: "Student", share: 0.23 }, { header: "Reading Material", share: 0.33 }, { header: "Date Completed (PHT)", share: 0.2 },
    { header: fourth, share: 0.11, align: "right" }, { header: fifth, share: 0.13, align: "right" },
  ];

  section("Weekly Reading Activity Records", [{
    columns: recordColumns("Accuracy", "Speed (WPM)"),
    rows: report.reading.attempts.map((attempt) => [
      attempt.studentName, attempt.moduleTitle, formatTimestamp(attempt.completedAt),
      formatPercentage(attempt.pronunciationAccuracy), wpm(attempt.readingSpeedWpm),
    ]),
  }], { empty: "No recorded reading attempts during the selected period." });

  section("Weekly Comprehension Results", [{
    columns: recordColumns("Correct Answers", "Score"),
    rows: report.comprehension.assessments.map((assessment) => [
      assessment.studentName, assessment.moduleTitle, formatTimestamp(assessment.completedAt),
      formatAnswerCounts(assessment.correctAnswers, assessment.totalQuestions), formatScore(assessment.scorePercentage, 2),
    ]),
  }], { empty: "No completed comprehension assessments during the selected period." });

  // Running header (continuation pages) and footer with page numbers on every page.
  const pages = pdf.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    pdf.setPage(page);
    pdf.setDrawColor(...PDF_RULE);
    pdf.setLineWidth(0.2);
    if (page > 1) {
      // Centered as one line: bold brand, then the title and period in the muted style.
      const running = `  |  ${PDF_TITLE} - ${periodText}`;
      style(8.5, "bold", PDF_GREEN);
      const brandWidth = pdf.getTextWidth(PDF_BRAND);
      style(7.5, "normal", PDF_MUTED);
      const start = left + (width - brandWidth - pdf.getTextWidth(running)) / 2;
      pdf.text(running, start + brandWidth, 9.4, { baseline: "top" });
      style(8.5, "bold", PDF_GREEN);
      pdf.text(PDF_BRAND, start, 9, { baseline: "top" });
      pdf.line(left, 14, left + width, 14);
    }
    pdf.line(left, pageHeight - 13, left + width, pageHeight - 13);
    style(7.5, "normal", PDF_MUTED);
    pdf.text(`${PDF_BRAND} | ${PDF_TITLE} | ${periodText}`, left, pageHeight - 11, { baseline: "top" });
    pdf.text(`Page ${page} of ${pages}`, left + width, pageHeight - 11, { baseline: "top", align: "right" });
  }

  pdf.save(weeklyReportPdfFilename(savedReport));
}

// Layout constants for downloadWeeklyReportPdf (read only when a PDF is generated).
type PdfColor = [number, number, number];
interface PdfColumn { header: string; share: number; align?: "left" | "right" }
interface PdfTable { columns: PdfColumn[]; rows: string[][]; totalRow?: string[] }

const PDF_GREEN: PdfColor = [22, 78, 58];
const PDF_TEXT: PdfColor = [33, 47, 43];
const PDF_MUTED: PdfColor = [92, 108, 102];
const PDF_HEADER_FILL: PdfColor = [226, 239, 230];
const PDF_TOTAL_FILL: PdfColor = [244, 248, 245];
const PDF_RULE: PdfColor = [214, 226, 219];
const PDF_BRAND = "Basa Eskwela";
const PDF_TITLE = "Weekly Performance Report";

function weeklyReportPdfFilename(savedReport: SavedWeeklyReport): string {
  const { period } = savedReport.report;
  return `Basa_Eskwela_Weekly_Report_${period.startDate}_to_${period.endDate}_${savedReport.id.slice(0, 8)}.pdf`;
}

const panelStyle = {
  backgroundColor: "#dce8e7",
  borderRadius: "16px",
  padding: "24px",
  boxShadow: "0 3px 12px rgba(0, 0, 0, 0.06)",
} as const;

const metricsStyle = {
  display: "grid",
  gridTemplateColumns:
    "repeat(auto-fit, minmax(min(100%, 180px), 1fr))",
  gap: "14px",
} as const;

const tableCellStyle = {
  padding: "12px",
  textAlign: "left",
  borderBottom: "1px solid #e2e8f0",
} as const;

function ReportMetric({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div
      style={{
        backgroundColor: "#dce8e7",
        borderRadius: "12px",
        padding: "16px",
      }}
    >
      <p
        style={{
          color: "#64748b",
          fontSize: "13px",
          margin: "0 0 8px",
        }}
      >
        {label}
      </p>

      <strong
        style={{
          color: "#173d35",
          fontSize: "24px",
        }}
      >
        {value}
      </strong>
    </div>
  );
}

/** Teacher reports by default; scope "admin" uses the Admin-only routes and adds school-wide sections. */
export default function WeeklyReportSection({ scope = "teacher", compact = false }: { scope?: ReportScope; compact?: boolean } = {}) {
  const [initialPeriod] = useState(
    getCurrentPhilippineWeek
  );

  const [startDate, setStartDate] = useState(
    initialPeriod.startDate
  );

  const [endDate, setEndDate] = useState(
    initialPeriod.endDate
  );

  const [savedReport, setSavedReport] =
    useState<SavedWeeklyReport | null>(null);

  const [history, setHistory] =
    useState<SavedReportHistoryItem[]>([]);

  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const historyRequest = useRef(0);
  const reportRequest = useRef(0);

  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] =
    useState(false);

  const [openingReportId, setOpeningReportId] =
    useState<string | null>(null);

  const [error, setError] = useState("");
  const [historyError, setHistoryError] = useState("");
  const [successMessage, setSuccessMessage] =
    useState("");

  const report = savedReport?.report ?? null;

  const loadReportHistory = useCallback(async (cursor: string | null = null) => {
    const request = ++historyRequest.current;
    setHistoryLoading(true);
    setHistoryError("");

    try {
      const result = await requestWeeklyReports(cursor ? `?cursor=${encodeURIComponent(cursor)}` : "", {}, scope);
      if (request !== historyRequest.current) return;

      if (!Array.isArray(result.reports) || (result.nextCursor !== null && typeof result.nextCursor !== "string")) {
        throw new Error(
          "The saved report history response is invalid."
        );
      }

      const reports = result.reports;
      setHistory(previous => [...new Map([...(cursor ? previous : []), ...reports].map(item => [item.id, item])).values()]);
      setNextCursor(result.nextCursor ?? null);
    } catch (cause) {
      if (request !== historyRequest.current) return;
      setHistoryError(
        cause instanceof Error
          ? cause.message
          : "Unable to load saved reports."
      );
    } finally {
      if (request === historyRequest.current) setHistoryLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    void loadReportHistory();
    return () => { historyRequest.current++; reportRequest.current++; };
  }, [loadReportHistory]);

  async function handleGenerateReport() {
    const request = ++reportRequest.current;
    setError("");
    setSuccessMessage("");

    if (!startDate || !endDate) {
      setError("Please select both report dates.");
      return;
    }

    if (endDate < startDate) {
      setError(
        "The end date cannot be before the start date."
      );
      return;
    }

    setLoading(true);

    try {
      const result = await requestWeeklyReports("", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          period: {
            startDate,
            endDate,
          },
        }),
      }, scope);

      if (request !== reportRequest.current) return;
      if (!result.report) {
        throw new Error(
          "The generated report was not returned by the server."
        );
      }

      setSavedReport(result.report);

      setSuccessMessage(
        "Weekly report generated and saved successfully."
      );

      await loadReportHistory();
    } catch (cause) {
      if (request !== reportRequest.current) return;
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to generate and save the weekly report."
      );
    } finally {
      if (request === reportRequest.current) setLoading(false);
    }
  }

  async function handleOpenSavedReport(reportId: string) {
    const request = ++reportRequest.current;
    setError("");
    setSuccessMessage("");
    setOpeningReportId(reportId);

    try {
      const result = await requestWeeklyReports(
        `/${encodeURIComponent(reportId)}`,
        {},
        scope
      );

      if (request !== reportRequest.current) return;
      if (!result.report) {
        throw new Error(
          "The saved report was not returned by the server."
        );
      }

      setSavedReport(result.report);

      setSuccessMessage(
        "Previously saved report opened successfully."
      );
    } catch (cause) {
      if (request !== reportRequest.current) return;
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to open the saved report."
      );
    } finally {
      if (request === reportRequest.current) setOpeningReportId(null);
    }
  }

  function handleDownloadPdf() {
    if (!savedReport) {
      return;
    }

    setError("");

    try {
      downloadWeeklyReportPdf(savedReport);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to download the PDF report."
      );
    }
  }

  return (
    <section
      className={compact ? "m7-weekly-compact" : undefined}
      aria-labelledby="weekly-report-heading"
      style={{ marginTop: scope === "teacher" ? 0 : "28px" }}
    >
      <div style={{ marginBottom: "20px" }}>
        <h2 id="weekly-report-heading">
          <FileText
            size={24}
            style={{
              display: "inline-block",
              verticalAlign: "middle",
              marginRight: "10px",
            }}
          />
          Weekly Performance Report
        </h2>

        {scope === "admin" && <p>
          Generate a school-wide report for all Student accounts using recorded reading attempts, completed comprehension assessments, classroom comparisons, competency results and current assignment completion data. Independent Learner practice is not included.
        </p>}
      </div>

      <div className="m7-report-controls" style={panelStyle}>
        <div
          className="m7-report-dates"
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "flex-end",
            gap: "16px",
          }}
        >
          <label
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "8px",
            }}
          >
            <span>Start Date</span>

            <input
              type="date"
              value={startDate}
              disabled={loading || openingReportId !== null}
              onChange={(event) =>
                setStartDate(event.target.value)
              }
              style={{
                padding: "10px",
                border: "1px solid #cbd5e1",
                borderRadius: "8px",
              }}
            />
          </label>

          <label
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "8px",
            }}
          >
            <span>End Date</span>

            <input
              type="date"
              value={endDate}
              disabled={loading || openingReportId !== null}
              onChange={(event) =>
                setEndDate(event.target.value)
              }
              style={{
                padding: "10px",
                border: "1px solid #cbd5e1",
                borderRadius: "8px",
              }}
            />
          </label>

          <button
            type="button"
            className="m3-button m3-button--secondary"
            disabled={loading || openingReportId !== null}
            onClick={() => void handleGenerateReport()}
          >
            {loading ? (
              <RefreshCw
                size={16}
                className="m3-spinner"
              />
            ) : (
              <CalendarDays size={16} />
            )}

            {loading
              ? "Generating..."
              : "Generate Weekly Report"}
          </button>
        </div>

        {scope === "admin" && !compact && (<p
          style={{
            fontSize: "12px",
            color: "#64748b",
            marginTop: "14px",
          }}
        >
          Reporting periods follow Philippine Standard Time
          (PHT, UTC+8), from 12:00 AM on the start date
          through the end of the selected end date.
        </p>)}

        {error && (
          <p
            role="alert"
            className="m3-error-message"
            style={{ marginTop: "16px" }}
          >
            {error}
          </p>
        )}

        {successMessage && (
          <p
            role="status"
            style={{
              marginTop: "16px",
              color: "#166534",
              fontWeight: 600,
            }}
          >
            {successMessage}
          </p>
        )}
      </div>

      <div className="m7-saved-reports" style={{ ...panelStyle, marginTop: "24px" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "12px",
            marginBottom: "16px",
          }}
        >
          <h3 style={{ margin: 0 }}>
            <History
              size={19}
              style={{
                display: "inline-block",
                verticalAlign: "middle",
                marginRight: "8px",
              }}
            />
            Saved Weekly Reports
          </h3>

          <button
            type="button"
            className="m3-button m3-button--secondary"
            aria-label={compact ? "Refresh saved reports" : undefined}
            title={compact ? "Refresh saved reports" : undefined}
            disabled={historyLoading}
            onClick={() => void loadReportHistory()}
          >
            <RefreshCw size={16} aria-hidden="true" className={historyLoading ? "m3-spinner" : ""} />
            {!compact && (historyLoading ? "Loading..." : "Refresh")}
          </button>
        </div>

        {!compact && (<p
          style={{
            color: "#64748b",
            fontSize: "13px",
          }}
        >
          Reopen previously generated reports without
          recalculating their saved statistics. Load more to view older reports.
        </p>)}

        {historyError && (
          <p
            role="alert"
            className="m3-error-message"
          >
            {historyError}
          </p>
        )}

        {historyLoading && history.length === 0 ? (
          <p>Loading saved reports...</p>
        ) : history.length === 0 && !historyError ? (
          <p>No saved weekly reports found.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
              }}
            >
              <thead>
                <tr>
                  <th style={tableCellStyle}>
                    Reporting Period
                  </th>
                  <th style={tableCellStyle}>
                    Date Saved
                  </th>
                  <th style={tableCellStyle}>
                    Action
                  </th>
                </tr>
              </thead>

              <tbody>
                {history.map((item) => (
                  <tr key={item.id}>
                    <td style={tableCellStyle}>
                      {item.periodStart} to{" "}
                      {item.periodEnd}
                    </td>

                    <td style={tableCellStyle}>
                      {formatTimestamp(item.createdAt)}
                    </td>

                    <td style={tableCellStyle}>
                      <button
                        type="button"
                        className="m3-button m3-button--secondary"
                        disabled={
                          openingReportId !== null ||
                          loading
                        }
                        onClick={() =>
                          void handleOpenSavedReport(item.id)
                        }
                      >
                        {openingReportId === item.id
                          ? "Opening..."
                          : "View Report"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {nextCursor && (
          <button
            type="button"
            className="m3-button m3-button--secondary"
            disabled={historyLoading || loading}
            onClick={() => void loadReportHistory(nextCursor)}
          >
            {historyLoading ? "Loading..." : "Load More"}
          </button>
        )}
      </div>

      {report && savedReport && (
        <div
          style={{
            display: "grid",
            gap: "24px",
            marginTop: "24px",
          }}
        >
          <div style={panelStyle}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                flexWrap: "wrap",
                gap: "16px",
              }}
            >
              <div>
                <h3>Generated Report</h3>

                <p>
                  <strong>Reporting Period:</strong>{" "}
                  {report.period.startDate} to{" "}
                  {report.period.endDate} (PHT)
                </p>

                <p>
                  <strong>Generated:</strong>{" "}
                  {formatTimestamp(report.generatedAt)}
                  {" "} (Philippine time)
                </p>
              </div>

              <button
                type="button"
                className="m3-button m3-button--secondary"
                onClick={handleDownloadPdf}
              >
                <Download size={16} />
                Download PDF
              </button>
            </div>
          </div>

          <div style={panelStyle}>
            <h3>Reading Performance</h3>

            <div style={metricsStyle}>
              <ReportMetric
                label="Reading Attempts"
                value={report.reading.totalAttempts}
              />

              <ReportMetric
                label="Students With Attempts"
                value={report.reading.studentsWithAttempts}
              />

              <ReportMetric
                label="Average Reading Accuracy"
                value={formatPercentage(
                  report.reading.averagePronunciationAccuracy
                )}
              />

              <ReportMetric
                label="Average Reading Speed"
                value={
                  report.reading.averageReadingSpeedWpm === null
                    ? "N/A"
                    : `${formatNumber(
                        report.reading.averageReadingSpeedWpm
                      )} WPM`
                }
              />
            </div>
          </div>

          <div style={panelStyle}>
            <h3>Comprehension Performance</h3>

            <div style={metricsStyle}>
              <ReportMetric
                label="Completed Assessments"
                value={
                  report.comprehension.completedAssessments
                }
              />

              <ReportMetric
                label="Students With Assessments"
                value={
                  report.comprehension.studentsWithAssessments
                }
              />

              <ReportMetric
                label="Average Comprehension Score"
                value={formatPercentage(
                  report.comprehension.averageScore
                )}
              />
            </div>
          </div>

          {report.scope === "admin" && (
            <>
              <div style={panelStyle}>
                <h3>Classroom Comparisons</h3>
                {report.learnerScope && <p>{report.learnerScope}</p>}
                {!report.classroomComparisons?.length ? <p>No classrooms.</p> : (
                  <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead><tr>{["Classroom", "Teacher", "Participating / Enrolled", "Readings", "Reading Accuracy", "Assessments", "Average Score"].map((h) => <th key={h} style={tableCellStyle}>{h}</th>)}</tr></thead>
                    <tbody>{report.classroomComparisons.map((room) => <tr key={room.roomId}>
                      <td style={tableCellStyle}>{room.roomName}</td><td style={tableCellStyle}>{room.teacherName}</td>
                      <td style={tableCellStyle}>{room.participatingStudents} / {room.enrolledStudents}</td><td style={tableCellStyle}>{room.readingAttempts}</td>
                      <td style={tableCellStyle}>{formatPercentage(room.averageReadingAccuracy)}</td><td style={tableCellStyle}>{room.completedAssessments}</td>
                      <td style={tableCellStyle}>{formatPercentage(room.averageScore)}</td></tr>)}</tbody>
                  </table></div>
                )}
              </div>
              <div style={panelStyle}>
                <h3>Student Performance Summaries</h3>
                {!report.studentSummaries?.length ? <p>No student results during the selected period.</p> : (
                  <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead><tr>{["Student", "Readings", "Reading Accuracy", "Reading Speed", "Assessments", "Average Score"].map((h) => <th key={h} style={tableCellStyle}>{h}</th>)}</tr></thead>
                    <tbody>{report.studentSummaries.map((student) => <tr key={student.studentId}>
                      <td style={tableCellStyle}>{student.studentName}</td><td style={tableCellStyle}>{student.readingAttempts}</td>
                      <td style={tableCellStyle}>{formatPercentage(student.averageReadingAccuracy)}</td>
                      <td style={tableCellStyle}>{student.averageReadingSpeedWpm === null ? "N/A" : `${Math.round(student.averageReadingSpeedWpm)} WPM`}</td>
                      <td style={tableCellStyle}>{student.completedAssessments}</td><td style={tableCellStyle}>{formatPercentage(student.averageScore)}</td></tr>)}</tbody>
                  </table></div>
                )}
              </div>
              <div style={panelStyle}>
                <h3>Competency Results</h3>
                <p>First answers from completed comprehension assessments in the period, by question type.</p>
                <div style={metricsStyle}>{Object.entries(report.competency ?? {}).map(([type, result]) =>
                  <ReportMetric key={type} label={COMPETENCY_LABELS[type] ?? type} value={competencyText(result)} />)}</div>
              </div>
            </>
          )}

          {report.riskClassifications && (
            <div style={panelStyle}>
              <h3>Current Risk Classifications</h3>
              <p>{RISK_NOTE}</p>
              <div style={metricsStyle}>{Object.entries(report.riskClassifications.counts).map(([label, count]) =>
                <ReportMetric key={label} label={label} value={count} />)}</div>
              {report.riskClassifications.students.length > 0 && <div className="m7-scroll"><table><thead><tr><th>Student</th><th>Classification</th></tr></thead>
                <tbody>{report.riskClassifications.students.map((student) => <tr key={student.studentId}><td>{student.studentName}</td><td>{student.classification}</td></tr>)}</tbody></table></div>}
            </div>
          )}

          <div style={panelStyle}>
            <h3>Current Assignment Completion Snapshot</h3>

            <p
              style={{
                color: "#64748b",
                fontSize: "13px",
              }}
            >
              These figures reflect assignment status when
              the report was generated. They are not
              historical completion rates for the selected
              week.
            </p>

            <div style={metricsStyle}>
              <ReportMetric
                label="Classrooms"
                value={
                  report.currentCompletionSnapshot.totalClassrooms
                }
              />

              <ReportMetric
                label="Total Assignments"
                value={
                  report.currentCompletionSnapshot.totalAssignments
                }
              />

              <ReportMetric
                label="Completed Assignments"
                value={
                  report.currentCompletionSnapshot.completedAssignments
                }
              />

              <ReportMetric
                label="Completion Rate"
                value={formatPercentage(
                  report.currentCompletionSnapshot.completionRate
                )}
              />
            </div>
          </div>

          <div style={panelStyle}>
            <h3>Classroom Completion Breakdown</h3>

            {report.currentCompletionSnapshot.classrooms
              .length === 0 ? (
              <p>No classroom records available.</p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                  }}
                >
                  <thead>
                    <tr>
                      <th style={tableCellStyle}>
                        Classroom
                      </th>
                      <th style={tableCellStyle}>
                        Assigned
                      </th>
                      <th style={tableCellStyle}>
                        Completed
                      </th>
                      <th style={tableCellStyle}>
                        Completion Rate
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {report.currentCompletionSnapshot.classrooms.map(
                      (room) => (
                        <tr key={room.roomId}>
                          <td style={tableCellStyle}>
                            {room.roomName}
                          </td>
                          <td style={tableCellStyle}>
                            {room.totalAssignments}
                          </td>
                          <td style={tableCellStyle}>
                            {room.completedAssignments}
                          </td>
                          <td style={tableCellStyle}>
                            {formatPercentage(
                              room.completionRate
                            )}
                          </td>
                        </tr>
                      )
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div style={panelStyle}>
            <h3>Weekly Reading Activity Records</h3>

            {report.reading.attempts.length === 0 ? (
              <p>
                No recorded reading attempts during the
                selected period.
              </p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                  }}
                >
                  <thead>
                    <tr>
                      <th style={tableCellStyle}>
                        Student
                      </th>
                      <th style={tableCellStyle}>
                        Module
                      </th>
                      <th style={tableCellStyle}>
                        Completed
                      </th>
                      <th style={tableCellStyle}>
                        Reading Accuracy
                      </th>
                      <th style={tableCellStyle}>
                        Reading Speed
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {report.reading.attempts.map(
                      (attempt) => (
                        <tr key={attempt.attemptId}>
                          <td style={tableCellStyle}>
                            {attempt.studentName}
                          </td>
                          <td style={tableCellStyle}>
                            {attempt.moduleTitle}
                          </td>
                          <td style={tableCellStyle}>
                            {formatTimestamp(
                              attempt.completedAt
                            )}
                          </td>
                          <td style={tableCellStyle}>
                            {formatPercentage(
                              attempt.pronunciationAccuracy
                            )}
                          </td>
                          <td style={tableCellStyle}>
                            {attempt.readingSpeedWpm === null
                              ? "N/A"
                              : `${formatNumber(
                                  attempt.readingSpeedWpm
                                )} WPM`}
                          </td>
                        </tr>
                      )
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div style={panelStyle}>
            <h3>Weekly Comprehension Results</h3>

            {report.comprehension.assessments.length ===
            0 ? (
              <p>
                No completed comprehension assessments
                during the selected period.
              </p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                  }}
                >
                  <thead>
                    <tr>
                      <th style={tableCellStyle}>
                        Student
                      </th>
                      <th style={tableCellStyle}>
                        Module
                      </th>
                      <th style={tableCellStyle}>
                        Completed
                      </th>
                      <th style={tableCellStyle}>
                        Correct Answers
                      </th>
                      <th style={tableCellStyle}>
                        Score
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {report.comprehension.assessments.map(
                      (assessment) => (
                        <tr key={assessment.attemptId}>
                          <td style={tableCellStyle}>
                            {assessment.studentName}
                          </td>
                          <td style={tableCellStyle}>
                            {assessment.moduleTitle}
                          </td>
                          <td style={tableCellStyle}>
                            {formatTimestamp(
                              assessment.completedAt
                            )}
                          </td>
                          <td style={tableCellStyle}>
                            {formatAnswerCounts(assessment.correctAnswers, assessment.totalQuestions)}
                          </td>
                          <td style={tableCellStyle}>
                            {formatScore(assessment.scorePercentage, 2)}
                          </td>
                        </tr>
                      )
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
