// Local browser fixture for Student personal Read Aloud: real Student pages and M5 services, a stubbed
// M3 content context (catalog module detail) and profile. No production session or database.
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import StudentModuleViewPage from '../../src/pages/StudentModuleViewPage';
import ReadAloudPage from '../../src/pages/reading-activity/ReadAloudPage';
import ReadingResultPage from '../../src/pages/reading-activity/ReadingResultPage';
import ReadingHistoryPage from '../../src/modules/module5/pages/ReadingHistoryPage';
import ComprehensionPage from '../../src/modules/module6/pages/ComprehensionPage';
import '../../src/index.css';

const modules: Record<string, { title: string; passageId: string; text: string }> = {
  '00000000-0000-4000-8000-0000000000e1': { title: 'Early Start', passageId: '00000000-0000-4000-8000-0000000000f1', text: 'Ben runs fast to the park. He sees a red kite in the sky.' },
  '00000000-0000-4000-8000-0000000000e2': { title: 'English', passageId: '00000000-0000-4000-8000-0000000000f2', text: 'Ana reads a book. She shares the book with her friend.' },
  '00000000-0000-4000-8000-0000000000e3': { title: 'Ang Regalo', passageId: '00000000-0000-4000-8000-0000000000f3', text: 'Si Lea ay may regalo. Ibinigay niya ito sa kanyang lola.' },
};
// The signed-in Student follows ?as=<id> (kept for in-app navigation), so result ownership checks match.
const as = new URLSearchParams(location.search).get('as');
if (as) sessionStorage.setItem('fixtureStudent', as);
const profile = { id: sessionStorage.getItem('fixtureStudent') ?? 'student', role: 'student' };
const profileState = { profile, loading: false, failed: false };
export default function useAuthenticatedProfile() { return profileState; }
// Stable across renders, like the real context's useCallback (the page reloads when it changes).
const getStudentModule = async (id: string) => {
  const m = modules[id];
  return m && { id, title: m.title, learningPath: 'English Foundations', difficulty: 'Easy', language: 'en', status: 'published',
    passage: m.text, passages: [{ id: m.passageId, title: m.title, passageText: m.text, displayOrder: 1 }] };
};
const content = { getStudentModule };
export const useM3Content = () => content;

createRoot(document.getElementById('root')!).render(<BrowserRouter><main style={{ maxWidth: 1100, margin: '24px auto', padding: 16 }}><Routes>
  <Route path="/dashboard/materials/:moduleId" element={<StudentModuleViewPage role="student" />} />
  <Route path="/dashboard/materials/:moduleId/read-aloud" element={<ReadAloudPage role="student" />} />
  <Route path="/dashboard/read-aloud/results/:attemptId" element={<ReadingResultPage role="student" />} />
  <Route path="/dashboard/reading-history" element={<ReadingHistoryPage role="student" />} />
  <Route path="/dashboard/materials/:moduleId/comprehension" element={<ComprehensionPage role="student" />} />
  <Route path="/dashboard/comprehension/:attemptId" element={<ComprehensionPage role="student" />} />
  <Route path="/dashboard/comprehension/:attemptId/results" element={<ComprehensionPage role="student" results />} />
</Routes></main></BrowserRouter>);
