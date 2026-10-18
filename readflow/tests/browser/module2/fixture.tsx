
import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { DiagnosticFlow, DiagnosticLanguageRoute } from '/src/modules/module2/components/DiagnosticRoutes.tsx';
import InitialDiagnosticGuard from '/src/modules/module2/components/InitialDiagnosticGuard.tsx';
import Start from '/src/modules/module2/pages/DiagnosticStartPage.tsx';
import '/src/index.css';
window.review = { microphoneRequests:0, recorders:[], contexts:[], sockets:[], browserRecognitionStarts:0, saves:0, scoreAudits:[] };
const info=console.info.bind(console);
console.info=(label,...args)=>{if(label==='[M2 SCORE AUDIT]')review.scoreAudits.push(args[0]);info(label,...args)};
const gum=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
navigator.mediaDevices.getUserMedia=async (...args)=>{review.microphoneRequests++;return review.stream=await gum(...args)};
const Recorder=window.MediaRecorder;
window.MediaRecorder=class extends Recorder {constructor(...args){super(...args);review.recorders.push(this)}};
const Context=window.AudioContext;
window.AudioContext=class extends Context {constructor(...args){super(...args);review.contexts.push(this)}};
const Socket=window.WebSocket;
window.WebSocket=class extends Socket {constructor(...args){super(...args);review.sockets.push(this)}};
window.SpeechRecognition=class {start(){review.browserRecognitionStarts++} stop(){} abort(){}};
const timeout=window.setTimeout.bind(window);
window.setTimeout=(callback,ms,...args)=>{if(ms===300000)review.maximum=callback;return timeout(callback,ms,...args)};
const root=createRoot(document.getElementById('root')); review.unmount=()=>root.unmount();
root.render(<React.StrictMode><BrowserRouter><Routes><Route element={<DiagnosticFlow/>}>
<Route element={<InitialDiagnosticGuard/>}><Route path='/diagnostic' element={<Start/>}/><Route path='/diagnostic/:language/reading' element={<DiagnosticLanguageRoute step='reading'/>}/><Route path='/diagnostic/:language/questions' element={<DiagnosticLanguageRoute step='questions'/>}/></Route>
<Route path='/diagnostic/:language/result' element={<DiagnosticLanguageRoute step='result'/>}/>
</Route><Route path='/dashboard' element={<div>Dashboard</div>}/><Route path='*' element={<Navigate to='/diagnostic' replace/>}/></Routes></BrowserRouter></React.StrictMode>);
