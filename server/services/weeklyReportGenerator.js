const { loadWeeklyComprehensions } = require('./weeklyReportComprehension');

const {
  listTeacherOralReadingAttempts,
} = require("./oralReadingAttemptService");

const {
  getTeacherCompletionAnalytics,
} = require("./teacherCompletionAnalytics");

const {
  WeeklyReportStorageError,
} = require("./weeklyReportStorage");

const PHILIPPINE_UTC_OFFSET_MS = 8 * 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function round(value) {
  return Math.round(value * 100) / 100;
}

function average(values) {
  const valid = values.filter(Number.isFinite);

  if (valid.length === 0) {
    return null;
  }

  return round(
    valid.reduce((sum, value) => sum + value, 0) /
      valid.length
  );
}

function parseDate(date) {
  if (
    typeof date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date)
  ) {
    throw new WeeklyReportStorageError(
      "Dates must use YYYY-MM-DD format.",
      400,
      "INVALID_REPORT_DATE"
    );
  }

  const parsed = new Date(`${date}T00:00:00.000Z`);

  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== date
  ) {
    throw new WeeklyReportStorageError(
      "Invalid report date.",
      400,
      "INVALID_REPORT_DATE"
    );
  }

  return parsed;
}

function getPeriodBounds(period) {
  if (
    !period ||
    typeof period !== "object" ||
    Array.isArray(period)
  ) {
    throw new WeeklyReportStorageError(
      "A reporting period is required.",
      400,
      "INVALID_REPORT_PERIOD"
    );
  }

  const startDate = parseDate(period.startDate);
  const endDate = parseDate(period.endDate);

  if (endDate.getTime() < startDate.getTime()) {
    throw new WeeklyReportStorageError(
      "The report end date cannot be before its start date.",
      400,
      "INVALID_REPORT_PERIOD"
    );
  }

  const start =
    startDate.getTime() - PHILIPPINE_UTC_OFFSET_MS;

  const endExclusive =
    endDate.getTime() +
    ONE_DAY_MS -
    PHILIPPINE_UTC_OFFSET_MS;

  return { start, endExclusive };
}

function isWithinPeriod(timestamp, start, endExclusive) {
  if (!timestamp) {
    return false;
  }

  const time = Date.parse(timestamp);

  return (
    Number.isFinite(time) &&
    time >= start &&
    time < endExclusive
  );
}

function buildWeeklyReport(attempts, completion, period, quizAssessments) {
  const { start, endExclusive } = getPeriodBounds(period);

  const weeklyReadings = attempts.filter((attempt) =>
    isWithinPeriod(attempt.completedAt, start, endExclusive)
  );

  const readings = weeklyReadings.map((attempt) => ({
    attemptId: attempt.id,
    studentId: attempt.learnerId,
    studentName: attempt.learnerName,
    moduleTitle: attempt.moduleTitle,
    completedAt: attempt.completedAt,
    pronunciationAccuracy: attempt.pronunciationAccuracy,
    readingSpeedWpm: attempt.readingSpeedWpm,
  }));

  const comprehensions = quizAssessments ?? attempts.flatMap((attempt) => {
    const result = attempt.comprehension;

    if (
      result?.status !== "completed" ||
      !isWithinPeriod(
        result.completedAt,
        start,
        endExclusive
      ) ||
      result.totalQuestions <= 0 ||
      !Number.isFinite(result.firstCorrect) ||
      !Number.isFinite(result.firstAttemptPercentage)
    ) {
      return [];
    }

    return [{
      attemptId: attempt.id,
      studentId: attempt.learnerId,
      studentName: attempt.learnerName,
      moduleTitle: attempt.moduleTitle,
      completedAt: result.completedAt,
      correctAnswers: result.firstCorrect,
      totalQuestions: result.totalQuestions,
      scorePercentage: result.firstAttemptPercentage,
    }];
  });

  return {
    period: {
      startDate: period.startDate,
      endDate: period.endDate,
    },

    generatedAt: new Date().toISOString(),

    reading: {
      totalAttempts: readings.length,
      studentsWithAttempts: new Set(
        readings.map((item) => item.studentId)
      ).size,
      averagePronunciationAccuracy: average(
        readings.map((item) => item.pronunciationAccuracy)
      ),
      averageReadingSpeedWpm: average(
        readings.map((item) => item.readingSpeedWpm)
      ),
      attempts: readings,
    },

    comprehension: {
      completedAssessments: comprehensions.length,
      studentsWithAssessments: new Set(
        comprehensions.map((item) => item.studentId)
      ).size,
      averageScore: average(
        comprehensions.map((item) => item.scorePercentage)
      ),
      assessments: comprehensions,
    },

    // Snapshot of current assignment status.
    // Not a historical weekly completion rate.
    currentCompletionSnapshot: completion,
  };
}

async function generateTeacherWeeklyReport(
  requester,
  period,
  dependencies = {}
) {
  // Validate dates before making database requests.
  const bounds = getPeriodBounds(period);

  const loadAttempts =
    dependencies.listTeacherOralReadingAttempts ??
    listTeacherOralReadingAttempts;

  const loadCompletion =
    dependencies.getTeacherCompletionAnalytics ??
    getTeacherCompletionAnalytics;

  const [attempts, completion, assessments] = await Promise.all([
    loadAttempts(requester, { ...dependencies, weeklyReportStrict: true, weeklyReportSeparateQuizzes: true }),
    loadCompletion(requester, { ...dependencies, weeklyReportStrict: true }),
    (dependencies.loadWeeklyComprehensions ?? loadWeeklyComprehensions)(requester, bounds, dependencies),
  ]);

  if (attempts.some(attempt => !attempt.comprehension || attempt.comprehension.status === "unavailable")) {
    throw new WeeklyReportStorageError("Required comprehension data is unavailable. Report was not saved.");
  }
  return buildWeeklyReport(attempts, completion, period, assessments);
}

module.exports = {
  buildWeeklyReport,
  generateTeacherWeeklyReport,
};
