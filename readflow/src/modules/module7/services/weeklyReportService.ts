
import { getTeacherOralReadingAttempts } from "../../module5/services/oralReadingService";
import type { TeacherOralReadingAttemptSummary } from "../../module5/types/oralReading";
import {
  getTeacherCompletionAnalytics,
} from "./teacherAnalyticsService";
import type {
  TeacherCompletionAnalytics,
} from "./teacherAnalyticsService";

export interface WeeklyReportPeriod {
  startDate: string;
  endDate: string;
}

export interface WeeklyReportReading {
  attemptId: string;
  studentId: string;
  studentName: string;
  moduleTitle: string;
  completedAt: string;
  pronunciationAccuracy: number;
  readingSpeedWpm: number;
}

export interface WeeklyReportComprehension {
  attemptId: string;
  studentId: string;
  studentName: string;
  moduleTitle: string;
  completedAt: string;
  correctAnswers: number;
  totalQuestions: number;
  scorePercentage: number;
}

export interface WeeklyReport {
  period: WeeklyReportPeriod;
  generatedAt: string;
  reading: {
    totalAttempts: number;
    studentsWithAttempts: number;
    averagePronunciationAccuracy: number | null;
    averageReadingSpeedWpm: number | null;
    attempts: WeeklyReportReading[];
  };
  comprehension: {
    completedAssessments: number;
    studentsWithAssessments: number;
    averageScore: number | null;
    assessments: WeeklyReportComprehension[];
  };
  currentCompletionSnapshot: TeacherCompletionAnalytics;
}

// Philippine Standard Time is UTC+8.
const PHILIPPINE_UTC_OFFSET_MS =
  8 * 60 * 60 * 1000;

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function average(values: number[]): number | null {
  const valid = values.filter(Number.isFinite);

  if (valid.length === 0) {
    return null;
  }

  return round(
    valid.reduce((sum, value) => sum + value, 0) /
      valid.length
  );
}

function parseDate(date: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("Dates must use YYYY-MM-DD format.");
  }

  const parsed = new Date(`${date}T00:00:00.000Z`);

  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== date
  ) {
    throw new Error("Invalid report date.");
  }

  return parsed;
}

function getPeriodBounds(period: WeeklyReportPeriod): {
  start: number;
  endExclusive: number;
} {
  const startDate = parseDate(period.startDate);
  const endDate = parseDate(period.endDate);

  if (endDate.getTime() < startDate.getTime()) {
    throw new Error(
      "The report end date cannot be before its start date."
    );
  }

  // Convert midnight Philippine time to its UTC timestamp.
  // Example: Monday 00:00 PHT = Sunday 16:00 UTC.
  const start =
    startDate.getTime() - PHILIPPINE_UTC_OFFSET_MS;

  // The exclusive end is midnight PHT on the day
  // immediately after the selected end date.
  const endExclusive =
    endDate.getTime() +
    ONE_DAY_MS -
    PHILIPPINE_UTC_OFFSET_MS;

  return {
    start,
    endExclusive,
  };
}

function isWithinPeriod(
  timestamp: string | null | undefined,
  start: number,
  endExclusive: number
): boolean {
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

export function buildWeeklyReport(
  attempts: TeacherOralReadingAttemptSummary[],
  completion: TeacherCompletionAnalytics,
  period: WeeklyReportPeriod
): WeeklyReport {
  const { start, endExclusive } = getPeriodBounds(period);

  const weeklyReadings = attempts.filter((attempt) =>
    isWithinPeriod(attempt.completedAt, start, endExclusive)
  );

  const readings: WeeklyReportReading[] = weeklyReadings.map(
    (attempt) => ({
      attemptId: attempt.id,
      studentId: attempt.learnerId,
      studentName: attempt.learnerName,
      moduleTitle: attempt.moduleTitle,
      completedAt: attempt.completedAt,
      pronunciationAccuracy: attempt.pronunciationAccuracy,
      readingSpeedWpm: attempt.readingSpeedWpm,
    })
  );

  const comprehensions: WeeklyReportComprehension[] =
    attempts.flatMap((attempt) => {
      const result = attempt.comprehension;

      if (
        result.status !== "completed" ||
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

      return [
        {
          attemptId: attempt.id,
          studentId: attempt.learnerId,
          studentName: attempt.learnerName,
          moduleTitle: attempt.moduleTitle,
          completedAt: result.completedAt!,
          correctAnswers: result.firstCorrect,
          totalQuestions: result.totalQuestions,
          scorePercentage: result.firstAttemptPercentage,
        },
      ];
    });

  return {
    period: { ...period },
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

    // Current assignment status, not historical weekly completion.
    currentCompletionSnapshot: completion,
  };
}

export async function generateWeeklyReport(
  period: WeeklyReportPeriod
): Promise<WeeklyReport> {
  // Validate Philippine-local report dates before fetching data.
  getPeriodBounds(period);

  const [attempts, completion] = await Promise.all([
    getTeacherOralReadingAttempts(),
    getTeacherCompletionAnalytics(),
  ]);

  return buildWeeklyReport(attempts, completion, period);
}
