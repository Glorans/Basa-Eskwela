import { useState } from "react";
import { Outlet } from "react-router-dom";
import BasaHeader from "./BasaHeader";
import BasaSidebar from "./BasaSidebar";
import "./BasaLayout.css";

export default function BasaLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="basa-page">
      <BasaSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="basa-main-shell">
        <BasaHeader onMenuClick={() => setSidebarOpen(true)} />
        <main className="basa-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
