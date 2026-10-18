import { useEffect, useRef, useState } from "react";
import { AUDIO_LIMITS } from "./audioPreparation";

export function useLabRecorder(onAudio: (blob: Blob) => void, onError: (message: string) => void) {
  const [recording, setRecording] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const active = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const generation = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const callbacks = useRef({ onAudio, onError }); callbacks.current = { onAudio, onError };
  function stop() { if (active.current?.state === "recording") active.current.stop(); stream.current?.getTracks().forEach(t => t.stop()); clearInterval(timer.current); }
  function discard() { generation.current++; stop(); active.current = null; setRecording(false); setRequesting(false); setSeconds(0); }
  useEffect(() => () => { generation.current++; active.current?.state === "recording" && active.current.stop(); stream.current?.getTracks().forEach(t => t.stop()); clearInterval(timer.current); }, []);
  async function start() {
    const current = ++generation.current;
    setRequesting(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") throw new Error("Microphone recording is unavailable in this browser. Upload audio instead.");
      const media = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 }, video: false });
      if (current !== generation.current) { media.getTracks().forEach(t => t.stop()); return; }
      stream.current = media;
      const mimeType = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"].find(t => MediaRecorder.isTypeSupported(t));
      const recorder = new MediaRecorder(media, mimeType ? { mimeType } : undefined);
      active.current = recorder;
      const chunks: Blob[] = []; let size = 0; let failed = false;
      recorder.ondataavailable = event => {
        size += event.data.size;
        if (size > AUDIO_LIMITS.maxBytes) { failed = true; callbacks.current.onError("Recording exceeded 10 MB and was discarded."); stop(); return; }
        if (event.data.size) chunks.push(event.data);
      };
      recorder.onerror = () => { failed = true; callbacks.current.onError("Microphone recording failed."); stop(); };
      recorder.onstop = () => {
        media.getTracks().forEach(t => t.stop()); clearInterval(timer.current);
        if (current !== generation.current) return;
        setRecording(false); active.current = null;
        if (!failed) callbacks.current.onAudio(new Blob(chunks, { type: recorder.mimeType }));
      };
      recorder.start(250); setRecording(true); setSeconds(0);
      const began = performance.now();
      timer.current = setInterval(() => { const elapsed = (performance.now() - began) / 1000; setSeconds(Math.min(elapsed, AUDIO_LIMITS.maxDurationSeconds)); if (elapsed >= AUDIO_LIMITS.maxDurationSeconds) stop(); }, 100);
    } catch (error) { stream.current?.getTracks().forEach(t => t.stop()); if (current === generation.current) callbacks.current.onError(error instanceof Error ? error.message : "Microphone permission was denied."); }
    finally { if (current === generation.current) setRequesting(false); }
  }
  return { recording, requesting, seconds, start, stop, discard };
}
