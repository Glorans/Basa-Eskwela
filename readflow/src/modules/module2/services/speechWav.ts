// Azure Speech receives mono 16 kHz signed 16-bit PCM. Each recorded part
// (a self-contained WebM/Opus file of at most 25 s) is decoded in the browser and
// re-encoded as WAV before upload; the backend verifies the container again.
// A continuous read-aloud recording is decoded once and cut into such parts.
// Adapted from the Speech Lab's tested audio preparation (experiments/speech-lab/audioPreparation.ts).
export const SPEECH_WAV_SAMPLE_RATE = 16000;
// Matches the backend part limit (server/services/wavAudio.js). The recorder's
// final chunk can run slightly past 25 s, so longer audio is trimmed, not rejected.
export const SPEECH_WAV_MAX_SECONDS = 30;

/** Encodes mono float samples (-1..1) as a 16-bit PCM WAV file. */
export function encodePcm16Wav(samples: Float32Array, sampleRate = SPEECH_WAV_SAMPLE_RATE): ArrayBuffer {
  const bytes = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(bytes);
  const ascii = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index));
  };
  ascii(0, "RIFF");
  view.setUint32(4, bytes.byteLength - 8, true);
  ascii(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, index) => {
    const value = Math.max(-1, Math.min(1, sample));
    view.setInt16(44 + index * 2, value < 0 ? value * 32768 : value * 32767, true);
  });
  return bytes;
}

export class SpeechWavConversionError extends Error {
  constructor() {
    super("This recording could not be prepared for speech processing. Please record it again.");
    this.name = "SpeechWavConversionError";
  }
}

/** Decodes recorded audio and resamples up to maxSeconds of it to mono 16 kHz samples. */
async function renderSpeechSamples(audio: Blob, maxSeconds: number): Promise<Float32Array> {
  if (!audio.size || typeof AudioContext === "undefined" || typeof OfflineAudioContext === "undefined") {
    throw new SpeechWavConversionError();
  }
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await audio.arrayBuffer());
    if (!decoded.length) throw new SpeechWavConversionError();
    const length = Math.min(
      Math.ceil(decoded.duration * SPEECH_WAV_SAMPLE_RATE),
      maxSeconds * SPEECH_WAV_SAMPLE_RATE,
    );
    // Rendering into one channel down-mixes stereo input.
    const offline = new OfflineAudioContext(1, length, SPEECH_WAV_SAMPLE_RATE);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();
    return rendered.getChannelData(0);
  } catch (error) {
    if (error instanceof SpeechWavConversionError) throw error;
    throw new SpeechWavConversionError();
  } finally {
    await context.close().catch(() => undefined);
  }
}

/** Decodes a recorded part and resamples it to a mono 16 kHz WAV Blob. */
export async function convertToSpeechWav(audio: Blob): Promise<Blob> {
  const samples = await renderSpeechSamples(audio, SPEECH_WAV_MAX_SECONDS);
  return new Blob([encodePcm16Wav(samples)], { type: "audio/wav" });
}

// Continuous recordings are cut into parts of this length for Azure, which
// accepts at most SPEECH_WAV_MAX_SECONDS per part.
export const SPEECH_WAV_PART_SECONDS = 25;
// Bounds decoding memory; recordings stop at five minutes.
const SPEECH_WAV_MAX_RECORDING_SECONDS = 6 * 60;

/**
 * Splits samples into consecutive parts of partSeconds. A final part shorter
 * than one second joins the previous part, which stays within the part limit.
 */
export function splitSpeechSamples(
  samples: Float32Array,
  sampleRate = SPEECH_WAV_SAMPLE_RATE,
  partSeconds = SPEECH_WAV_PART_SECONDS,
): Float32Array[] {
  const partLength = partSeconds * sampleRate;
  const starts: number[] = [];
  for (let start = 0; start < samples.length; start += partLength) starts.push(start);
  if (starts.length > 1 && samples.length - starts[starts.length - 1] < sampleRate) starts.pop();
  return starts.map((start, index) => samples.subarray(start, starts[index + 1] ?? samples.length));
}

/** Decodes a whole recording once and returns it as WAV parts in order. */
export async function convertToSpeechWavParts(audio: Blob): Promise<Blob[]> {
  const samples = await renderSpeechSamples(audio, SPEECH_WAV_MAX_RECORDING_SECONDS);
  return splitSpeechSamples(samples).map((part) => new Blob([encodePcm16Wav(part)], { type: "audio/wav" }));
}
