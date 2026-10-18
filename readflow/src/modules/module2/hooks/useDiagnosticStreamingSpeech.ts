import { useCallback, useEffect, useRef, useState } from "react";
import { getApiUrl } from "../../../lib/apiUrl";
import { supabase } from "../../../lib/supabaseClient";
import workletUrl from "../audio/diagnosticPcmWorklet.ts?worker&url";
import { createDiagnosticStreamingSession } from "../services/diagnosticStreamingSession";
import {
  getDiagnosticSpeechSocketUrl,
  type StreamingTranscriptState,
} from "../services/diagnosticStreamingTranscript";
import type { DiagnosticLanguage } from "../types/diagnostic";

const EMPTY_TRANSCRIPT: StreamingTranscriptState = { confirmedTranscript: "", interimTranscript: "" };

export function useDiagnosticStreamingSpeech(language: DiagnosticLanguage) {
  const [transcript, setTranscript] = useState(EMPTY_TRANSCRIPT);
  const [failed, setFailed] = useState(false);
  const mounted = useRef(false);
  const session = useRef<ReturnType<typeof createDiagnosticStreamingSession> | null>(null);

  const reset = useCallback(() => {
    session.current?.cancel();
    session.current = null;
    if (mounted.current) { setTranscript(EMPTY_TRANSCRIPT); setFailed(false); }
  }, []);

  const start = useCallback((stream: MediaStream) => {
    if (session.current) return;
    reset();
    const current = createDiagnosticStreamingSession({
      language,
      url: getDiagnosticSpeechSocketUrl(getApiUrl(), window.location.href),
      workletUrl,
      getAccessToken: async () => {
        const { data: { session: authSession }, error } = await supabase.auth.getSession();
        if (error || !authSession?.access_token) throw new Error("No authenticated session");
        return authSession.access_token;
      },
      onTranscript: (state) => {
        if (mounted.current && session.current === current) setTranscript(state);
      },
      onFailure: () => {
        if (mounted.current && session.current === current) {
          setFailed(true);
          setTranscript((state) => ({ ...state, interimTranscript: "" }));
        }
      },
      log: (event, details) => {
        if (import.meta.env.DEV) console.info(`[DiagnosticStreaming] ${event}`, details ?? "");
      },
    });
    session.current = current;
    void current.start(stream);
  }, [language, reset]);

  const stop = useCallback(() => session.current?.stop() ?? Promise.resolve(null), []);
  const cancel = useCallback(() => session.current?.cancel(), []);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; session.current?.cancel(); session.current = null; };
  }, []);

  return { ...transcript, failed, start, stop, reset, cancel };
}
