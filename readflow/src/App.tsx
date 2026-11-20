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
import CreateSchoolAdminPage from "./modules/module1/pages/admin/CreateSchoolAdminPage";
import { DIAGNOSTIC_LEARNER_ROLES } from "./modules/module1/utils/authOnboarding";

import {
  DiagnosticFlow,
  DiagnosticLanguageRoute,
} from "./modules/module2/components/DiagnosticRoutes";
import DiagnosticStartPage from "./modules/module2/pages/DiagnosticStartPage";
import InitialDiagnosticGuard from "./modules/module2/components/InitialDiagnosticGuard";
import { PracticeDiagnosticFlow, PracticeDiagnosticLanguageRoute, PracticeVersionRoute } from "./modules/module2/components/PracticeDiagnosticRoutes";
import PracticeStartPage from "./modules/module2/pages/PracticeStartPage";
import { PRACTICE_STAFF_ROLES } from "./modules/module2/utils/practiceMode";

import BasaLayout from "./components/basa/BasaLayout";
import RequireAuth, { RequireRole } from "./components/auth/RequireAuth";

import StudentDashboard from "./pages/StudentDashboard";
import AdminDashboard from "./pages/dashboard/AdminDashboard";
import TeacherDashboard from "./pages/dashboard/TeacherDashboard";
import IndependentLearnerDashboard from "./pages/dashboard/IndependentLearnerDashboard";
import MyMaterials from "./pages/MyMaterials";
import StudentModuleViewPage from "./pages/StudentModuleViewPage";
import Leaderboard from "./pages/Leaderboard";
import IndependentLeaderboard from "./pages/IndependentLeaderboard";
import MyBadges from "./pages/MyBadges";
import AdminDiagnosticResultsPage from "./pages/admin/AdminDiagnosticResultsPage";
import DiagnosticHistoryPage from "./modules/module2/pages/DiagnosticHistoryPage";
import TeacherDiagnosticResultsPage from "./modules/module2/pages/TeacherDiagnosticResultsPage";
import AssessmentPackagesPage from "./modules/module2/pages/AssessmentPackagesPage";
import AssessmentPackageDetailPage from "./modules/module2/pages/AssessmentPackageDetailPage";
import ReassessmentAssignmentsPage from "./modules/module2/pages/ReassessmentAssignmentsPage";
import StudentReassessmentsPage from "./modules/module2/pages/StudentReassessmentsPage";
import { ReassessmentFlow, ReassessmentStepRoute } from "./modules/module2/components/ReassessmentRoutes";
import { REASSESSMENT_LEARNER_ROLES } from "./modules/module2/utils/reassessmentPaths";

import M3Layout from "./modules/module3/components/M3Layout";
import Module3Page from "./modules/module3/pages/Module3Page";
import ModuleCatalogPage from "./modules/module3/pages/ModuleCatalogPage";
import MaterialLibraryPage from "./modules/module3/pages/MaterialLibraryPage";
import ModuleFormPage from "./modules/module3/pages/ModuleFormPage";
import ModuleDetailPage from "./modules/module3/pages/ModuleDetailPage";
import UploadMaterialPage from "./modules/module3/pages/UploadMaterialPage";
import MaterialDetailPage from "./modules/module3/pages/MaterialDetailPage";
import QuestionReviewPage from "./modules/module3/pages/QuestionReviewPage";
import PersonalQuestionPreviewPage from "./modules/module3/pages/PersonalQuestionPreviewPage";
import { M3ContentProvider } from "./modules/module3/context/M3ContentContext";

import LearningRoomsPage from "./modules/module4/pages/LearningRoomsPage";
import ClassroomDetailsPage from "./modules/module4/pages/ClassroomDetailsPage";
import ArchivedClassroomsPage from "./modules/module4/pages/ArchivedClassroomsPage";
import ArchivedReadingsSection from "./modules/module4/components/ArchivedReadingsSection";
import JoinClassroomPage from "./modules/module4/pages/JoinClassroomPage";
import StudentArchivedRoomsPage from "./modules/module4/pages/StudentArchivedRoomsPage";
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
import { SystemAdminLearnerPerformancePage, SystemAdminOverviewPage } from "./modules/module7/SystemAdminAnalyticsPage";

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

      {/* M2 F8 - Complete Reassessment: the learner's own assignment (Student: classroom; Independent Learner: self-started), full screen. */}
      <Route element={<RequireRole allowedRoles={[...REASSESSMENT_LEARNER_ROLES]} />}>
        <Route element={<ReassessmentFlow />}>
          <Route path="/reassessments/:assignmentId/:language/reading" element={<ReassessmentStepRoute step="reading" />} />
          <Route path="/reassessments/:assignmentId/:language/questions" element={<ReassessmentStepRoute step="questions" />} />
          <Route path="/reassessments/:assignmentId/:language/result" element={<ReassessmentStepRoute step="result" />} />
        </Route>
      </Route>

      {/* M2 F7 - Preview / Try Assessment: staff Practice Mode. Scored by the server, never saved. */}
      <Route element={<RequireRole allowedRoles={[...PRACTICE_STAFF_ROLES]} />}>
        <Route element={<PracticeDiagnosticFlow />}>
          <Route path="/practice/diagnostic" element={<PracticeStartPage />} />
          <Route path="/practice/diagnostic/:language/reading" element={<PracticeDiagnosticLanguageRoute step="reading" />} />
          <Route path="/practice/diagnostic/:language/questions" element={<PracticeDiagnosticLanguageRoute step="questions" />} />
          <Route path="/practice/diagnostic/:language/result" element={<PracticeDiagnosticLanguageRoute step="result" />} />
          {/* One authored Initial Diagnostic version (System Admin; the server checks access and version status). */}
          <Route path="/practice/diagnostic/version/:versionId/:language/reading" element={<PracticeVersionRoute step="reading" />} />
          <Route path="/practice/diagnostic/version/:versionId/:language/questions" element={<PracticeVersionRoute step="questions" />} />
          <Route path="/practice/diagnostic/version/:versionId/:language/result" element={<PracticeVersionRoute step="result" />} />
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
            {/* M2 F3 - own diagnostic results and history */}
            <Route path="assessment-history" element={<DiagnosticHistoryPage />} />
            {/* M2 F8 - reassessments assigned by the Student's teacher */}
            <Route path="reassessments" element={<StudentReassessmentsPage />} />

            <Route
              path="join-classroom"
              element={<JoinClassroomPage />}
            />

            <Route
              path="archived-learning-rooms"
              element={<StudentArchivedRoomsPage />}
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

        {/* System Admin: account management and the shared M3 content workspace. */}
        <Route element={<RequireRole allowedRoles={["system_admin"]} />}>
          <Route path="/system-admin" element={<M3Layout role="system_admin" />}>
            <Route index element={<Navigate to="users" replace />} />
            <Route path="users" element={<UserManagementPage />} />
            <Route path="school-admins/new" element={<CreateSchoolAdminPage />} />
            <Route path="analytics" element={<SystemAdminOverviewPage />} />
            <Route path="independent-learners" element={<SystemAdminLearnerPerformancePage />} />
            {/* M2 F6 + F10 - initial diagnostic and Independent Learner reassessment packages */}
            <Route path="assessment-packages" element={<AssessmentPackagesPage role="system_admin" />} />
            <Route path="assessment/initial" element={<AssessmentPackagesPage key="initial" role="system_admin" section="initial" />} />
            <Route path="assessment/reassessment" element={<AssessmentPackagesPage key="reassessment" role="system_admin" section="independent" />} />
            <Route path="assessment-packages/:packageId" element={<AssessmentPackageDetailPage role="system_admin" />} />
            <Route path="content" element={<Module3Page workspace="system_admin" />} />
            <Route path="content/modules/new" element={<ModuleFormPage mode="create" workspace="system_admin" />} />
            <Route path="content/modules/:moduleId" element={<ModuleFormPage mode="detail" workspace="system_admin" />} />
            <Route path="content/modules/:moduleId/edit" element={<ModuleFormPage mode="edit" workspace="system_admin" />} />
            <Route path="content/materials" element={<MaterialLibraryPage role="system_admin" />} />
            <Route path="content/materials/upload" element={<UploadMaterialPage role="system_admin" />} />
            <Route path="content/materials/:materialId" element={<MaterialDetailPage role="system_admin" />} />
            <Route path="content/materials/:materialId/questions" element={<MaterialDetailPage role="system_admin" />} />
            <Route path="content/materials/:materialId/question-sets/:setId" element={<QuestionReviewPage role="system_admin" />} />
            <Route path="content/materials/:materialId/question-sets/:setId/edit" element={<QuestionReviewPage role="system_admin" editing />} />
            <Route path="settings" element={<Settings />} />
          </Route>
        </Route>

        {/* Admin (School Admin) routes */}
        <Route element={<RequireRole allowedRoles={["admin"]} />}>
          <Route
            path="/m3/admin"
            element={<M3Layout role="admin" />}
          >
            <Route index element={<Module3Page />} />
            <Route path="dashboard" element={<AdminDashboard />} />

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
            {/* M2 F10 - school reassessment packages and review of Teacher packages */}
            <Route path="assessment-packages" element={<AssessmentPackagesPage role="admin" />} />
            <Route path="assessment-packages/:packageId" element={<AssessmentPackageDetailPage role="admin" />} />
            {/* M2 F9 - assign classroom reassessments (single-school pilot) */}
            <Route path="reassessment-assignments" element={<ReassessmentAssignmentsPage role="admin" />} />

            <Route
              path="learning-rooms"
              element={<AdminLearningRoomsPage />}
            />

            <Route
              path="learning-rooms/:roomId"
              element={<AdminClassroomDetailsPage />}
            />

            {/* M4 Admin management: the Teacher classroom page in Admin mode (audited database functions). */}
            <Route
              path="learning-rooms/:roomId/manage"
              element={<ClassroomDetailsPage workspace="admin" />}
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
            <Route path="dashboard" element={<TeacherDashboard />} />

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

            {/* M5/M6 - approved-Teacher reading practice on published catalog modules; own results only.
                Kept apart from the Teacher's review of Students' saved assessments (oral-reading above). */}
            <Route path="practice" element={<AdminOralReadingPage role="teacher" />} />
            <Route
              path="practice/modules/:moduleId/read-aloud"
              element={<ReadAloudPage role="teacher" />}
            />
            <Route
              path="practice/read-aloud/results/:attemptId"
              element={<ReadingResultPage role="teacher" />}
            />
            <Route
              path="practice/modules/:moduleId/comprehension"
              element={<ComprehensionPage role="teacher" />}
            />
            <Route
              path="practice/comprehension/:attemptId"
              element={<ComprehensionPage role="teacher" />}
            />
            <Route
              path="practice/history"
              element={<ReadingHistoryPage role="teacher" />}
            />

            <Route path="student-support" element={<TeacherSupportPage />} />
            {/* M2 F3 - diagnostic results of Students enrolled in this Teacher's Learning Rooms */}
            <Route path="diagnostic-results" element={<TeacherDiagnosticResultsPage />} />
            {/* M2 F10 - the Teacher's own private reassessment packages */}
            <Route path="assessment-packages" element={<AssessmentPackagesPage role="teacher" />} />
            <Route path="assessment-packages/:packageId" element={<AssessmentPackageDetailPage role="teacher" />} />
            {/* M2 F9 - assign the Teacher's own reassessment packages in own active rooms */}
            <Route path="reassessment-assignments" element={<ReassessmentAssignmentsPage role="teacher" />} />
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
            <Route path="dashboard" element={<IndependentLearnerDashboard />} />

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
            {/* Independent Learner: read-only preview of the private questions (no answers; never starts an assessment). */}
            <Route path="materials/:materialId/questions" element={<PersonalQuestionPreviewPage />} />
            <Route path="materials/:materialId/read-aloud" element={<ReadAloudPage role="general_user" />} />
            <Route path="materials/:materialId/comprehension" element={<ComprehensionPage role="general_user" />} />

            <Route
              path="leaderboard"
              element={<IndependentLeaderboard />}
            />

            {/* M7 - personal learning progress (own records only) */}
            <Route
              path="progress"
              element={<StudentProgressPage role="general_user" />}
            />
            {/* M2 F3 - own diagnostic results and history */}
            <Route path="assessment-history" element={<DiagnosticHistoryPage />} />
            {/* M2 F8 - Independent Learner reassessments (centrally approved packages, self-started) */}
            <Route path="reassessments" element={<StudentReassessmentsPage audience="independent" />} />

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
