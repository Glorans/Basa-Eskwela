import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import MyMaterials from '../../../src/pages/MyMaterials';
import StudentDashboard from '../../../src/pages/StudentDashboard';
import BasaLayout from '../../../src/components/basa/BasaLayout';
import '../../../src/index.css';
const page = location.pathname.startsWith('/dashboard') ? <StudentDashboard /> : <MyMaterials />;
// ?shell=1 renders the page inside the real learner shell (sidebar, header, content padding)
// so card widths match what learners actually see.
createRoot(document.getElementById('root')!).render(<BrowserRouter>
  {new URLSearchParams(location.search).has('shell')
    ? <Routes><Route element={<BasaLayout />}><Route path="*" element={page} /></Route></Routes>
    : <main style={{maxWidth:1200, margin:'auto', padding:20}}>{page}</main>}
</BrowserRouter>);
