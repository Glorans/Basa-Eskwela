"use strict";
const { LIMITS, LabError } = require("./contracts");

// Inspect the container rather than trusting a filename, MIME type or client duration.
function validateAudio(buffer) {
  const bad = () => { throw new LabError("INVALID_AUDIO", "Use a valid mono 16-bit PCM WAV file."); };
  if (!Buffer.isBuffer(buffer) || buffer.length < 44) bad();
  if (buffer.length > LIMITS.maxAudioBytes) throw new LabError("AUDIO_TOO_LARGE", "Audio exceeds 10 MB.", 413);
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE" || buffer.readUInt32LE(4) + 8 !== buffer.length) bad();
  let format, dataBytes;
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const tag = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (start + size > buffer.length) bad();
    if (tag === "fmt ") {
      if (format || size < 16) bad();
      format = { encoding: buffer.readUInt16LE(start), channels: buffer.readUInt16LE(start + 2), sampleRate: buffer.readUInt32LE(start + 4), byteRate: buffer.readUInt32LE(start + 8), blockAlign: buffer.readUInt16LE(start + 12), bits: buffer.readUInt16LE(start + 14) };
    }
    if (tag === "data") { if (dataBytes !== undefined) bad(); dataBytes = size; }
    offset = start + size + (size % 2);
  }
  if (offset !== buffer.length || !format || !dataBytes || format.encoding !== 1 || format.channels !== 1 || format.bits !== 16 || format.sampleRate < 8000 || format.sampleRate > 96000 || format.byteRate !== format.sampleRate * 2 || format.blockAlign !== 2 || dataBytes % 2) bad();
  const durationSeconds = dataBytes / format.byteRate;
  if (durationSeconds > LIMITS.maxDurationSeconds) throw new LabError("AUDIO_TOO_LONG", "Audio exceeds the Phase 1 limit of 30 seconds.");
  return { durationSeconds, sampleRate: format.sampleRate, channels: 1, format: "pcm_s16le_wav", bytes: buffer.length };
}
module.exports = { validateAudio };
