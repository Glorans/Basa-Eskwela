import type { PreparedAudio } from "./types";
export const AUDIO_LIMITS = { maxDurationSeconds: 30, maxBytes: 10 * 1024 * 1024 };

export async function prepareAudio(blob: Blob, recorded = false): Promise<PreparedAudio> {
  if (!blob.size || blob.size > AUDIO_LIMITS.maxBytes) throw new Error("Choose nonempty audio no larger than 10 MB.");
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    if (!decoded.length || (!recorded && decoded.duration > AUDIO_LIMITS.maxDurationSeconds)) throw new Error("Audio must be at most 30 seconds. Trim the file before uploading.");
    // Use a common transport format; preserve actual rate in the WAV header.
    const rate = 16000;
    // MediaRecorder may deliver a final chunk after its stop timer. Trim capture
    // to the limit rather than rejecting an otherwise valid automatic stop.
    const length = Math.min(Math.ceil(decoded.duration * rate), AUDIO_LIMITS.maxDurationSeconds * rate);
    const offline = new OfflineAudioContext(1, length, rate);
    const source = offline.createBufferSource(); source.buffer = decoded; source.connect(offline.destination); source.start();
    const rendered = await offline.startRendering();
    const pcm = rendered.getChannelData(0);
    const bytes = new ArrayBuffer(44 + pcm.length * 2), view = new DataView(bytes);
    const ascii = (offset: number, text: string) => [...text].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
    ascii(0, "RIFF"); view.setUint32(4, bytes.byteLength - 8, true); ascii(8, "WAVEfmt ");
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    ascii(36, "data"); view.setUint32(40, pcm.length * 2, true);
    pcm.forEach((sample, i) => { const s = Math.max(-1, Math.min(1, sample)); view.setInt16(44 + i * 2, s < 0 ? s * 32768 : s * 32767, true); });
    if (bytes.byteLength > AUDIO_LIMITS.maxBytes) throw new Error("Prepared audio exceeds 10 MB.");
    return { blob: new Blob([bytes], { type: "audio/wav" }), durationSeconds: pcm.length / rate, sampleRate: rate };
  } catch (error) {
    if (error instanceof DOMException) throw new Error("This browser could not decode the audio. Try a PCM WAV file.");
    throw error;
  } finally { await context.close(); }
}
