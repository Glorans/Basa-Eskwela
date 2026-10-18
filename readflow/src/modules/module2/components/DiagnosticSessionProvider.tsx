import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { useAuth } from "../../../auth/useAuth";
import { supabase } from "../../../lib/supabaseClient";
import { diagnosticSessionKey, recoverDiagnosticSession, serializeDiagnosticSession, type DiagnosticSession } from "../services/diagnosticSession";
import type { DiagnosticAssessment } from "../types/diagnostic";

function createSessionStore(userId: string) {
  const memory = new Map<string, DiagnosticSession>();
  return {
    get(assessment: DiagnosticAssessment) {
      const key = diagnosticSessionKey(userId, assessment);
      if (memory.has(key)) return memory.get(key)!;
      try {
        const session = recoverDiagnosticSession(sessionStorage.getItem(key), userId, assessment);
        if (session) memory.set(key, session);
        else sessionStorage.removeItem(key);
        return session;
      } catch { return null; }
    },
    save(assessment: DiagnosticAssessment, session: DiagnosticSession) {
      const key = diagnosticSessionKey(userId, assessment);
      memory.set(key, session);
      try { sessionStorage.setItem(key, serializeDiagnosticSession(session, userId)); } catch { /* In-memory flow still works. */ }
    },
    clear(assessment: DiagnosticAssessment) {
      const key = diagnosticSessionKey(userId, assessment);
      memory.delete(key);
      try { sessionStorage.removeItem(key); } catch { /* Storage may be disabled. */ }
    },
    clearAll() {
      memory.clear();
      try {
        const prefix = `readflow:m2:${encodeURIComponent(userId)}:`;
        Object.keys(sessionStorage).filter(key => key.startsWith(prefix)).forEach(key => sessionStorage.removeItem(key));
      } catch { /* Storage may be disabled. */ }
    },
  };
}

const SessionContext = createContext<ReturnType<typeof createSessionStore> | null>(null);

export function DiagnosticSessionProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const store = useMemo(() => createSessionStore(user?.id ?? ""), [user?.id]);
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(event => {
      if (event === "SIGNED_OUT") store.clearAll();
    });
    return () => subscription.unsubscribe();
  }, [store]);
  return <SessionContext.Provider value={store}><div key={user?.id}>{children}</div></SessionContext.Provider>;
}

export function useDiagnosticSession() {
  const context = useContext(SessionContext);
  if (!context) throw new Error("Diagnostic session provider is required");
  return context;
}
