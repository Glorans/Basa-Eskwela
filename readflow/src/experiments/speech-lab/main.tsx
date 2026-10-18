import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import SpeechLabPage from "./SpeechLabPage";
import "./speechLab.css";

createRoot(document.getElementById("root")!).render(<StrictMode><SpeechLabPage /></StrictMode>);
