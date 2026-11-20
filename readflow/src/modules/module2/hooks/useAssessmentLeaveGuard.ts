import { useContext, useEffect } from "react";
import { UNSAFE_NavigationContext } from "react-router-dom";
import { confirmReadFlow } from "../../../components/ReadFlowDialog";

const MESSAGE = "You have unsaved changes. Leave this page and discard them?";
const ask = () => confirmReadFlow(MESSAGE, { confirm: "Leave Page", cancel: "Continue Editing" });

/** BrowserRouter does not expose data-router blockers. Guard its navigation methods locally,
 * plus reload/close and browser history, without changing routing for other modules.
 * Back/Forward: the move is undone at once, then repeated only if the user confirms in the app dialog
 * (no native popup; the app never uses them). */
export function useAssessmentLeaveGuard(dirty: boolean) {
  const { navigator } = useContext(UNSAFE_NavigationContext);
  useEffect(() => {
    if (!dirty) return;
    const push = navigator.push;
    const replace = navigator.replace;
    let mounted = true;
    navigator.push = (...args) => { void ask().then(ok => { if (ok && mounted) push.apply(navigator, args); }); };
    navigator.replace = (...args) => { void ask().then(ok => { if (ok && mounted) replace.apply(navigator, args); }); };
    const index = window.history.state?.idx;
    let restoring = false;
    let leaving = false;
    const beforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    const pop = (e: PopStateEvent) => {
      if (leaving) return; // confirmed: the router handles this move
      const next = e.state?.idx;
      if (typeof index !== "number" || typeof next !== "number") return; // cannot be undone safely: allow
      e.stopImmediatePropagation();
      if (restoring) { restoring = false; return; }
      const delta = next - index;
      if (delta === 0) return;
      restoring = true;
      window.history.go(-delta);
      void ask().then(ok => {
        if (!ok || !mounted) return;
        leaving = true;
        window.history.go(delta);
      });
    };
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("popstate", pop, true);
    return () => {
      mounted = false; navigator.push = push; navigator.replace = replace;
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("popstate", pop, true);
    };
  }, [dirty, navigator]);
}
