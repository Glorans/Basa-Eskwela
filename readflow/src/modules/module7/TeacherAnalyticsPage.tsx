import AnalyticsFilterBar from "./components/AnalyticsFilterBar";
import { allTime, type AnalyticsScope } from "./services/analyticsFilters";
import { formatScore } from "./services/scoreDisplay";
import { getTeacherQuizAttempts } from "./services/teacherQuizService";
import { assessmentSourceLabel, assessmentSourceNote } from "./services/assessmentSource.ts";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  Award,
  BookOpenCheck,
  CheckCircle2,
  ClipboardList,
  Gauge,
  GraduationCap,
  RefreshCw,
  Target,
  Users,
} from "lucide-react";

import "./m7Dashboard.css";

import {
  getTeacherAnalytics,
  getTeacherCompletionAnalytics,
  type TeacherAnalyticsSummary,
  type TeacherCompletionAnalytics,
} from "./services/teacherAnalyticsService";

import {
  getClassPerformance,
  type ClassPerformanceResult,
} from "./services/classPerformanceService";

import {
  getStudentPerformance,
  type StudentPerformanceResult,
} from "./services/studentPerformanceService";

import {
  getQuizScores,
  type QuizScoreResult,
} from "./services/quizScoreService";

import WeeklyReportSection from "./WeeklyReportSection";


type AnalyticsMetric = {
  label: string;
  value: string;
  description: string;
  icon: typeof Activity;
};

function formatNumber(value: number | null): string {
  if (value === null) return "N/A";

  return value.toLocaleString("en-PH", {
    maximumFractionDigits: 2,
  });
}

function formatPercentage(value: number | null): string {
  return value === null ? "N/A" : formatScore(value);
}

function formatDate(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Date unavailable";
  }

  return date.toLocaleDateString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

const cardStyle = {
  backgroundColor: "#dce8e7",
  borderRadius: "16px",
  padding: "24px",
  boxShadow: "0 3px 12px rgba(0, 0, 0, 0.06)",
  display: "flex",
  flexDirection: "column",
  gap: "12px",
} as const;

const gridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))",
  gap: "16px",
} as const;

function MetricCard({ metric }: { metric: AnalyticsMetric }) {
  const Icon = metric.icon;

  return (
    <article style={cardStyle}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
          color: "#164b40",
        }}
      >
        <Icon size={22} aria-hidden="true" />
        <strong>{metric.label}</strong>
      </div>

      <div
        style={{
          fontSize: "30px",
          fontWeight: 700,
          color: "#173d35",
        }}
      >
        {metric.value}
      </div>

      <p
        style={{
          fontSize: "13px",
          color: "#64748b",
          margin: 0,
        }}
      >
        {metric.description}
      </p>
    </article>
  );
}

function ProgressBar({
  label,
  value,
}: {
  label: string;
  value: number | null;
}) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value ?? undefined}
      aria-valuetext={
        value === null
          ? "No assignments"
          : formatPercentage(value)
      }
      style={{
        height: "12px",
        borderRadius: "999px",
        backgroundColor: "#e2e8f0",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          height: "100%",
          width: `${Math.max(
            0,
            Math.min(100, value ?? 0)
          )}%`,
          backgroundColor: "#17846d",
          borderRadius: "999px",
        }}
      />
    </div>
  );
}

function AssessmentSourceNote({
  classroomFiltered,
  independentCount,
}: {
  classroomFiltered: boolean;
  independentCount: number;
}) {
  return (
    <p role="note" style={{ margin: "16px 0 0" }}>
      {assessmentSourceNote(classroomFiltered, independentCount)}
    </p>
  );
}

export default function TeacherAnalyticsPage() {
  const [scope,setScope] = useState<AnalyticsScope>(allTime);
  const [tab,setTab] = useState(0);
  const request = useRef(0);
  const [rooms,setRooms] = useState<{id:string;name:string}[]>([]);

  const [analytics, setAnalytics] =
    useState<TeacherAnalyticsSummary | null>(null);

  const [completion, setCompletion] =
    useState<TeacherCompletionAnalytics | null>(null);

  const [classPerformance, setClassPerformance] =
    useState<ClassPerformanceResult | null>(null);

  const [studentPerformance, setStudentPerformance] =
    useState<StudentPerformanceResult | null>(null);

  const [quizScores, setQuizScores] =
    useState<QuizScoreResult | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [completionError, setCompletionError] = useState("");
  const [classError, setClassError] = useState("");
  const [studentError, setStudentError] = useState("");
  const [quizError, setQuizError] = useState("");

  const loadAnalytics = useCallback(async () => {
    const version = ++request.current;
    setLoading(true);
    setError("");
    setCompletionError("");
    setClassError("");
    setStudentError("");
    setQuizError("");

    // All quiz-derived panels use one snapshot per refresh.
    const quizSnapshot = getTeacherQuizAttempts();
    const loadQuizzes = () => quizSnapshot;
    const completionSnapshot = getTeacherCompletionAnalytics();
    const loadCompletion = () => completionSnapshot;

    const [
      analyticsResult,
      completionResult,
      classResult,
      studentResult,
      quizResult,
    ] = await Promise.allSettled([
      getTeacherAnalytics(loadQuizzes, scope),
      completionSnapshot,
      getClassPerformance(loadQuizzes, loadCompletion, scope),
      getStudentPerformance(loadQuizzes, loadCompletion, scope),
      getQuizScores(loadQuizzes, scope),
    ]);

    if (version !== request.current) return;
    if (completionResult.status === "fulfilled") setRooms(completionResult.value.classrooms.map(room => ({id:room.roomId,name:room.roomName})));

    if (analyticsResult.status === "fulfilled") {
      setAnalytics(analyticsResult.value);
    } else {
      setAnalytics(null);
      setError(
        analyticsResult.reason instanceof Error
          ? analyticsResult.reason.message
          : "Unable to load analytics data."
      );
    }

    if (completionResult.status === "fulfilled") {
      const value = completionResult.value;
      const classrooms = value.classrooms.filter(room => !scope.roomId || room.roomId === scope.roomId);
      const totalAssignments = classrooms.reduce((sum,room)=>sum+room.totalAssignments,0);
      const completedAssignments = classrooms.reduce((sum,room)=>sum+room.completedAssignments,0);
      setCompletion(scope.roomId ? {...value,classrooms,totalClassrooms:classrooms.length,totalAssignments,completedAssignments,incompleteAssignments:totalAssignments-completedAssignments,completionRate:totalAssignments ? Math.round(completedAssignments/totalAssignments*10000)/100 : null} : value);
    } else {
      setCompletion(null);
      setCompletionError(
        completionResult.reason instanceof Error
          ? completionResult.reason.message
          : "Unable to load completion analytics."
      );
    }

    if (classResult.status === "fulfilled") {
      setClassPerformance(classResult.value);
    } else {
      setClassPerformance(null);
      setClassError(
        classResult.reason instanceof Error
          ? classResult.reason.message
          : "Unable to load class performance."
      );
    }

    if (studentResult.status === "fulfilled") {
      setStudentPerformance(studentResult.value);
    } else {
      setStudentPerformance(null);
      setStudentError(
        studentResult.reason instanceof Error
          ? studentResult.reason.message
          : "Unable to load student performance."
      );
    }

    if (quizResult.status === "fulfilled") {
      setQuizScores(quizResult.value);
    } else {
      setQuizScores(null);
      setQuizError(
        quizResult.reason instanceof Error
          ? quizResult.reason.message
          : "Unable to load quiz scores."
      );
    }

    setLoading(false);
  }, [scope]);

  useEffect(() => {
    void loadAnalytics();
    return () => { request.current++; };
  }, [loadAnalytics]);

  const metrics: AnalyticsMetric[] = analytics
    ? [
        {
          label: "Reading Attempts",
          value: formatNumber(
            analytics.totalReadingAttempts
          ),
          description: "Recorded oral-reading attempts",
          icon: BookOpenCheck,
        },
        {
          label: "Students With Results",
          value: formatNumber(
            analytics.studentsWithResults
          ),
          description:
            "Unique learners with recorded attempts",
          icon: Users,
        },
        {
          label: "Reading Accuracy",
          value: formatPercentage(
            analytics.averagePronunciationAccuracy
          ),
          description:
            "Average transcript-based accuracy",
          icon: Target,
        },
        {
          label: "Reading Speed",
          value:
            analytics.averageReadingSpeedWpm === null
              ? "N/A"
              : `${formatNumber(
                  analytics.averageReadingSpeedWpm
                )} WPM`,
          description:
            "Average recorded reading speed",
          icon: Gauge,
        },
        {
          label: "Comprehension Score",
          value: formatPercentage(
            analytics.averageComprehensionScore
          ),
          description:
            "Average first-attempt comprehension score",
          icon: Activity,
        },
        {
          label: "Completed Comprehension",
          value: formatNumber(
            analytics.completedComprehensionAttempts
          ),
          description:
            "Attempts with completed comprehension",
          icon: BookOpenCheck,
        },
      ]
    : [];

  const completionMetrics: AnalyticsMetric[] = completion
    ? [
        {
          label: "Completion Rate",
          value: formatPercentage(
            completion.completionRate
          ),
          description:
            "Evidence-verified assignment completion rate",
          icon: CheckCircle2,
        },
        {
          label: "Total Assignments",
          value: formatNumber(
            completion.totalAssignments
          ),
          description:
            "Reading activities assigned to students",
          icon: ClipboardList,
        },
        {
          label: "Completed Assignments",
          value: formatNumber(
            completion.completedAssignments
          ),
          description:
            "Reading assignments verified as completed",
          icon: BookOpenCheck,
        },
        {
          label: "Incomplete Assignments",
          value: formatNumber(
            completion.incompleteAssignments
          ),
          description:
            "Assignments without verified completion",
          icon: Activity,
        },
      ]
    : [];

  const quizMetrics: AnalyticsMetric[] = quizScores
    ? [
        {
          label: "Completed Quizzes",
          value: formatNumber(
            quizScores.totalCompletedQuizzes
          ),
          description:
            "Completed comprehension assessments",
          icon: ClipboardList,
        },
        {
          label: "Students With Quiz Scores",
          value: formatNumber(
            quizScores.studentsWithScores
          ),
          description:
            "Unique learners with completed quizzes",
          icon: Users,
        },
        {
          label: "Average Quiz Score",
          value: formatPercentage(
            quizScores.averageQuizScore
          ),
          description:
            "Average first-attempt quiz percentage",
          icon: Target,
        },
        {
          label: "Highest Quiz Score",
          value: formatPercentage(
            quizScores.highestQuizScore
          ),
          description:
            "Highest recorded completed quiz score",
          icon: Award,
        },
        {
          label: "Lowest Quiz Score",
          value: formatPercentage(
            quizScores.lowestQuizScore
          ),
          description:
            "Lowest recorded completed quiz score",
          icon: Activity,
        },
      ]
    : [];

  return (
    <div className="m7-dashboard">
      <header className="m7-dashboard-header m7-header-card">
        <div>
          <h1>Analytics Dashboard</h1>
          <p>Monitor student reading performance, reading accuracy, comprehension results, and classroom completion rates.</p>
        </div>
          <button
            className="m3-button m3-button--secondary"
            type="button"
            disabled={loading}
            onClick={() => void loadAnalytics()}
          >
            <RefreshCw
              size={16}
              className={
                loading ? "m3-spinner" : ""
              }
            />
            Refresh
          </button>
      </header>
      <div className="m7-dashboard-content">

      <AnalyticsFilterBar rooms={rooms} onApply={value => { request.current++; setScope(value); }}/>
      <p>Applied performance period: {scope.startDate || 'All Time'}{scope.endDate ? ` through ${scope.endDate} (PHT)` : ''}. Classroom: {rooms.find(room=>room.id===scope.roomId)?.name || 'All Classrooms'}.</p>
      <p>Enrollment and assignment completion show current snapshots. Weekly Reports use their own reporting dates.</p>
      <div role="tablist" aria-label="Teacher analytics sections" className="m7-tabs">{['Overview','Classrooms & Students','Assessments'].map((label,index)=><button key={label} id={`analytics-tab-${index}`} role="tab" aria-selected={tab===index} aria-controls={`analytics-panel-${index}`} tabIndex={tab===index ? 0 : -1} onClick={()=>setTab(index)} onKeyDown={event=>{let next=index;if(event.key==='ArrowRight') next=(index+1)%3;else if(event.key==='ArrowLeft') next=(index+2)%3;else if(event.key==='Home') next=0;else if(event.key==='End') next=2;else return;event.preventDefault();setTab(next);document.getElementById(`analytics-tab-${next}`)?.focus();}}>{label}</button>)}</div>
      {error && (
        <p
          className="m3-error-message"
          role="alert"
        >
          {error}
        </p>
      )}

      {completionError && (
        <p
          className="m3-error-message"
          role="alert"
        >
          Completion analytics: {completionError}
        </p>
      )}

      {classError && (
        <p
          className="m3-error-message"
          role="alert"
        >
          Class performance: {classError}
        </p>
      )}

      {studentError && (
        <p
          className="m3-error-message"
          role="alert"
        >
          Student performance: {studentError}
        </p>
      )}

      {quizError && (
        <p
          className="m3-error-message"
          role="alert"
        >
          Quiz scores: {quizError}
        </p>
      )}

      {loading ? (
        <div
          className="m3-empty-state"
          role="status"
        >
          <RefreshCw
            size={36}
            className="m3-spinner"
          />
          <h2>Loading analytics...</h2>
          <p>
            Retrieving student and classroom results.
          </p>
        </div>
      ) : (
        <>
          <div role="tabpanel" id="analytics-panel-0" aria-labelledby="analytics-tab-0" hidden={tab !== 0} tabIndex={0}>
          {/* READING PERFORMANCE OVERVIEW */}

          {analytics ? (
            <section
              aria-labelledby="analytics-overview"
            >
              <div
                style={{
                  marginBottom: "20px",
                }}
              >
                <h2 id="analytics-overview">
                  Reading Performance Overview
                </h2>
                <p>
                  Summary of recorded reading assessments
                  from students in your classrooms.
                </p>
              </div>

              <div style={gridStyle}>
                {metrics.map((metric) => (
                  <MetricCard
                    key={metric.label}
                    metric={metric}
                  />
                ))}
              </div>

              <AssessmentSourceNote
                classroomFiltered={Boolean(scope.roomId)}
                independentCount={analytics.independentComprehensionAttempts}
              />

              {analytics.totalReadingAttempts === 0 && (
                <div
                  className="m3-empty-state"
                  style={{
                    marginTop: "24px",
                  }}
                >
                  <BookOpenCheck size={36} />
                  <h2>No reading results yet</h2>
                  <p>
                    Analytics will update when students
                    complete reading assessments.
                  </p>
                </div>
              )}
            </section>
          ) : (
            <div className="m3-empty-state">
              <Activity size={36} />
              <h2>
                Performance analytics unavailable
              </h2>
              <p>Please refresh to try again.</p>
            </div>
          )}

          {/* CLASSROOM COMPLETION OVERVIEW */}

          {completion && (
            <section
              aria-labelledby="completion-overview"
              style={{
                marginTop: "28px",
              }}
            >
              <div
                style={{
                  marginBottom: "20px",
                }}
              >
                <h2 id="completion-overview">
                  Classroom Completion Overview
                </h2>
                <p>
                  Track reading assignment completion
                  across your classrooms.
                </p>
              </div>

              <div style={gridStyle}>
                {completionMetrics.map((metric) => (
                  <MetricCard
                    key={metric.label}
                    metric={metric}
                  />
                ))}
              </div>

              <div
                style={{
                  marginTop: "24px",
                }}
              >
                <h3>
                  Completion by Classroom
                </h3>

                {completion.classrooms.length === 0 ? (
                  <div className="m3-empty-state">
                    <Users size={36} />
                    <h2>No classrooms found</h2>
                    <p>
                      Your classroom completion data
                      will appear here.
                    </p>
                  </div>
                ) : (
                  <div
                    style={{
                      display: "grid",
                      gap: "16px",
                      marginTop: "16px",
                    }}
                  >
                    {completion.classrooms.map(
                      (room) => (
                        <article
                          key={room.roomId}
                          style={cardStyle}
                        >
                          <div
                            style={{
                              display: "flex",
                              justifyContent:
                                "space-between",
                              alignItems: "center",
                              flexWrap: "wrap",
                              gap: "12px",
                            }}
                          >
                            <strong
                              style={{
                                fontSize: "18px",
                                color: "#173d35",
                              }}
                            >
                              {room.roomName}
                            </strong>

                            <strong
                              style={{
                                fontSize: "22px",
                                color: "#164b40",
                              }}
                            >
                              {formatPercentage(
                                room.completionRate
                              )}
                            </strong>
                          </div>

                          <ProgressBar
                            label={`${room.roomName} completion`}
                            value={
                              room.completionRate
                            }
                          />

                          <p
                            style={{
                              margin: 0,
                              fontSize: "13px",
                              color: "#64748b",
                            }}
                          >
                            {
                              room.completedAssignments
                            }{" "}
                            of{" "}
                            {
                              room.totalAssignments
                            }{" "}
                            assignments completed
                          </p>
                        </article>
                      )
                    )}
                  </div>
                )}
              </div>
            </section>
          )}

          </div><div role="tabpanel" id="analytics-panel-1" aria-labelledby="analytics-tab-1" hidden={tab !== 1} tabIndex={0}>
          {/* CLASS PERFORMANCE OVERVIEW */}

          {classPerformance && (
            <section
              aria-labelledby="class-performance-overview"
              style={{
                marginTop: "28px",
              }}
            >
              <div
                style={{
                  marginBottom: "20px",
                }}
              >
                <h2 id="class-performance-overview">
                  Class Performance Overview
                </h2>
                <p>
                  Review enrollment and available reading
                  assessment results for each classroom.
                </p>
              </div>

              <div style={gridStyle}>
                <MetricCard
                  metric={{
                    label: "Total Classrooms",
                    value: formatNumber(
                      classPerformance.totalClassrooms
                    ),
                    description:
                      "Classrooms assigned to you",
                    icon: BookOpenCheck,
                  }}
                />

                <MetricCard
                  metric={{
                    label:
                      "Unique Enrolled Students",
                    value: formatNumber(
                      classPerformance.totalEnrolledStudents
                    ),
                    description:
                      "Students enrolled across your classrooms",
                    icon: Users,
                  }}
                />

                <MetricCard
                  metric={{
                    label:
                      "Unattributed Reading Attempts",
                    value: formatNumber(
                      classPerformance.unattributedReadingAttempts
                    ),
                    description:
                      "Results not safely assignable to one classroom",
                    icon: Activity,
                  }}
                />
              </div>

              {classPerformance.classrooms.length ===
              0 ? (
                <div
                  className="m3-empty-state"
                  style={{
                    marginTop: "24px",
                  }}
                >
                  <Users size={36} />
                  <h2>No classrooms found</h2>
                  <p>
                    Classroom performance will appear
                    when classrooms are available.
                  </p>
                </div>
              ) : (
                <div
                  style={{
                    display: "grid",
                    gap: "18px",
                    marginTop: "24px",
                  }}
                >
                  {classPerformance.classrooms.map(
                    (room) => {
                      const roomMetrics: AnalyticsMetric[] =
                        [
                          {
                            label:
                              "Enrolled Students",
                            value: formatNumber(
                              room.enrolledStudents
                            ),
                            description:
                              "Students enrolled in this classroom",
                            icon: Users,
                          },
                          {
                            label:
                              "Students With Results",
                            value: formatNumber(
                              room.studentsWithResults
                            ),
                            description:
                              "Students with attributable reading results",
                            icon: Users,
                          },
                          {
                            label:
                              "Reading Attempts",
                            value: formatNumber(
                              room.readingAttempts
                            ),
                            description:
                              "Reading attempts attributed to this class",
                            icon: BookOpenCheck,
                          },
                          {
                            label:
                              "Reading Accuracy",
                            value: formatPercentage(
                              room.averagePronunciationAccuracy
                            ),
                            description:
                              "Average transcript-based reading accuracy",
                            icon: Target,
                          },
                          {
                            label:
                              "Reading Speed",
                            value:
                              room.averageReadingSpeedWpm ===
                              null
                                ? "N/A"
                                : `${formatNumber(
                                    room.averageReadingSpeedWpm
                                  )} WPM`,
                            description:
                              "Average available reading speed",
                            icon: Gauge,
                          },
                          {
                            label:
                              "Comprehension Score",
                            value: formatPercentage(
                              room.averageComprehensionScore
                            ),
                            description:
                              "Average completed comprehension score",
                            icon: Activity,
                          },
                          {
                            label:
                              "Completion Rate",
                            value: formatPercentage(
                              room.completionRate
                            ),
                            description: `${room.completedAssignments} of ${room.totalAssignments} assignments completed`,
                            icon: CheckCircle2,
                          },
                        ];

                      return (
                        <div key={room.roomId}>
                          <div
                            style={{
                              marginBottom: "14px",
                            }}
                          >
                            <h3
                              style={{
                                marginBottom: "4px",
                              }}
                            >
                              {room.roomName}
                            </h3>

                            {room.section && (
                              <p
                                style={{
                                  margin: 0,
                                }}
                              >
                                Section:{" "}
                                {room.section}
                              </p>
                            )}

                            {room.attributionLimited && (
                              <p
                                style={{
                                  color: "#9a6700",
                                  fontSize: "13px",
                                }}
                              >
                                Some assessment results
                                may be excluded because
                                students belong to
                                multiple classrooms.
                              </p>
                            )}
                          </div>

                          <div style={gridStyle}>
                            {roomMetrics.map(
                              (metric) => (
                                <MetricCard
                                  key={
                                    metric.label
                                  }
                                  metric={metric}
                                />
                              )
                            )}
                          </div>
                        </div>
                      );
                    }
                  )}
                </div>
              )}
            </section>
          )}

          {/* STUDENT PERFORMANCE AND PROGRESS TRACKING */}

          {studentPerformance && (
            <section
              aria-labelledby="student-performance-overview"
              style={{
                marginTop: "28px",
              }}
            >
              <div
                style={{
                  marginBottom: "20px",
                }}
              >
                <h2 id="student-performance-overview">
                  Student Performance Overview
                </h2>
                <p>
                  Monitor individual reading results
                  and evidence-verified assignment
                  progress across your classrooms.
                </p>
              </div>

              <div style={gridStyle}>
                <MetricCard
                  metric={{
                    label:
                      "Enrolled Students",
                    value: formatNumber(
                      studentPerformance.totalStudents
                    ),
                    description:
                      "Unique learners in your classrooms",
                    icon: GraduationCap,
                  }}
                />

                <MetricCard
                  metric={{
                    label:
                      "Students With Reading Results",
                    value: formatNumber(
                      studentPerformance.students.filter(
                        (student) =>
                          student.readingAttempts >
                          0
                      ).length
                    ),
                    description:
                      "Enrolled students with recorded reading attempts",
                    icon: Users,
                  }}
                />
              </div>

              {studentPerformance.students.length ===
              0 ? (
                <div
                  className="m3-empty-state"
                  style={{
                    marginTop: "24px",
                  }}
                >
                  <GraduationCap size={36} />
                  <h2>
                    No enrolled students yet
                  </h2>
                  <p>
                    Student performance will appear
                    when learners join your classrooms.
                  </p>
                </div>
              ) : (
                <div
                  style={{
                    display: "grid",
                    gap: "20px",
                    marginTop: "24px",
                  }}
                >
                  {studentPerformance.students.map(
                    (student) => {
                      const verifiedCompletion =
                        completion?.students?.find(
                          (item) =>
                            item.studentId ===
                            student.studentId
                        );

                      const hasVerifiedData =
                        verifiedCompletion !==
                        undefined;

                      const verifiedTotal =
                        verifiedCompletion?.totalAssignments ??
                        null;

                      const verifiedCompleted =
                        verifiedCompletion?.completedAssignments ??
                        null;

                      const verifiedIncomplete =
                        verifiedCompletion?.incompleteAssignments ??
                        null;

                      const verifiedRate =
                        verifiedCompletion?.completionRate ??
                        null;

                      const studentMetrics: AnalyticsMetric[] =
                        [
                          {
                            label:
                              "Reading Attempts",
                            value: formatNumber(
                              student.readingAttempts
                            ),
                            description:
                              "Recorded oral-reading attempts",
                            icon: BookOpenCheck,
                          },
                          {
                            label:
                              "Reading Accuracy",
                            value: formatPercentage(
                              student.averagePronunciationAccuracy
                            ),
                            description:
                              "Average transcript-based reading accuracy",
                            icon: Target,
                          },
                          {
                            label:
                              "Reading Speed",
                            value:
                              student.averageReadingSpeedWpm ===
                              null
                                ? "N/A"
                                : `${formatNumber(
                                    student.averageReadingSpeedWpm
                                  )} WPM`,
                            description:
                              "Average recorded reading speed",
                            icon: Gauge,
                          },
                          {
                            label:
                              "Comprehension Score",
                            value: formatPercentage(
                              student.averageComprehensionScore
                            ),
                            description:
                              "Average completed comprehension score",
                            icon: Activity,
                          },
                          {
                            label:
                              "Completed Comprehension",
                            value: formatNumber(
                              student.completedComprehensionAttempts
                            ),
                            description:
                              "Reading attempts with completed comprehension",
                            icon: CheckCircle2,
                          },
                          {
                            label:
                              "Assignment Completion Rate",
                            value:
                              formatPercentage(
                                verifiedRate
                              ),
                            description:
                              hasVerifiedData
                                ? `${verifiedCompleted} of ${verifiedTotal} assignments completed using assessment evidence`
                                : "Verified completion data unavailable",
                            icon: ClipboardList,
                          },
                        ];

                      return (
                        <article
                          key={
                            student.studentId
                          }
                          style={cardStyle}
                        >
                          <div>
                            <h3
                              style={{
                                color: "#173d35",
                                margin:
                                  "0 0 8px",
                              }}
                            >
                              {
                                student.studentName
                              }
                            </h3>

                            <p
                              style={{
                                color: "#64748b",
                                fontSize: "13px",
                                margin: 0,
                              }}
                            >
                              {
                                student.classrooms
                                  .length
                              }{" "}
                              {student.classrooms
                                .length === 1
                                ? "classroom"
                                : "classrooms"}
                              {" • "}
                              {
                                student.totalAssignments
                              }{" "}
                              assignments
                              {" • "}
                              {
                                student.inProgressAssignments
                              }{" "}
                              marked in progress
                            </p>
                          </div>

                          <div
                            style={gridStyle}
                          >
                            {studentMetrics.map(
                              (metric) => (
                                <MetricCard
                                  key={
                                    metric.label
                                  }
                                  metric={metric}
                                />
                              )
                            )}
                          </div>

                          {/* STUDENT PROGRESS TRACKING */}

                          <div>
                            <h4
                              style={{
                                margin:
                                  "0 0 14px",
                                color: "#173d35",
                              }}
                            >
                              Student Progress
                              Tracking
                            </h4>

                            <div
                              style={gridStyle}
                            >
                              <MetricCard
                                metric={{
                                  label:
                                    "Total Assignments",
                                  value:
                                    formatNumber(
                                      verifiedTotal
                                    ),
                                  description:
                                    "Assigned reading activities",
                                  icon: ClipboardList,
                                }}
                              />

                              <MetricCard
                                metric={{
                                  label:
                                    "Verified Completed",
                                  value:
                                    formatNumber(
                                      verifiedCompleted
                                    ),
                                  description:
                                    "Assignments with required saved assessment evidence",
                                  icon: CheckCircle2,
                                }}
                              />

                              <MetricCard
                                metric={{
                                  label:
                                    "Incomplete Assignments",
                                  value:
                                    formatNumber(
                                      verifiedIncomplete
                                    ),
                                  description:
                                    "Assignments without verified completion",
                                  icon: Activity,
                                }}
                              />

                              <MetricCard
                                metric={{
                                  label:
                                    "Marked In Progress",
                                  value:
                                    formatNumber(
                                      student.inProgressAssignments
                                    ),
                                  description:
                                    "Stored assignment statuses; not evidence-verified progress states",
                                  icon: Gauge,
                                }}
                              />
                            </div>

                            <div
                              style={{
                                marginTop: "16px",
                              }}
                            >
                              <div
                                style={{
                                  display: "flex",
                                  justifyContent:
                                    "space-between",
                                  alignItems:
                                    "center",
                                  gap: "12px",
                                  marginBottom:
                                    "10px",
                                }}
                              >
                                <strong
                                  style={{
                                    color: "#173d35",
                                  }}
                                >
                                  Overall Reading
                                  Assignment Progress
                                </strong>

                                <strong
                                  style={{
                                    color: "#164b40",
                                  }}
                                >
                                  {formatPercentage(
                                    verifiedRate
                                  )}
                                </strong>
                              </div>

                              <ProgressBar
                                label={`${student.studentName} assignment completion`}
                                value={
                                  verifiedRate
                                }
                              />
                            </div>
                          </div>

                          {/* CLASSROOM MEMBERSHIP */}

                          <div>
                            <h4
                              style={{
                                margin:
                                  "0 0 12px",
                                color: "#173d35",
                              }}
                            >
                              Classroom Membership
                              and Assignments
                            </h4>

                            <div
                              style={{
                                display: "grid",
                                gap: "12px",
                              }}
                            >
                              {student.classrooms.map(
                                (room) => {
                                  const verifiedRoom =
                                    verifiedCompletion?.classrooms.find(
                                      (item) =>
                                        item.roomId ===
                                        room.roomId
                                    );

                                  return (
                                    <div
                                      key={
                                        room.roomId
                                      }
                                      style={{
                                        padding:
                                          "16px",
                                        borderRadius:
                                          "12px",
                                        backgroundColor:
                                          "#f1f5f9",
                                      }}
                                    >
                                      <div
                                        style={{
                                          display:
                                            "flex",
                                          justifyContent:
                                            "space-between",
                                          alignItems:
                                            "center",
                                          flexWrap:
                                            "wrap",
                                          gap: "8px",
                                        }}
                                      >
                                        <strong>
                                          {
                                            room.roomName
                                          }
                                        </strong>

                                        <strong>
                                          {formatPercentage(
                                            verifiedRoom?.completionRate ??
                                              null
                                          )}
                                        </strong>
                                      </div>

                                      {room.section && (
                                        <p
                                          style={{
                                            margin:
                                              "6px 0",
                                            fontSize:
                                              "13px",
                                          }}
                                        >
                                          Section:{" "}
                                          {
                                            room.section
                                          }
                                        </p>
                                      )}

                                      <div
                                        style={{
                                          marginTop:
                                            "12px",
                                        }}
                                      >
                                        <ProgressBar
                                          label={`${student.studentName} progress in ${room.roomName}`}
                                          value={
                                            verifiedRoom?.completionRate ??
                                            null
                                          }
                                        />
                                      </div>

                                      <p
                                        style={{
                                          margin:
                                            "12px 0 0",
                                          color:
                                            "#64748b",
                                          fontSize:
                                            "13px",
                                        }}
                                      >
                                        {verifiedRoom
                                          ? `${verifiedRoom.completedAssignments} of ${verifiedRoom.totalAssignments} assignments completed`
                                          : "Verified completion unavailable"}
                                        {" • "}
                                        {verifiedRoom
                                          ? `${verifiedRoom.incompleteAssignments} incomplete`
                                          : "Incomplete count unavailable"}
                                        {" • "}
                                        {
                                          room.inProgressAssignments
                                        }{" "}
                                        marked in
                                        progress
                                      </p>
                                    </div>
                                  );
                                }
                              )}
                            </div>
                          </div>

                          <p
                            style={{
                              color: "#64748b",
                              fontSize: "12px",
                              margin: 0,
                            }}
                          >
                            Completed and incomplete
                            counts use saved oral-reading
                            and comprehension assessment
                            evidence. In-progress counts
                            reflect stored assignment
                            statuses. Completion indicates
                            assessment work finished,
                            not passage mastery or a
                            passing grade.
                          </p>
                        </article>
                      );
                    }
                  )}
                </div>
              )}
            </section>
          )}

          </div><div role="tabpanel" id="analytics-panel-2" aria-labelledby="analytics-tab-2" hidden={tab !== 2} tabIndex={0}>
          {/* QUIZ SCORE TRACKING */}

          {quizScores && (
            <section
              aria-labelledby="quiz-score-overview"
              style={{
                marginTop: "28px",
              }}
            >
              <div
                style={{
                  marginBottom: "20px",
                }}
              >
                <h2 id="quiz-score-overview">
                  Quiz Score Tracking
                </h2>
                <p>
                  Track completed comprehension quiz
                  results using actual M6 assessment
                  records. Scores represent first-attempt
                  performance.
                </p>
              </div>

              <div style={gridStyle}>
                {quizMetrics.map((metric) => (
                  <MetricCard
                    key={metric.label}
                    metric={metric}
                  />
                ))}
              </div>

              <AssessmentSourceNote
                classroomFiltered={Boolean(scope.roomId)}
                independentCount={quizScores.independentQuizzes}
              />

              {quizScores.totalCompletedQuizzes === 0 ? (
                <div
                  className="m3-empty-state"
                  style={{
                    marginTop: "24px",
                  }}
                >
                  <ClipboardList size={36} />
                  <h2>
                    No completed quiz scores yet
                  </h2>
                  <p>
                    Quiz scores will appear here
                    when students complete their
                    comprehension assessments.
                  </p>
                </div>
              ) : (
                <div
                  style={{
                    display: "grid",
                    gap: "20px",
                    marginTop: "24px",
                  }}
                >
                  {quizScores.students.map(
                    (student) => (
                      <article
                        key={student.studentId}
                        style={cardStyle}
                      >
                        <div>
                          <h3
                            style={{
                              color: "#173d35",
                              margin: "0 0 8px",
                            }}
                          >
                            {student.studentName}
                          </h3>

                          <p
                            style={{
                              color: "#64748b",
                              fontSize: "13px",
                              margin: 0,
                            }}
                          >
                            Individual comprehension
                            quiz performance
                          </p>
                        </div>

                        <div style={gridStyle}>
                          <MetricCard
                            metric={{
                              label:
                                "Completed Quizzes",
                              value: formatNumber(
                                student.completedQuizzes
                              ),
                              description:
                                "Completed comprehension assessments",
                              icon: ClipboardList,
                            }}
                          />

                          <MetricCard
                            metric={{
                              label:
                                "Average Quiz Score",
                              value: formatPercentage(
                                student.averageScore
                              ),
                              description:
                                "Average first-attempt percentage",
                              icon: Target,
                            }}
                          />

                          <MetricCard
                            metric={{
                              label:
                                "Highest Quiz Score",
                              value: formatPercentage(
                                student.highestScore
                              ),
                              description:
                                "Highest recorded score",
                              icon: Award,
                            }}
                          />

                          <MetricCard
                            metric={{
                              label:
                                "Lowest Quiz Score",
                              value: formatPercentage(
                                student.lowestScore
                              ),
                              description:
                                "Lowest recorded score",
                              icon: Activity,
                            }}
                          />
                        </div>

                        <div>
                          <h4
                            style={{
                              margin: "0 0 14px",
                              color: "#173d35",
                            }}
                          >
                            Quiz Score History
                          </h4>

                          <div
                            style={{
                              overflowX: "auto",
                              borderRadius: "12px",
                              border:
                                "1px solid #e2e8f0",
                            }}
                          >
                            <table
                              style={{
                                width: "100%",
                                borderCollapse:
                                  "collapse",
                                textAlign: "left",
                                fontSize: "14px",
                              }}
                            >
                              <thead
                                style={{
                                  backgroundColor:
                                    "#f1f5f9",
                                  color: "#173d35",
                                }}
                              >
                                <tr>
                                  {[
                                    "Reading Module",
                                    "Source",
                                    "Completed",
                                    "Correct",
                                    "Score",
                                    "Hints Used",
                                  ].map((heading) => (
                                    <th
                                      key={heading}
                                      scope="col"
                                      style={{
                                        padding:
                                          "14px",
                                        whiteSpace:
                                          "nowrap",
                                      }}
                                    >
                                      {heading}
                                    </th>
                                  ))}
                                </tr>
                              </thead>

                              <tbody>
                                {student.scores.map(
                                  (score) => (
                                    <tr
                                      key={
                                        score.attemptId
                                      }
                                      style={{
                                        borderTop:
                                          "1px solid #e2e8f0",
                                      }}
                                    >
                                      <td
                                        style={{
                                          padding:
                                            "14px",
                                        }}
                                      >
                                        {
                                          score.moduleTitle
                                        }
                                      </td>

                                      <td
                                        style={{
                                          padding:
                                            "14px",
                                        }}
                                      >
                                        <span className="m7-classification">
                                          {assessmentSourceLabel(
                                            score,
                                            rooms
                                          )}
                                        </span>
                                      </td>

                                      <td
                                        style={{
                                          padding:
                                            "14px",
                                          whiteSpace:
                                            "nowrap",
                                        }}
                                      >
                                        {formatDate(
                                          score.completedAt
                                        )}
                                      </td>

                                      <td
                                        style={{
                                          padding:
                                            "14px",
                                        }}
                                      >
                                        {
                                          score.correctAnswers
                                        }
                                        /
                                        {
                                          score.totalQuestions
                                        }
                                      </td>

                                      <td
                                        style={{
                                          padding:
                                            "14px",
                                          fontWeight:
                                            700,
                                          color:
                                            "#164b40",
                                        }}
                                      >
                                        {formatPercentage(
                                          score.scorePercentage
                                        )}
                                      </td>

                                      <td
                                        style={{
                                          padding:
                                            "14px",
                                        }}
                                      >
                                        {
                                          score.hintsUsed
                                        }
                                      </td>
                                    </tr>
                                  )
                                )}
                              </tbody>
                            </table>
                          </div>
                        </div>

                        <p
                          style={{
                            color: "#64748b",
                            fontSize: "12px",
                            margin: 0,
                          }}
                        >
                          Quiz scores are calculated
                          from completed comprehension
                          assessments only. Each score
                          reflects correct answers on
                          the first attempt; hints and
                          subsequent corrections do
                          not increase that score.
                        </p>
                      </article>
                    )
                  )}
                </div>
              )}
            </section>
          )}

          </div>
        </>
      )}
      <WeeklyReportSection />
      </div>
    </div>
  );
}
