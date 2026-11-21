const { loadWeeklyComprehensions, loadWeeklyRiskSummary, riskSummary } = require('./weeklyReportComprehension');

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

  const [attempts, completion, assessments, riskClassifications] = await Promise.all([
    loadAttempts(requester, { ...dependencies, weeklyReportStrict: true, weeklyReportSeparateQuizzes: true }),
    loadCompletion(requester, { ...dependencies, weeklyReportStrict: true }),
    (dependencies.loadWeeklyComprehensions ?? loadWeeklyComprehensions)(requester, bounds, dependencies),
    (dependencies.loadWeeklyRiskSummary ?? loadWeeklyRiskSummary)(requester, dependencies),
  ]);

  if (attempts.some(attempt => !attempt.comprehension || attempt.comprehension.status === "unavailable")) {
    throw new WeeklyReportStorageError("Required comprehension data is unavailable. Report was not saved.");
  }
  return { ...buildWeeklyReport(attempts, completion, period, assessments), riskClassifications };
}

// ---- Admin weekly reports: every Student-role learner; Independent Learners are not included ----
const ADMIN_LEARNER_SCOPE = "Students (Student accounts) only. Independent Learner practice is not included.";

/**
 * Admin report from the same saved records and rules as the Admin dashboard: the shared
 * reading and comprehension sections, plus classroom comparisons, student summaries and
 * competency results for the period. Built in memory; saving is a separate step.
 */
function buildAdminWeeklyReport(data, period) {
  const { start, endExclusive } = getPeriodBounds(period);
  const { buildAdminAnalytics, buildAdminStudents, competencyOf } = require("./adminSystemAnalytics");
  const { completionProgress, summarizeCompletion } = require("./teacherCompletionAnalytics");
  const students = new Map(data.profiles.filter((p) => p.role === "student").map((p) => [p.id, p]));
  const nameOf = (id) => students.get(id).full_name || students.get(id).nickname || "Student";

  const attempts = data.readings.filter((r) => students.has(r.user_id)).map((r) => ({
    id: r.id, learnerId: r.user_id, learnerName: nameOf(r.user_id),
    moduleTitle: r.passage_title_snapshot || r.module_title_snapshot || "Reading activity",
    completedAt: r.completed_at, pronunciationAccuracy: Number(r.pronunciation_accuracy), readingSpeedWpm: Number(r.reading_speed_wpm),
  }));
  const quizzes = data.quizzes.filter((q) => students.has(q.userId) && isWithinPeriod(q.completedAt, start, endExclusive));
  if (data.quizzes.some((q) => students.has(q.userId) && q.dataQuality && (!q.completedAt || isWithinPeriod(q.completedAt, start, endExclusive)))) {
    throw new WeeklyReportStorageError("Completed assessment evidence is incomplete. Report was not generated.", 422, "INVALID_ASSESSMENT_EVIDENCE");
  }
  const assessments = quizzes.map((q) => ({
    attemptId: q.id, studentId: q.userId, studentName: nameOf(q.userId), moduleTitle: q.title || "Comprehension activity",
    completedAt: q.completedAt, correctAnswers: q.firstCorrect, totalQuestions: q.totalQuestions, scorePercentage: q.score,
  }));

  // Current completion snapshot, with the Teacher report's rules for every classroom.
  const roomsByStudent = new Map();
  for (const e of data.enrollments) {
    if (!students.has(e.student_id)) continue;
    roomsByStudent.set(e.student_id, (roomsByStudent.get(e.student_id) ?? new Set()).add(e.room_id));
  }
  const completion = summarizeCompletion(data.rooms.map((room) => ({
    room,
    progress: completionProgress(room, data.assignments.filter((a) => a.room_id === room.id),
      data.readings.filter((r) => r.room_id === room.id), data.attempts.filter((a) => a.room_id === room.id), { roomsByStudent }),
  })));

  const report = buildWeeklyReport(attempts, completion, period, assessments);
  const dashboard = buildAdminAnalytics(data, { roomId: null, startDate: period.startDate, endDate: period.endDate });
  const summaries = [...students.values()].map((student) => {
    const readings = report.reading.attempts.filter((a) => a.studentId === student.id);
    const results = assessments.filter((a) => a.studentId === student.id);
    return {
      studentId: student.id, studentName: nameOf(student.id), readingAttempts: readings.length,
      averageReadingAccuracy: average(readings.map((a) => a.pronunciationAccuracy)), averageReadingSpeedWpm: average(readings.map((a) => a.readingSpeedWpm)),
      completedAssessments: results.length, averageScore: average(results.map((a) => a.scorePercentage)),
    };
  }).filter((s) => s.readingAttempts || s.completedAssessments).sort((a, b) => a.studentName.localeCompare(b.studentName));

  return {
    ...report,
    scope: "admin",
    learnerScope: ADMIN_LEARNER_SCOPE,
    classroomComparisons: dashboard.details.classroomComparisons.map((room) => ({
      roomId: room.id, roomName: room.name, teacherName: room.teacherName, enrolledStudents: room.enrolledStudents,
      participatingStudents: room.participatingStudents, readingAttempts: room.readingAttempts, averageReadingAccuracy: room.pronunciationAccuracy,
      averageReadingSpeedWpm: room.readingSpeedWpm, completedAssessments: room.completedQuizzes, averageScore: room.comprehensionScore,
    })),
    studentSummaries: summaries,
    competency: competencyOf(quizzes),
    // Current status when the report is generated, from each student's full quiz history.
    riskClassifications: riskSummary(buildAdminStudents(data).map((row) => ({ studentId: row.id, studentName: row.name, classification: row.classification }))),
  };
}

async function generateAdminWeeklyReport(requester, period, dependencies = {}) {
  if (requester?.profile?.role !== "admin") {
    const { AdminAuthorizationError } = require("./adminUserService");
    throw new AdminAuthorizationError();
  }
  // Validate dates before reading anything.
  getPeriodBounds(period);
  const load = dependencies.loadAdminData ?? require("./adminSystemAnalytics").loadAdminData;
  // M1 multi-tenancy: only the School Admin's own school.
  const { members } = await (dependencies.requesterSchoolMembers ?? require("./schoolScope").requesterSchoolMembers)(requester, dependencies);
  return buildAdminWeeklyReport(await load(dependencies, members), period);
}

module.exports = {
  buildWeeklyReport,
  generateTeacherWeeklyReport,
  buildAdminWeeklyReport,
  generateAdminWeeklyReport,
};
