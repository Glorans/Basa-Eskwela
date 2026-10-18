export type Language = "en" | "fil";
export type Operation = "transcribe" | "synthesize" | "assess";
export type Provider = { id: string; name: string; status: string; languages: Language[]; operations: Operation[]; audioFormats: string[]; maxDurationSeconds: number; maxAudioBytes: number };
export type PreparedAudio = { blob: Blob; durationSeconds: number; sampleRate: number };
export type Result = {
  simulated: true; label: string; operation: Operation; provider: string; language: Language; expectedPassage: string;
  transcript?: string; completeness?: string;
  agreement: null | { available: boolean; reason?: string; expectedWords?: number; recognizedWords?: number; discrepancies: { kind: string; expected: string; recognized: string; expectedIndex: number }[] };
  pronunciation: null | { kind: "simulated"; label: string; scale: string; scores: Record<string, number> };
  warnings: string[]; timings: { providerMs: number; serverMs: number; clientMs?: number };
  audioBase64?: string; mimeType?: string; audioMetadata?: Record<string, unknown>;
};
