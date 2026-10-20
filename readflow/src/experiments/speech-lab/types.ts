export type Language = "en" | "fil";
export type Operation = "transcribe" | "synthesize" | "assess";
export type Provider = { id: string; name: string; status: string; reason?: string; capabilities: Partial<Record<Language, Operation[]>>; languages: Language[]; operations: Operation[]; audioFormats: string[]; maxDurationSeconds: number; maxAudioBytes: number };
export type PreparedAudio = { blob: Blob; durationSeconds: number; sampleRate: number };
export type Result = {
  simulated: boolean; label: string; operation: Operation; provider: string; language: Language; expectedPassage: string;
  locale?: string; voice?: string; sdkVersion?: string; region?: string;
  transcript?: string; completeness?: string;
  agreement: null | { available: boolean; reason?: string; expectedWords?: number; recognizedWords?: number; accuracy?: number; formula?: string; label?: string; discrepancies: { kind: string; expected: string; recognized: string; expectedIndex: number }[] };
  pronunciation: null | { kind: "simulated" | "azure"; label: string; scale: string; scores: Record<string, number | null>; segments?: { text: string; scores: Record<string, number | null>; words: { word: string; accuracy: number | null; errorType: string | null }[] }[] };
  warnings: string[]; timings: { providerMs: number; serverMs: number; clientMs?: number; preparationMs?: number };
  audioBase64?: string; mimeType?: string; audioMetadata?: Record<string, unknown>;
};
