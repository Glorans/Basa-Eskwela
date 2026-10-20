import { useEffect, useRef, useState } from "react";
import { loadProviders, runExperiment } from "./api";
import { prepareAudio } from "./audioPreparation";
import { samples } from "./samplePassages";
import { useLabRecorder } from "./useLabRecorder";
import { exportPayload } from "./resultExport";
import type { Language, Operation, PreparedAudio, Provider, Result } from "./types";

function useAudioUrl(blob?: Blob) {
  const [url, setUrl] = useState("");
  useEffect(() => { if (!blob) { setUrl(""); return; } const value = URL.createObjectURL(blob); setUrl(value); return () => URL.revokeObjectURL(value); }, [blob]);
  return url;
}
function TonePlayer({ result }: { result: Result }) {
  const [blob, setBlob] = useState<Blob>();
  useEffect(() => { setBlob(result.audioBase64 ? new Blob([Uint8Array.from(atob(result.audioBase64), c => c.charCodeAt(0))], { type: "audio/wav" }) : undefined); }, [result]);
  const url = useAudioUrl(blob);
  return url ? <><p>{result.simulated ? "SIMULATED TTS: test tone only, no spoken passage." : `REAL AZURE speech: ${result.voice} (${result.locale})`}</p><audio controls src={url} /></> : null;
}
function ResultView({ result }: { result: Result }) {
  return <section className="sl-card" aria-label="Experiment result">
    <h2>{result.simulated ? "SIMULATED" : "REAL AZURE"} result</h2><p className="sl-warning">{result.label}{result.simulated ? ". This is not a real speech evaluation." : ". Automated feedback requires human interpretation."}</p>
    <p>{result.provider} · {result.language === "en" ? "English" : "Filipino"} · {result.operation}</p>
    <h3>Expected passage</h3><p>{result.expectedPassage}</p>
    {result.operation === "synthesize" ? <TonePlayer result={result} /> : <>
      <h3>{result.simulated ? "SIMULATED" : "REAL AZURE"} transcript</h3><p>{result.transcript || "No speech recognized"}</p><p>Recognition status: {result.completeness} (service processing, not passage completion)</p>
      <h3>Transcript agreement — not pronunciation</h3>
      <p>Differences are possible recognition or reading discrepancies. {result.simulated ? "No accuracy percentage is assigned to fixtures." : "An STT agreement estimate does not measure acoustic pronunciation."}</p>
      {result.agreement?.accuracy !== undefined && <p><strong>{result.agreement.accuracy.toFixed(1)}%</strong> — {result.agreement.label}<br />{result.agreement.formula}</p>}
      {!result.agreement?.available ? <p>{result.agreement?.reason || "Unavailable"}</p> : result.agreement.discrepancies.length ? <ul>{result.agreement.discrepancies.map((d, i) => <li key={i}>{d.kind}: expected “{d.expected || "—"}”, recognized “{d.recognized || "—"}” (position {d.expectedIndex + 1})</li>)}</ul> : <p>No differences in the {result.simulated ? "simulated" : "recognized"} transcript after normalization.</p>}
      <h3>Pronunciation assessment</h3>
      {result.pronunciation ? <><p>{result.pronunciation.label}. Scale: {result.pronunciation.scale}.</p><ul>{Object.entries(result.pronunciation.scores).map(([key, score]) => <li key={key}>{result.simulated ? "SIMULATED" : "REAL AZURE"} {key}: {score ?? "Unavailable"}</li>)}</ul>
        {result.pronunciation.segments?.map((segment, index) => <div key={index}><h4>Azure segment {index + 1}</h4><p>{segment.text}</p><p>{Object.entries(segment.scores).map(([key, score]) => `${key}: ${score ?? "Unavailable"}`).join(" · ")}</p><table><thead><tr><th>Word</th><th>Azure accuracy / 100</th><th>Azure feedback</th></tr></thead><tbody>{segment.words.map((word, i) => <tr key={i}><td>{word.word}</td><td>{word.accuracy ?? "Unavailable"}</td><td>{word.errorType ?? "Unavailable"}</td></tr>)}</tbody></table></div>)}
      </> : <p>Unavailable for this operation, language, or incomplete recognition. No zero score is substituted.</p>}
    </>}
    <p>{result.simulated ? "SIMULATED" : "REAL AZURE"} adapter elapsed: {result.timings.providerMs.toFixed(0)} ms · server: {result.timings.serverMs.toFixed(0)} ms · round trip: {result.timings.clientMs?.toFixed(0)} ms · preparation: {result.timings.preparationMs?.toFixed(0) ?? "N/A"} ms</p><p>Adapter elapsed includes SDK setup, transport, and cleanup; it is not pure cloud compute time.</p>
    <ul>{result.warnings.map(w => <li key={w}>{w}</li>)}</ul>
  </section>;
}
export default function SpeechLabPage() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [provider, setProvider] = useState("mock-full");
  const [language, setLanguage] = useState<Language>("en");
  const [operation, setOperation] = useState<Operation>("transcribe");
  const [text, setText] = useState(samples.en[0].text);
  const [scenario, setScenario] = useState("complete");
  const [audio, setAudio] = useState<PreparedAudio>();
  const [preparing, setPreparing] = useState(false);
  const [preparationMs, setPreparationMs] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<Result[]>([]);
  const [result, setResult] = useState<Result>();
  const request = useRef<AbortController | null>(null);
  const preparation = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const inputUrl = useAudioUrl(audio?.blob);
  useEffect(() => {
    const controller = new AbortController();
    loadProviders(controller.signal).then(setProviders).catch(e => { if (!controller.signal.aborted) setError(`Start the local Speech Lab API on port 5002. ${e.message}`); });
    return () => { controller.abort(); request.current?.abort(); preparation.current++; };
  }, []);
  async function acceptAudio(blob: Blob, recorded = false) {
    const id = ++preparation.current; const began = performance.now();
    setPreparing(true); setAudio(undefined); setResult(undefined); setError("");
    try { const ready = await prepareAudio(blob, recorded); if (id === preparation.current) { setAudio(ready); setPreparationMs(performance.now() - began); } }
    catch (e) { if (id === preparation.current) setError(e instanceof Error ? e.message : "Could not prepare audio."); }
    finally { if (id === preparation.current) setPreparing(false); }
  }
  const recorder = useLabRecorder(blob => { void acceptAudio(blob, true); }, setError);
  const selected = providers.find(p => p.id === provider);
  const supported = selected?.status !== "disabled" && selected?.capabilities[language]?.includes(operation);
  const locked = busy || preparing || recorder.recording || recorder.requesting;
  function clearAudio() { preparation.current++; setPreparing(false); recorder.discard(); setAudio(undefined); setPreparationMs(0); if (fileInput.current) fileInput.current.value = ""; }
  function cancel() { request.current?.abort(); }
  async function run() {
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setError(""); setResult(undefined);
    const deadline = setTimeout(() => controller.abort(), provider === "azure" ? 75000 : 20000);
    try {
      const output = await runExperiment({ provider, language, operation, text, scenario, audio: audio?.blob }, controller.signal);
      if (!controller.signal.aborted) { output.timings.preparationMs = operation === "synthesize" ? undefined : preparationMs; setResult(output); const { audioBase64: _audio, ...metadata } = output; setHistory(old => [...old, metadata].slice(-50)); }
    } catch (e) { setError(controller.signal.aborted ? "Experiment cancelled or timed out. No result was saved." : e instanceof Error ? e.message : "Experiment failed."); }
    finally { clearTimeout(deadline); if (request.current === controller) { request.current = null; setBusy(false); } }
  }
  function exportResults() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(exportPayload(history, language), null, 2)], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = `speech-lab-results-${language}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <main className="sl-shell">
    <header><p className="sl-eyebrow">Basa Eskwela · Development only</p><h1>Speech Lab</h1><p>Explore the interface for speech recognition, synthesis, and pronunciation assessment.</p></header>
    <aside className="sl-warning"><strong>{selected?.status === "real" ? "REAL AZURE — Run sends audio or text to Microsoft." : "SIMULATED providers stay local. Azure is disabled until explicitly configured."}</strong> Mock transcripts come from the passage, not your recording. Use neutral adult test audio without names or personal information. Local audio and results stay in memory until cleared or this page closes. Cloud processing requires separate approval.</aside>
    {error && <p className="sl-error" role="alert">{error}</p>}
    <section className="sl-card"><h2>Configure experiment</h2>
      <fieldset disabled={locked}><legend>Provider and language</legend><div className="sl-grid">
        <label>Provider<select value={provider} onChange={e => { setProvider(e.target.value); setResult(undefined); }}>{providers.map(p => <option key={p.id} value={p.id} disabled={p.status === "disabled"}>{p.name}</option>)}</select></label>
        <label>Language<select value={language} onChange={e => { const lang = e.target.value as Language; setLanguage(lang); setText(samples[lang][0].text); setResult(undefined); clearAudio(); }}><option value="en">English</option><option value="fil">Filipino</option></select></label>
        <label>Operation<select value={operation} onChange={e => { setOperation(e.target.value as Operation); setResult(undefined); }}><option value="transcribe">Speech-to-text</option><option value="synthesize">Text-to-speech</option><option value="assess">Pronunciation assessment / fixture</option></select></label>
        {selected?.status === "simulated" && <label>SIMULATED scenario<select value={scenario} onChange={e => { setScenario(e.target.value); setResult(undefined); }}>{["complete", "discrepancies", "incomplete", "no-speech", "error", "slow"].map(s => <option key={s}>{s}</option>)}</select></label>}
      </div>
      <label>Sample passage<select defaultValue="" key={language} onChange={e => { if (e.target.value !== "") { setText(samples[language][Number(e.target.value)].text); setResult(undefined); } }}><option value="" disabled>Choose a sample</option>{samples[language].map((p, i) => <option key={p.title} value={i}>{p.title}</option>)}</select></label>
      <label>Expected passage / TTS text<textarea rows={3} maxLength={5000} value={text} onChange={e => { setText(e.target.value); setResult(undefined); }} /></label></fieldset>
      <p>Capabilities for this language: {selected?.capabilities[language]?.join(", ") || "Unavailable"} · PCM WAV · input 30 seconds / 10 MB</p>
      <p>Azure acoustic pronunciation: English only. Filipino acoustic pronunciation is unsupported. {providers.find(p => p.id === "azure")?.reason}</p>
      {!supported && <p className="sl-warning">This capability is unavailable for the selected provider. No zero score will be substituted.</p>}
      {operation === "synthesize" && <p>{selected?.status === "real" ? "REAL AZURE TTS uses an allowlisted neural voice; maximum 1,000 characters and 2 MB output. Synthesized duration can exceed 30 seconds." : "SIMULATED TTS returns a test tone. Use error or slow to exercise TTS failures and cancellation."}</p>}
    </section>
    <section className="sl-card"><h2>Test audio</h2><p>Maximum 30 seconds and 10 MB. Browser-decodable uploads are converted locally to mono 16 kHz PCM WAV. Only the converted audio is sent to the local test server.</p>
      <div className="sl-actions"><button disabled={locked} onClick={() => { clearAudio(); void recorder.start(); }}>Record microphone</button><button disabled={!recorder.recording} onClick={recorder.stop}>Stop recording</button><button disabled={busy} onClick={clearAudio}>Clear audio / cancel capture</button></div>
      <p role="status">{recorder.requesting ? "Waiting for microphone permission…" : recorder.recording ? `Recording: ${recorder.seconds.toFixed(1)} / 30 seconds` : preparing ? "Preparing audio locally…" : "Microphone idle"}</p>
      <label>Upload neutral test audio<input ref={fileInput} type="file" accept="audio/*,.wav" disabled={locked} onChange={e => { const file = e.target.files?.[0]; if (file) void acceptAudio(file); e.target.value = ""; }} /></label>
      {inputUrl && <><audio controls src={inputUrl} /><p>{audio?.durationSeconds.toFixed(2)} s · {audio?.sampleRate} Hz · mono PCM WAV · preparation {preparationMs.toFixed(0)} ms</p></>}
    </section>
    <div className="sl-actions"><button className="sl-primary" disabled={locked || !supported || !text.trim() || (operation !== "synthesize" && !audio)} onClick={() => void run()}>Run {selected?.status === "real" ? "REAL AZURE" : "SIMULATED"} experiment</button><button disabled={!busy} onClick={cancel}>Cancel request</button></div>
    <p role="status">{busy ? `Running ${selected?.status === "real" ? "REAL AZURE" : "SIMULATED"} experiment…` : "Ready. Only explicitly enabled capabilities can run."}</p>
    {result && result.language === language && <ResultView result={result} />}
    <section className="sl-card"><h2>Temporary comparison — {language === "en" ? "English" : "Filipino"}</h2><p>Rows distinguish REAL AZURE from SIMULATED fixtures; never compare fixture timings as cloud benchmarks. Last 50 result records are retained without audio. Each language is displayed and exported separately.</p>
      <div className="sl-actions"><button disabled={!history.some(r => r.language === language)} onClick={exportResults}>Export this language as JSON (no audio)</button><button disabled={busy} onClick={() => { setHistory([]); setResult(undefined); clearAudio(); setError(""); }}>Clear all results and audio</button></div>
      <div className="sl-table"><table><thead><tr><th>Result</th><th>Operation</th><th>Recognition status</th><th>Round trip</th></tr></thead><tbody>{history.filter(r => r.language === language).map((r, i) => <tr key={i}><td>{r.simulated ? "SIMULATED" : "REAL AZURE"} · {r.provider}</td><td>{r.operation}</td><td>{r.completeness || (r.simulated ? "Tone fixture" : "Synthesized speech")}</td><td>{r.timings.clientMs?.toFixed(0)} ms</td></tr>)}</tbody></table></div>
    </section>
  </main>;
}
