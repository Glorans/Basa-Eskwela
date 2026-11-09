import { Navigate, Outlet, Route, Routes } from "react-router-dom";

import LandingPage from "./pages/LandingPage";

import ForgotPasswordPage from "./modules/module1/pages/ForgotPasswordPage";
import LoginPage from "./modules/module1/pages/LoginPage";
import ResetPasswordPage from "./modules/module1/pages/ResetPasswordPage";
import SignupPage from "./modules/module1/pages/SignupPage";
import RoleSelectionPage from "./modules/module1/pages/RoleSelectionPage";
import ProfileSetupPage from "./modules/module1/pages/ProfileSetupPage";
import TeacherVerificationPage from "./modules/module1/pages/TeacherVerificationPage";
import Settings from "./modules/module1/pages/Settings";
import UserManagementPage from "./modules/module1/pages/admin/UserManagementPage";
import TeacherInvitationsPage from "./modules/module1/pages/admin/TeacherInvitationsPage";
import { DIAGNOSTIC_LEARNER_ROLES } from "./modules/module1/utils/authOnboarding";

import {
  DiagnosticFlow,
  DiagnosticLanguageRoute,
} from "./modules/module2/components/DiagnosticRoutes";
import DiagnosticStartPage from "./modules/module2/pages/DiagnosticStartPage";
import InitialDiagnosticGuard from "./modules/module2/components/InitialDiagnosticGuard";

import BasaLayout from "./components/basa/BasaLayout";
import RequireAuth, { RequireRole } from "./components/auth/RequireAuth";

import StudentDashboard from "./pages/StudentDashboard";
import MyMaterials from "./pages/MyMaterials";
import StudentModuleViewPage from "./pages/StudentModuleViewPage";
import Leaderboard from "./pages/Leaderboard";
import IndependentLeaderboard from "./pages/IndependentLeaderboard";
import MyBadges from "./pages/MyBadges";
import AdminDiagnosticResultsPage from "./pages/admin/AdminDiagnosticResultsPage";

import M3Layout from "./modules/module3/components/M3Layout";
import Module3Page from "./modules/module3/pages/Module3Page";
import ModuleCatalogPage from "./modules/module3/pages/ModuleCatalogPage";
import MaterialLibraryPage from "./modules/module3/pages/MaterialLibraryPage";
import ModuleFormPage from "./modules/module3/pages/ModuleFormPage";
import ModuleDetailPage from "./modules/module3/pages/ModuleDetailPage";
import UploadMaterialPage from "./modules/module3/pages/UploadMaterialPage";
import MaterialDetailPage from "./modules/module3/pages/MaterialDetailPage";
import QuestionReviewPage from "./modules/module3/pages/QuestionReviewPage";
import { M3ContentProvider } from "./modules/module3/context/M3ContentContext";

import LearningRoomsPage from "./modules/module4/pages/LearningRoomsPage";
import ClassroomDetailsPage from "./modules/module4/pages/ClassroomDetailsPage";
import ArchivedClassroomsPage from "./modules/module4/pages/ArchivedClassroomsPage";
import ArchivedReadingsSection from "./modules/module4/components/ArchivedReadingsSection";
import JoinClassroomPage from "./modules/module4/pages/JoinClassroomPage";
import StudentClassroomPage from "./modules/module4/pages/StudentClassroomPage";
import StudentReadingActivityPage from "./modules/module4/pages/StudentReadingActivityPage";
import AdminLearningRoomsPage from "./modules/module4/pages/AdminLearningRoomsPage";
import AdminClassroomDetailsPage from "./modules/module4/pages/AdminClassroomDetailsPage";

import ReadAloudPage from "./pages/reading-activity/ReadAloudPage";
import ReadingResultPage from "./pages/reading-activity/ReadingResultPage";
import AdminOralReadingPage from "./modules/module5/pages/AdminOralReadingPage";
import AdminStudentReadingAssessmentsPage from "./modules/module5/pages/AdminStudentReadingAssessmentsPage";
import ReadingHistoryPage from "./modules/module5/pages/ReadingHistoryPage";
import TeacherOralReadingResultsPage from "./modules/module5/pages/TeacherOralReadingResultsPage";
import TeacherOralReadingAttemptPage from "./modules/module5/pages/TeacherOralReadingAttemptPage";

import ComprehensionPage from "./modules/module6/pages/ComprehensionPage";
import TeacherAnalyticsPage from "./modules/module7/TeacherAnalyticsPage";
import TeacherReportsPage from "./modules/module7/TeacherReportsPage";
import { StudentProgressPage, AdminAnalyticsPage, TeacherSupportPage } from "./modules/module7/M7Pages";
import AdminStudentPerformancePage from "./modules/module7/AdminStudentPerformancePage";
import AdminReportsPage from "./modules/module7/AdminReportsPage";

function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />

      <Route
        path="/forgot-password"
        element={<ForgotPasswordPage />}
      />

      <Route
        path="/verification"
        element={<Navigate to="/forgot-password" replace />}
      />

      <Route
        path="/reset-password"
        element={<ResetPasswordPage />}
      />

      <Route element={<RequireAuth allowUnassignedRole />}>
        <Route
          path="/teacher-verification"
          element={<TeacherVerificationPage />}
        />
        <Route
          path="/select-role"
          element={<RoleSelectionPage />}
        />
      </Route>

      <Route
        element={
          <RequireRole
            allowedRoles={["teacher", "student", "general_user"]}
          />
        }
      >
        <Route
          path="/setup-profile"
          element={<ProfileSetupPage />}
        />
      </Route>

      <Route
        element={
          <RequireRole allowedRoles={DIAGNOSTIC_LEARNER_ROLES} />
        }
      >
        <Route element={<DiagnosticFlow />}>
          <Route element={<InitialDiagnosticGuard />}>
            <Route
              path="/diagnostic"
              element={<DiagnosticStartPage />}
            />

            <Route
              path="/diagnostic/:language/reading"
              element={<DiagnosticLanguageRoute step="reading" />}
            />

            <Route
              path="/diagnostic/:language/questions"
              element={<DiagnosticLanguageRoute step="questions" />}
            />
          </Route>

          <Route
            path="/diagnostic/:language/result"
            element={<DiagnosticLanguageRoute step="result" />}
          />

          <Route
            path="/diagnostic/reading"
            element={
              <Navigate to="/diagnostic/en/reading" replace />
            }
          />

          <Route
            path="/diagnostic/questions"
            element={
              <Navigate to="/diagnostic/en/questions" replace />
            }
          />

          <Route
            path="/diagnostic/result"
            element={
              <Navigate to="/diagnostic/en/result" replace />
            }
          />
        </Route>
      </Route>

      <Route
        element={
          <M3ContentProvider>
            <Outlet />
          </M3ContentProvider>
        }
      >
        {/* Student routes */}
        <Route element={<RequireRole allowedRoles={["student"]} />}>
          <Route path="/dashboard" element={<BasaLayout />}>
            <Route index element={<StudentDashboard />} />
            <Route path="progress" element={<StudentProgressPage />} />

            <Route
              path="join-classroom"
              element={<JoinClassroomPage />}
            />

            <Route
              path="learning-rooms/:roomId"
              element={<StudentClassroomPage />}
            />

            <Route
              path="learning-rooms/:roomId/reading-activities/:materialId"
              element={<StudentReadingActivityPage />}
            />

            <Route
              path="materials"
              element={<MyMaterials />}
            />

            <Route
              path="materials/:moduleId"
              element={<StudentModuleViewPage />}
            />

            <Route
              path="reading-materials/:materialId/read-aloud"
              element={<ReadAloudPage role="student" />}
            />

            <Route
              path="reading-materials/:materialId/comprehension"
              element={<ComprehensionPage role="student" />}
            />

            <Route
              path="materials/:moduleId/read-aloud"
              element={<ReadAloudPage role="student" />}
            />

            <Route
              path="materials/:moduleId/comprehension"
              element={<ComprehensionPage role="student" />}
            />

            <Route
              path="comprehension/:attemptId"
              element={<ComprehensionPage role="student" />}
            />

            <Route
              path="comprehension/:attemptId/results"
              element={<ComprehensionPage role="student" results />}
            />

            <Route
              path="reading-history"
              element={<><ReadingHistoryPage role="student" /><ArchivedReadingsSection /></>}
            />

            <Route
              path="read-aloud/results/:attemptId"
              element={<ReadingResultPage role="student" />}
            />

            <Route
              path="leaderboard"
              element={<Leaderboard />}
            />

            <Route
              path="badges"
              element={<MyBadges />}
            />

            <Route
              path="settings"
              element={<Settings />}
            />
          </Route>
        </Route>

        {/* Admin routes */}
        <Route element={<RequireRole allowedRoles={["admin"]} />}>
          <Route
            path="/m3/admin"
            element={<M3Layout role="admin" />}
          >
            <Route index element={<Module3Page />} />

            <Route
              path="modules/new"
              element={<ModuleFormPage mode="create" />}
            />

            <Route
              path="modules/:moduleId"
              element={<ModuleDetailPage role="admin" />}
            />

            <Route
              path="modules/:moduleId/edit"
              element={<ModuleFormPage mode="edit" />}
            />

            <Route
              path="materials/:materialId"
              element={<MaterialDetailPage role="admin" />}
            />

            <Route
              path="materials/:materialId/questions"
              element={<MaterialDetailPage role="admin" />}
            />

            <Route
              path="materials/:materialId/question-sets/:setId"
              element={<QuestionReviewPage role="admin" />}
            />

            <Route
              path="materials/:materialId/question-sets/:setId/edit"
              element={<QuestionReviewPage role="admin" editing />}
            />

            <Route
              path="settings"
              element={<Settings />}
            />
          </Route>

          <Route
            path="/admin"
            element={<M3Layout role="admin" />}
          >
            <Route
              index
              element={<Navigate to="users" replace />}
            />

            <Route
              path="users"
              element={<UserManagementPage />}
            />
            <Route path="teacher-invitations" element={<TeacherInvitationsPage />} />

            <Route path="analytics" element={<AdminAnalyticsPage />} />
            {/* M7 - Admin student performance, competency, interventions and weekly reports (Admin-only API) */}
            <Route path="student-performance" element={<AdminStudentPerformancePage />} />
            <Route path="reports" element={<AdminReportsPage />} />

            {/* M5 - admin self-practice; results stay private to the admin's own account */}
            <Route path="oral-reading" element={<AdminOralReadingPage />} />
            <Route
              path="oral-reading/modules/:moduleId/read-aloud"
              element={<ReadAloudPage role="admin" />}
            />
            <Route
              path="read-aloud/results/:attemptId"
              element={<ReadingResultPage role="admin" />}
            />
            {/* M6 - Admin comprehension practice on the Admin's own published modules; own results only */}
            <Route
              path="oral-reading/modules/:moduleId/comprehension"
              element={<ComprehensionPage role="admin" />}
            />
            <Route
              path="comprehension/:attemptId"
              element={<ComprehensionPage role="admin" />}
            />
            <Route
              path="reading-history"
              element={<ReadingHistoryPage role="admin" />}
            />
            {/* M5 F5/F7 - read-only review of students' saved assessments, kept apart from the Admin's own practice. */}
            <Route
              path="student-reading-assessments"
              element={<AdminStudentReadingAssessmentsPage />}
            />

            <Route
              path="diagnostic-results"
              element={<AdminDiagnosticResultsPage />}
            />

            <Route
              path="learning-rooms"
              element={<AdminLearningRoomsPage />}
            />

            <Route
              path="learning-rooms/:roomId"
              element={<AdminClassroomDetailsPage />}
            />
          </Route>
        </Route>

        {/* Teacher routes */}
        <Route element={<RequireRole allowedRoles={["teacher"]} />}>
          <Route
            path="/m3/teacher"
            element={<M3Layout role="teacher" />}
          >
            <Route
              index
              element={<Navigate to="materials" replace />}
            />

            <Route
              path="modules"
              element={<ModuleCatalogPage role="teacher" />}
            />

            <Route
              path="modules/:moduleId"
              element={<ModuleDetailPage role="teacher" />}
            />

            {/* M3 Teacher F1–F5: the Teacher's own reading modules (database-enforced ownership). */}
            <Route
              path="content"
              element={<Module3Page workspace="teacher" />}
            />

            <Route
              path="content/new"
              element={<ModuleFormPage mode="create" workspace="teacher" />}
            />

            <Route
              path="content/:moduleId"
              element={<ModuleFormPage mode="detail" workspace="teacher" />}
            />

            <Route
              path="content/:moduleId/edit"
              element={<ModuleFormPage mode="edit" workspace="teacher" />}
            />

            <Route
              path="materials"
              element={<MaterialLibraryPage role="teacher" />}
            />

            <Route
              path="materials/upload"
              element={<UploadMaterialPage role="teacher" />}
            />

            <Route
              path="materials/:materialId"
              element={<MaterialDetailPage role="teacher" />}
            />

            <Route
              path="materials/:materialId/questions"
              element={<MaterialDetailPage role="teacher" />}
            />

            <Route
              path="materials/:materialId/question-sets/:setId"
              element={<QuestionReviewPage role="teacher" />}
            />

            <Route
              path="materials/:materialId/question-sets/:setId/edit"
              element={<QuestionReviewPage role="teacher" editing />}
            />

            <Route
              path="oral-reading"
              element={<TeacherOralReadingResultsPage />}
            />

            <Route
              path="oral-reading/:attemptId"
              element={<TeacherOralReadingAttemptPage />}
            />

            <Route path="student-support" element={<TeacherSupportPage />} />
            <Route path="reports" element={<TeacherReportsPage />} />
            {/* M7 - Teacher Analytics */}
            <Route
              path="analytics"
              element={<TeacherAnalyticsPage />}
            />

            <Route
              path="learning-rooms"
              element={<LearningRoomsPage />}
            />

            <Route
              path="learning-rooms/:roomId"
              element={<ClassroomDetailsPage />}
            />

            <Route
              path="archived-classrooms"
              element={<ArchivedClassroomsPage />}
            />

            <Route
              path="settings"
              element={<Settings />}
            />
          </Route>
        </Route>

        {/* Independent learner routes */}
        <Route
          element={<RequireRole allowedRoles={["general_user"]} />}
        >
          <Route
            path="/m3/general"
            element={<M3Layout role="general_user" />}
          >
            <Route
              index
              element={<Navigate to="materials" replace />}
            />

            <Route
              path="modules"
              element={<ModuleCatalogPage role="general_user" />}
            />

            <Route
              path="modules/:moduleId"
              element={<ModuleDetailPage role="general_user" />}
            />

            <Route
              path="modules/:moduleId/read-aloud"
              element={<ReadAloudPage role="general_user" />}
            />

            <Route
              path="modules/:moduleId/comprehension"
              element={<ComprehensionPage role="general_user" />}
            />

            <Route
              path="comprehension/:attemptId"
              element={<ComprehensionPage role="general_user" />}
            />

            <Route
              path="reading-history"
              element={<ReadingHistoryPage role="general_user" />}
            />

            <Route
              path="read-aloud/results/:attemptId"
              element={<ReadingResultPage role="general_user" />}
            />

            <Route
              path="materials"
              element={<MaterialLibraryPage role="general_user" />}
            />

            <Route
              path="materials/upload"
              element={<UploadMaterialPage role="general_user" />}
            />

            <Route
              path="materials/:materialId"
              element={<MaterialDetailPage role="general_user" />}
            />

            <Route
              path="leaderboard"
              element={<IndependentLeaderboard />}
            />

            {/* M7 - personal learning progress (own records only) */}
            <Route
              path="progress"
              element={<StudentProgressPage role="general_user" />}
            />

            <Route
              path="badges"
              element={<MyBadges />}
            />

            <Route
              path="settings"
              element={<Settings />}
            />
          </Route>
        </Route>
      </Route>
    </Routes>
  );
}

export default App;
