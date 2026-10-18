import { DiagnosticPcmEncoder } from "./diagnosticPcm";

declare const sampleRate: number;
declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, processor: typeof DiagnosticPcmProcessor): void;

class DiagnosticPcmProcessor extends AudioWorkletProcessor {
  private encoder = new DiagnosticPcmEncoder(sampleRate);
  private running = true;
  private emit = (audio: ArrayBuffer) => this.port.postMessage({ type: "audio", audio }, [audio]);

  constructor() {
    super();
    this.port.onmessage = (event) => {
      if (event.data?.type === "stop") {
        this.running = false;
        this.encoder.flush(this.emit);
        this.port.postMessage({ type: "flushed" });
      }
    };
  }

  process(inputs: Float32Array[][]) {
    if (!this.running) return false;
    this.encoder.push(inputs[0] ?? [], this.emit);
    // Outputs stay silent; connection to destination keeps processing alive.
    return true;
  }
}

registerProcessor("diagnostic-pcm", DiagnosticPcmProcessor);
