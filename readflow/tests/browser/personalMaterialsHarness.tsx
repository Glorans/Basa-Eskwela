import React, { useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import MaterialDetailPage from '../../src/modules/module3/pages/MaterialDetailPage';
import MaterialLibraryPage from '../../src/modules/module3/pages/MaterialLibraryPage';
import PersonalQuestionPreviewPage from '../../src/modules/module3/pages/PersonalQuestionPreviewPage';
import ReadAloudPage from '../../src/pages/reading-activity/ReadAloudPage';
import ComprehensionPage from '../../src/modules/module6/pages/ComprehensionPage';
import { deleteMaterial, getMaterials } from '../../src/modules/module3/services/materialService';
import type { UploadedMaterial } from '../../src/modules/module3/types/content';
import '../../src/index.css';
import '../../src/modules/module3/styles/module3.css';
const owner='00000000-0000-4000-8000-000000000002';
const materialId='00000000-0000-4000-8000-000000000500';
export default function useAuthenticatedProfile(){return {profile:{id:owner,role:'general_user'}};}
const fixtureMaterial={id:materialId,uploadedById:owner,title:'My personal story',fileType:'PDF',language:'English',languageCode:'en',processingStatus:'completed',originalFilename:'story.pdf',fileSizeLabel:'2 KB',uploaderName:'Independent Learner',uploadedAt:'2026-11-11',contentText:'Ana reeds a book. She shares the book with her friend.'} as unknown as UploadedMaterial;
// The list, Move to Trash and Restore go through the real routes and SQL (in-memory database); removals are also recorded.
(window as unknown as {removedMaterials:string[]}).removedMaterials=[];
let materials:UploadedMaterial[]=[fixtureMaterial];
const listeners=new Set<()=>void>();
const subscribe=(listener:()=>void)=>{listeners.add(listener);return ()=>{listeners.delete(listener);};};
const set=(next:UploadedMaterial[])=>{materials=next;listeners.forEach(l=>l());};
const refreshMaterials=async()=>{set((await getMaterials()).map(m=>({...fixtureMaterial,...m,fileType:fixtureMaterial.fileType,language:fixtureMaterial.language,languageCode:fixtureMaterial.languageCode})));};
const removeMaterial=async(id:string)=>{await deleteMaterial(id);(window as unknown as {removedMaterials:string[]}).removedMaterials.push(id);set(materials.filter(m=>m.id!==id));};
const getMaterial=(id?:string)=>materials.find(m=>m.id===id);
void refreshMaterials();
export const useM3Content=()=>{const list=useSyncExternalStore(subscribe,()=>materials);
 return {materialsLoading:false,materialsError:'',materials:list,refreshMaterials,getMaterial:(id?:string)=>list.find(m=>m.id===id)??getMaterial(id),removeMaterial};};
createRoot(document.getElementById('root')!).render(<BrowserRouter><main style={{maxWidth:1100,margin:'24px auto',padding:16}}><Routes>
 <Route path="/m3/general/materials" element={<MaterialLibraryPage role="general_user"/>}/>
 <Route path="/m3/general/materials/:materialId" element={<MaterialDetailPage role="general_user"/>}/>
 <Route path="/m3/general/materials/:materialId/questions" element={<PersonalQuestionPreviewPage/>}/>
 <Route path="/m3/general/materials/:materialId/read-aloud" element={<ReadAloudPage role="general_user"/>}/>
 <Route path="/m3/general/materials/:materialId/comprehension" element={<ComprehensionPage role="general_user"/>}/>
 <Route path="/m3/general/comprehension/:attemptId" element={<ComprehensionPage role="general_user"/>}/>
</Routes></main></BrowserRouter>);
