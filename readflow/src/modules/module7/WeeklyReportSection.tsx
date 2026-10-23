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

const API_URL = `${getApiUrl().replace(/\/+$/, "")}/api/weekly-reports`;

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
  options: RequestInit = {}
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

  const response = await fetch(`${API_URL}${path}`, {
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

function downloadWeeklyReportPdf(
  savedReport: SavedWeeklyReport
): void {
  const report = savedReport.report;
  const pdf = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();

  const left = 18;
  const right = pageWidth - 18;
  const contentWidth = right - left;
  const bottomLimit = pageHeight - 22;

  let y = 22;

  function ensureSpace(height: number) {
    if (y + height > bottomLimit) {
      pdf.addPage();
      y = 22;
    }
  }

  function addText(
    value: string,
    options: {
      size?: number;
      bold?: boolean;
      gap?: number;
    } = {}
  ) {
    const size = options.size ?? 10;
    const gap = options.gap ?? 5;

    pdf.setFont(
      "helvetica",
      options.bold ? "bold" : "normal"
    );
    pdf.setFontSize(size);
    pdf.setTextColor(35, 55, 50);

    const lines = pdf.splitTextToSize(
      value,
      contentWidth
    ) as string[];

    const lineHeight = size * 0.42 + 1;

    ensureSpace(lines.length * lineHeight + gap);

    pdf.text(lines, left, y);
    y += lines.length * lineHeight + gap;
  }

  function addSection(title: string) {
    ensureSpace(18);
    y += 5;

    pdf.setDrawColor(195, 210, 205);
    pdf.line(left, y, right, y);
    y += 8;

    addText(title, {
      size: 13,
      bold: true,
      gap: 5,
    });
  }

  function addField(label: string, value: string | number) {
    addText(`${label}: ${value}`, {
      size: 10,
      gap: 3,
    });
  }

  function addFooter() {
    const pages = pdf.getNumberOfPages();

    for (let page = 1; page <= pages; page += 1) {
      pdf.setPage(page);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(8);
      pdf.setTextColor(110, 120, 115);

      pdf.text(
        `ReadFlow | Page ${page} of ${pages}`,
        pageWidth / 2,
        pageHeight - 12,
        { align: "center" }
      );
    }
  }

  addText("ReadFlow", {
    size: 20,
    bold: true,
    gap: 6,
  });

  addText("Weekly Performance Report", {
    size: 16,
    bold: true,
    gap: 8,
  });

  addField(
    "Reporting Period",
    `${report.period.startDate} to ${report.period.endDate} (PHT)`
  );

  addField(
    "Generated",
    `${formatTimestamp(report.generatedAt)} (PHT)`
  );

  addField("Report ID", savedReport.id);

  addSection("Reading Performance");

  addField(
    "Reading Attempts",
    report.reading.totalAttempts
  );

  addField(
    "Students With Attempts",
    report.reading.studentsWithAttempts
  );

  addField(
    "Average Pronunciation Accuracy",
    formatPercentage(
      report.reading.averagePronunciationAccuracy
    )
  );

  addField(
    "Average Reading Speed",
    report.reading.averageReadingSpeedWpm === null
      ? "N/A"
      : `${formatNumber(
          report.reading.averageReadingSpeedWpm
        )} WPM`
  );

  addSection("Comprehension Performance");

  addField(
    "Completed Assessments",
    report.comprehension.completedAssessments
  );

  addField(
    "Students With Assessments",
    report.comprehension.studentsWithAssessments
  );

  addField(
    "Average Comprehension Score",
    formatPercentage(
      report.comprehension.averageScore
    )
  );

  addSection("Current Assignment Completion Snapshot");

  addText(
    "The following values reflect assignment status when " +
      "this report was generated. They are not historical " +
      "completion rates for the selected week.",
    { size: 9, gap: 6 }
  );

  addField(
    "Classrooms",
    report.currentCompletionSnapshot.totalClassrooms
  );

  addField(
    "Total Assignments",
    report.currentCompletionSnapshot.totalAssignments
  );

  addField(
    "Completed Assignments",
    report.currentCompletionSnapshot.completedAssignments
  );

  addField(
    "Completion Rate",
    formatPercentage(
      report.currentCompletionSnapshot.completionRate
    )
  );

  addSection("Classroom Completion Breakdown");

  if (
    report.currentCompletionSnapshot.classrooms.length === 0
  ) {
    addText("No classroom records available.");
  } else {
    report.currentCompletionSnapshot.classrooms.forEach(
      (room, index) => {
        ensureSpace(23);

        addText(`${index + 1}. ${room.roomName}`, {
          bold: true,
          gap: 3,
        });

        addField(
          "Assignments",
          room.totalAssignments
        );

        addField(
          "Completed",
          room.completedAssignments
        );

        addField(
          "Completion Rate",
          formatPercentage(room.completionRate)
        );

        y += 3;
      }
    );
  }

  addSection("Weekly Reading Activity Records");

  if (report.reading.attempts.length === 0) {
    addText(
      "No recorded reading attempts during the selected period."
    );
  } else {
    report.reading.attempts.forEach((attempt, index) => {
      ensureSpace(25);

      addText(
        `${index + 1}. ${attempt.studentName}`,
        { bold: true, gap: 3 }
      );

      addField("Module", attempt.moduleTitle);

      addField(
        "Completed",
        formatTimestamp(attempt.completedAt)
      );

      addField(
        "Pronunciation",
        formatPercentage(
          attempt.pronunciationAccuracy
        )
      );

      addField(
        "Reading Speed",
        attempt.readingSpeedWpm === null
          ? "N/A"
          : `${formatNumber(
              attempt.readingSpeedWpm
            )} WPM`
      );

      y += 3;
    });
  }

  addSection("Weekly Comprehension Results");

  if (report.comprehension.assessments.length === 0) {
    addText(
      "No completed comprehension assessments during the selected period."
    );
  } else {
    report.comprehension.assessments.forEach(
      (assessment, index) => {
        ensureSpace(25);

        addText(
          `${index + 1}. ${assessment.studentName}`,
          { bold: true, gap: 3 }
        );

        addField(
          "Module",
          assessment.moduleTitle
        );

        addField(
          "Completed",
          formatTimestamp(assessment.completedAt)
        );

        addField(
          "Correct Answers",
          formatAnswerCounts(assessment.correctAnswers, assessment.totalQuestions)
        );

        addField(
          "Score",
          formatScore(assessment.scorePercentage, 2)
        );

        y += 3;
      }
    );
  }

  addFooter();

  const filename =
    `ReadFlow_Weekly_Report_` +
    `${report.period.startDate}_to_` +
    `${report.period.endDate}_` +
    `${savedReport.id.slice(0, 8)}.pdf`;

  pdf.save(filename);
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

export default function WeeklyReportSection() {
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
      const result = await requestWeeklyReports(cursor ? `?cursor=${encodeURIComponent(cursor)}` : "");
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
  }, []);

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
      });

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
        `/${encodeURIComponent(reportId)}`
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
      aria-labelledby="weekly-report-heading"
      style={{ marginTop: "28px" }}
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

        <p>
          Generate a report using recorded reading attempts,
          completed comprehension assessments, and current
          assignment completion data.
        </p>
      </div>

      <div style={panelStyle}>
        <div
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

        <p
          style={{
            fontSize: "12px",
            color: "#64748b",
            marginTop: "14px",
          }}
        >
          Reporting periods follow Philippine Standard Time
          (PHT, UTC+8), from 12:00 AM on the start date
          through the end of the selected end date.
        </p>

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

      <div style={{ ...panelStyle, marginTop: "24px" }}>
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
            disabled={historyLoading}
            onClick={() => void loadReportHistory()}
          >
            <RefreshCw size={16} />
            {historyLoading ? "Loading..." : "Refresh"}
          </button>
        </div>

        <p
          style={{
            color: "#64748b",
            fontSize: "13px",
          }}
        >
          Reopen previously generated reports without
          recalculating their saved statistics. Load more to view older reports.
        </p>

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
                label="Average Pronunciation Accuracy"
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
                        Pronunciation
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
