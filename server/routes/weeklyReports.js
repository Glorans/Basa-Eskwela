
const express = require("express");

const {
  SupabaseAuthenticationError,
  SupabaseServerConfigurationError,
} = require("../services/supabaseAdmin");

const {
  OralReadingAuthorizationError,
  OralReadingPersistenceError,
  authorizeTeacherOralReadingRequest,
} = require("../services/oralReadingAttemptService");

const {
  WeeklyReportStorageError,
  saveWeeklyReport,
  listWeeklyReports,
  getSavedWeeklyReport,
} = require("../services/weeklyReportStorage");

const {
  generateTeacherWeeklyReport,
} = require("../services/weeklyReportGenerator");

function sendWeeklyReportError(res, error) {
  if (error instanceof SupabaseAuthenticationError) {
    return res.status(401).json({
      success: false,
      message: error.message,
    });
  }

  if (error instanceof OralReadingAuthorizationError) {
    return res.status(403).json({
      success: false,
      message: error.message,
    });
  }

  if (
    error instanceof WeeklyReportStorageError ||
    error instanceof OralReadingPersistenceError
  ) {
    if (error.statusCode >= 500) {
      console.error("M7 weekly report operation failed:", error);
    }

    return res.status(error.statusCode).json({
      success: false,
      message: error.message,
      code: error.code,
    });
  }

  if (error instanceof SupabaseServerConfigurationError) {
    console.error("M7 Supabase configuration is missing.");

    return res.status(503).json({
      success: false,
      message: error.message,
    });
  }

  console.error("Unexpected M7 weekly report failure:", error);

  return res.status(500).json({
    success: false,
    message: "Unable to process the weekly report request.",
  });
}

function createWeeklyReportsRouter(dependencies = {}) {
  const router = express.Router();

  const authorizeTeacher =
    dependencies.authorizeTeacherOralReadingRequest ??
    authorizeTeacherOralReadingRequest;

  const saveReport =
    dependencies.saveWeeklyReport ??
    saveWeeklyReport;

  const listReports =
    dependencies.listWeeklyReports ??
    listWeeklyReports;

  const getReport =
    dependencies.getSavedWeeklyReport ??
    getSavedWeeklyReport;

  const generateReport =
    dependencies.generateTeacherWeeklyReport ??
    generateTeacherWeeklyReport;

  // List saved reports belonging to the signed-in teacher.
  router.get("/", async (req, res) => {
    try {
      const requester = await authorizeTeacher(req, dependencies);
      const reports = await listReports(requester, dependencies);

      return res.json({
        success: true,
        reports,
      });
    } catch (error) {
      return sendWeeklyReportError(res, error);
    }
  });

  // Retrieve a specific saved report owned by the teacher.
  router.get("/:reportId", async (req, res) => {
    try {
      const requester = await authorizeTeacher(req, dependencies);

      const report = await getReport(
        requester,
        req.params.reportId,
        dependencies
      );

      return res.json({
        success: true,
        report,
      });
    } catch (error) {
      return sendWeeklyReportError(res, error);
    }
  });

  // Generate and save a weekly report using verified backend data.
  router.post("/", async (req, res) => {
    try {
      const requester = await authorizeTeacher(req, dependencies);

      const period = req.body?.period;

      // Never accept calculated report statistics from the browser.
      // Reading, comprehension, and completion data are retrieved
      // and calculated by the authenticated backend services.
      const report = await generateReport(
        requester,
        period,
        dependencies
      );

      const savedReport = await saveReport(
        requester,
        report,
        dependencies
      );

      return res.status(201).json({
        success: true,
        report: savedReport,
      });
    } catch (error) {
      return sendWeeklyReportError(res, error);
    }
  });

  return router;
}

const weeklyReportsRouter = createWeeklyReportsRouter();

module.exports = {
  createWeeklyReportsRouter,
  weeklyReportsRouter,
};
