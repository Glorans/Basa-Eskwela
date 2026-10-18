const DIAGNOSTIC_PCM_RATE = 16000;
const DIAGNOSTIC_PCM_FRAME_SAMPLES = 1600; // 100 ms / 3,200 bytes.

/** Stateful downsampling across render quanta (including fractional 44.1k ratios).
 * A 63-tap windowed-sinc low-pass filter suppresses aliases before decimation.
 * Output is signed 16-bit little-endian PCM, never Float32 audio bytes. */
export class DiagnosticPcmEncoder {
  private ratio: number;
  private coefficients: Float64Array;
  private history = new Float32Array(63);
  private position = 0;
  private weight = 0;
  private sum = 0;
  private packet = new ArrayBuffer(DIAGNOSTIC_PCM_FRAME_SAMPLES * 2);
  private packetSize = 0;

  constructor(inputRate: number) {
    if (!Number.isFinite(inputRate) || inputRate < DIAGNOSTIC_PCM_RATE) {
      throw new Error("Unsupported microphone sample rate");
    }
    this.ratio = inputRate / DIAGNOSTIC_PCM_RATE;
    const cutoff = 0.45 / this.ratio;
    const taps = this.history.length;
    this.coefficients = Float64Array.from({ length: taps }, (_, index) => {
      const x = index - (taps - 1) / 2;
      const sinc = x === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * x) / (Math.PI * x);
      return sinc * (0.54 - 0.46 * Math.cos(2 * Math.PI * index / (taps - 1)));
    });
    const gain = this.coefficients.reduce((total, value) => total + value, 0);
    this.coefficients = this.coefficients.map((value) => value / gain);
  }

  push(channels: readonly Float32Array[], emit: (packet: ArrayBuffer) => void) {
    if (!channels.length) return;
    for (let index = 0; index < channels[0].length; index += 1) {
      let mono = 0;
      for (const channel of channels) mono += channel[index] ?? 0;
      this.history[this.position] = mono / channels.length;
      let sample = 0;
      for (let tap = 0; tap < this.history.length; tap += 1) {
        sample += this.history[(this.position - tap + this.history.length) % this.history.length]
          * this.coefficients[tap];
      }
      this.position = (this.position + 1) % this.history.length;
      let remaining = 1;
      while (remaining > 1e-9) {
        const amount = Math.min(remaining, this.ratio - this.weight);
        this.sum += sample * amount;
        this.weight += amount;
        remaining -= amount;
        if (this.weight >= this.ratio - 1e-9) {
          const value = Math.max(-1, Math.min(1, this.sum / this.ratio));
          new DataView(this.packet).setInt16(this.packetSize * 2,
            Math.round(value * (value < 0 ? 32768 : 32767)), true);
          this.packetSize += 1;
          this.weight = 0;
          this.sum = 0;
          if (this.packetSize === DIAGNOSTIC_PCM_FRAME_SAMPLES) this.flush(emit);
        }
      }
    }
  }

  flush(emit: (packet: ArrayBuffer) => void) {
    if (!this.packetSize) return;
    emit(this.packet.slice(0, this.packetSize * 2));
    this.packet = new ArrayBuffer(DIAGNOSTIC_PCM_FRAME_SAMPLES * 2);
    this.packetSize = 0;
  }
}
