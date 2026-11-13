import useResponsiveSidebar from "../../hooks/useResponsiveSidebar";
import "../../styles/responsive-shell.css";
import { Outlet } from "react-router-dom";
import BasaHeader from "./BasaHeader";
import BasaSidebar from "./BasaSidebar";
import "./BasaLayout.css";

export default function BasaLayout() {
  const sidebar = useResponsiveSidebar();

  return (
    <div className={`basa-page ${sidebar.shellClasses}`}>
      <BasaSidebar controller={sidebar} open={sidebar.drawerOpen} onClose={sidebar.close} />
      <div className="basa-main-shell rf-workspace" ref={sidebar.workspaceRef}>
        <BasaHeader onMenuClick={sidebar.toggle} menuExpanded={sidebar.expanded} menuLabel={sidebar.toggleLabel} menuRef={sidebar.triggerRef} />
        <div className="rf-content-scroll" tabIndex={0} role="region" aria-label="Main content"><main className="basa-content">
          <Outlet />
        </main></div>
      </div>
    </div>
  );
}
