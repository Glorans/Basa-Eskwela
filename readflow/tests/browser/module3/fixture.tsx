import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import MyMaterials from '../../../src/pages/MyMaterials';
import StudentDashboard from '../../../src/pages/StudentDashboard';
import '../../../src/index.css';
createRoot(document.getElementById('root')!).render(<BrowserRouter><main style={{maxWidth:1200, margin:'auto', padding:20}}>
  {location.pathname.startsWith('/dashboard') ? <StudentDashboard /> : <MyMaterials />}
</main></BrowserRouter>);
