import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, Link } from "react-router-dom";
import UploadMaterialPage from "../../../src/modules/module3/pages/UploadMaterialPage";
import MaterialDetailPage from "../../../src/modules/module3/pages/MaterialDetailPage";
import MaterialLibraryPage from "../../../src/modules/module3/pages/MaterialLibraryPage";
import QuestionReviewPage from "../../../src/modules/module3/pages/QuestionReviewPage";
import { getMaterials } from "../../../src/modules/module3/services/materialService";
import "../../../src/index.css";
import "../../../src/modules/module3/styles/module3.css";
export const teacherId = "11111111-1111-4111-8111-111111111111";
const Context = createContext<any>(null);
export const useM3Content = () => useContext(Context);
export default function useAuthenticatedProfile() { return { profile: { id: teacherId, role: "teacher" } }; }
export const supabase = { auth: { getSession: async () => ({ data: { session: sessionStorage.getItem("fixture-session") ? { access_token: "fixture-teacher" } : null }, error: null }), getUser: async () => ({data:{user:{id:teacherId}},error:null}) },
  storage: { from: () => ({
    upload: async (key: string, file: File, options: {contentType: string}) => {
      const response = await fetch("/fixture-storage/"+key,{method:"PUT",headers:{"Content-Type":options.contentType},body:file});
      return {error: response.ok ? null : new Error("Fixture storage failed")};
    },
    remove: async () => ({error:null}),
  }) },
};
function App() {
  const [signedIn, setSignedIn] = useState(!!sessionStorage.getItem("fixture-session"));
  const [materials, setMaterials] = useState<any[]>([]);
  const [materialsLoading, setLoading] = useState(true);
  const [materialsError, setError] = useState("");
  const refreshMaterials = useCallback(async () => {
    setLoading(true);
    try { setMaterials(await getMaterials()); } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { if (signedIn) void refreshMaterials(); }, [signedIn, refreshMaterials]);
  if (!signedIn) return <button onClick={() => { sessionStorage.setItem("fixture-session", "yes"); setSignedIn(true); }}>Sign in as fixture Teacher</button>;
  return <Context.Provider value={{ materials, materialsLoading, materialsError, refreshMaterials, getMaterial: (id: string) => materials.find(m => m.id === id) }}>
    <nav><Link to="/m3/teacher/materials">Materials</Link> <button onClick={() => { sessionStorage.removeItem("fixture-session"); setMaterials([]); setSignedIn(false); }}>Sign out</button></nav>
    <main style={{ maxWidth: 1000, margin: "24px auto", padding: 16 }}>
    <Routes>
      <Route path="/m3/teacher/materials/upload" element={<UploadMaterialPage role="teacher" />} />
      <Route path="/m3/teacher/materials" element={<MaterialLibraryPage role="teacher" />} />
      <Route path="/m3/teacher/materials/:materialId" element={<MaterialDetailPage role="teacher" />} />
      <Route path="/m3/teacher/materials/:materialId/question-sets/:setId" element={<QuestionReviewPage role="teacher" />} />
      <Route path="/m3/teacher/materials/:materialId/question-sets/:setId/edit" element={<QuestionReviewPage role="teacher" editing />} />
    </Routes></main>
  </Context.Provider>;
}
createRoot(document.getElementById("root")!).render(<BrowserRouter><App /></BrowserRouter>);
