import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import MaterialDetailPage from '../../src/modules/module3/pages/MaterialDetailPage';
import MaterialLibraryPage from '../../src/modules/module3/pages/MaterialLibraryPage';
import ReadAloudPage from '../../src/pages/reading-activity/ReadAloudPage';
import ComprehensionPage from '../../src/modules/module6/pages/ComprehensionPage';
import '../../src/index.css';
import '../../src/modules/module3/styles/module3.css';
const owner='00000000-0000-4000-8000-000000000002';
const materialId='00000000-0000-4000-8000-000000000500';
export default function useAuthenticatedProfile(){return {profile:{id:owner,role:'general_user'}};}
const fixtureMaterial={id:materialId,uploadedById:owner,title:'My personal story',fileType:'PDF',language:'English',languageCode:'en',processingStatus:'completed',originalFilename:'story.pdf',fileSizeLabel:'2 KB',uploaderName:'Independent Learner',uploadedAt:'2026-11-11',contentText:'Ana reads a book. She shares the book with her friend.'};
// Library removal is recorded (UI check); the server soft-delete path is covered by personalMaterialRoutes.test.js.
(window as unknown as {removedMaterials:string[]}).removedMaterials=[];
export const useM3Content=()=>({materialsLoading:false,materialsError:'',materials:[fixtureMaterial],refreshMaterials:async()=>{},getMaterial:()=>fixtureMaterial,
 removeMaterial:async(id:string)=>{(window as unknown as {removedMaterials:string[]}).removedMaterials.push(id);}});
createRoot(document.getElementById('root')!).render(<BrowserRouter><main style={{maxWidth:1100,margin:'24px auto',padding:16}}><Routes>
 <Route path="/m3/general/materials" element={<MaterialLibraryPage role="general_user"/>}/>
 <Route path="/m3/general/materials/:materialId" element={<MaterialDetailPage role="general_user"/>}/>
 <Route path="/m3/general/materials/:materialId/read-aloud" element={<ReadAloudPage role="general_user"/>}/>
 <Route path="/m3/general/materials/:materialId/comprehension" element={<ComprehensionPage role="general_user"/>}/>
 <Route path="/m3/general/comprehension/:attemptId" element={<ComprehensionPage role="general_user"/>}/>
</Routes></main></BrowserRouter>);
