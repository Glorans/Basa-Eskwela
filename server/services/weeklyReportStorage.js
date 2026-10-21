
const { getSupabaseAdmin } = require("./supabaseAdmin");

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class WeeklyReportStorageError extends Error {
  constructor(
    message,
    statusCode = 500,
    code = "WEEKLY_REPORT_STORAGE_FAILED"
  ) {
    super(message);
    this.name = "WeeklyReportStorageError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function validateReportDate(value, label) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    throw new WeeklyReportStorageError(
      `${label} must use YYYY-MM-DD format.`,
      400,
      "INVALID_REPORT_DATE"
    );
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);

  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new WeeklyReportStorageError(
      `${label} is invalid.`,
      400,
      "INVALID_REPORT_DATE"
    );
  }

  return value;
}

function validateReportSnapshot(report) {
  if (
    !report ||
    typeof report !== "object" ||
    Array.isArray(report)
  ) {
    throw new WeeklyReportStorageError(
      "A valid weekly report is required.",
      400,
      "INVALID_REPORT"
    );
  }

  const startDate = validateReportDate(
    report.period?.startDate,
    "Report start date"
  );

  const endDate = validateReportDate(
    report.period?.endDate,
    "Report end date"
  );

  if (endDate < startDate) {
    throw new WeeklyReportStorageError(
      "The report end date cannot be before its start date.",
      400,
      "INVALID_REPORT_PERIOD"
    );
  }

  if (
    !report.reading ||
    !Array.isArray(report.reading.attempts) ||
    !report.comprehension ||
    !Array.isArray(report.comprehension.assessments) ||
    !report.currentCompletionSnapshot ||
    typeof report.currentCompletionSnapshot !== "object" ||
    Array.isArray(report.currentCompletionSnapshot)
  ) {
    throw new WeeklyReportStorageError(
      "The weekly report contains incomplete data.",
      400,
      "INVALID_REPORT"
    );
  }

  if (
    typeof report.generatedAt !== "string" ||
    !Number.isFinite(Date.parse(report.generatedAt))
  ) {
    throw new WeeklyReportStorageError(
      "The report generation timestamp is invalid.",
      400,
      "INVALID_REPORT"
    );
  }

  return { startDate, endDate };
}

function toSavedReport(row) {
  return {
    id: row.id,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    createdAt: row.created_at,
    report: row.report_data,
  };
}

function toReportHistoryItem(row) {
  return {
    id: row.id,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    createdAt: row.created_at,
  };
}

async function saveWeeklyReport(
  requester,
  report,
  dependencies = {}
) {
  const { startDate, endDate } =
    validateReportSnapshot(report);

  const supabase =
    dependencies.getSupabaseAdmin?.() ??
    getSupabaseAdmin();

  const { data, error } = await supabase
    .from("weekly_reports")
    .insert({
      teacher_id: requester.user.id,
      period_start: startDate,
      period_end: endDate,
      report_data: report,
    })
    .select(
      "id, period_start, period_end, report_data, created_at"
    )
    .single();

  if (error || !data) {
    console.error("Unable to save M7 weekly report:", error);

    throw new WeeklyReportStorageError(
      "Unable to save the weekly report. Please try again."
    );
  }

  return toSavedReport(data);
}

async function listWeeklyReports(
  requester,
  dependencies = {}
) {
  const supabase =
    dependencies.getSupabaseAdmin?.() ??
    getSupabaseAdmin();

  const { data, error } = await supabase
    .from("weekly_reports")
    .select(
      "id, period_start, period_end, created_at"
    )
    .eq("teacher_id", requester.user.id)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(100);

  if (error) {
    console.error("Unable to list M7 weekly reports:", error);

    throw new WeeklyReportStorageError(
      "Unable to load your saved weekly reports."
    );
  }

  return (data ?? []).map(toReportHistoryItem);
}

async function getSavedWeeklyReport(
  requester,
  reportId,
  dependencies = {}
) {
  if (
    typeof reportId !== "string" ||
    !UUID_PATTERN.test(reportId)
  ) {
    throw new WeeklyReportStorageError(
      "Weekly report not found.",
      404,
      "REPORT_NOT_FOUND"
    );
  }

  const supabase =
    dependencies.getSupabaseAdmin?.() ??
    getSupabaseAdmin();

  const { data, error } = await supabase
    .from("weekly_reports")
    .select(
      "id, period_start, period_end, report_data, created_at"
    )
    .eq("id", reportId)
    .eq("teacher_id", requester.user.id)
    .maybeSingle();

  if (error) {
    console.error("Unable to retrieve M7 weekly report:", error);

    throw new WeeklyReportStorageError(
      "Unable to load the saved weekly report."
    );
  }

  if (!data) {
    throw new WeeklyReportStorageError(
      "Weekly report not found.",
      404,
      "REPORT_NOT_FOUND"
    );
  }

  return toSavedReport(data);
}

module.exports = {
  WeeklyReportStorageError,
  saveWeeklyReport,
  listWeeklyReports,
  getSavedWeeklyReport,
};
