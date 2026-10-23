import type { DiagnosticTranscription } from "../types/diagnostic";

export interface StreamingTranscriptState {
  confirmedTranscript: string;
  interimTranscript: string;
}

/** Final segment IDs and sequence numbers survive Azure stream rotations.
 * Identical words spoken twice remain two segments; transport duplicates don't. */
export class DiagnosticStreamingTranscript {
  private segments: { id: string; text: string; confidence?: number }[] = [];
  private interim = "";

  get snapshot(): StreamingTranscriptState {
    return {
      confirmedTranscript: this.segments.map((segment) => segment.text).join(" "),
      interimTranscript: this.interim,
    };
  }

  receive(message: Record<string, unknown>) {
    if (message.type === "interim") {
      if (typeof message.text !== "string") throw new Error("Invalid interim transcript");
      this.interim = message.text.trim();
    } else if (message.type === "final") {
      const { segmentId, sequence, text, confidence } = message;
      if (typeof segmentId !== "string" || !Number.isInteger(sequence)
        || typeof text !== "string" || !text.trim()) throw new Error("Invalid final transcript");
      const previous = this.segments.findIndex((segment) => segment.id === segmentId);
      if (previous !== -1) {
        if (previous + 1 !== sequence || this.segments[previous].text !== text.trim()) {
          throw new Error("Inconsistent repeated final transcript");
        }
        return;
      }
      if (sequence !== this.segments.length + 1) throw new Error("Missing final transcript segment");
      this.segments.push({
        id: segmentId, text: text.trim(),
        ...(typeof confidence === "number" && Number.isFinite(confidence) ? { confidence } : {}),
      });
      this.interim = "";
    }
  }

  finish(finalCount: unknown): DiagnosticTranscription | null {
    if (finalCount !== this.segments.length || this.interim) return null;
    const text = this.snapshot.confirmedTranscript;
    if (!text) return null;
    const confidences = this.segments.flatMap((segment) =>
      segment.confidence === undefined ? [] : [segment.confidence]);
    return confidences.length
      ? { text, confidence: confidences.reduce((a, b) => a + b, 0) / confidences.length }
      : { text };
  }
}

export function getDiagnosticSpeechSocketUrl(apiUrl: string, pageUrl: string) {
  const url = new URL(apiUrl, pageUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `${url.pathname.replace(/\/$/, "")}/ws/diagnostic/speech`;
  url.search = "";
  url.hash = "";
  return url.href;
}
