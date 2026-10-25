const { SpeechTranscriptionError } = require("./speechErrors");

// Azure receives mono 16 kHz signed 16-bit PCM. The browser converts each
// recorded part (at most 25 s plus the recorder's final chunk) to this WAV
// format; the container is inspected here rather than trusting the MIME type.
// Adapted from the tested Speech Lab validator (experiments/speech-lab/audioValidation.js).
const SPEECH_SAMPLE_RATE = 16000;
const MAX_PART_SECONDS = 30;
// M5 sends one WAV of the whole read-aloud. The recorder stops at 300 s; the
// margin covers the encoder's final frames. 305 s of PCM (about 9.8 MB) fits
// within MAX_WAV_BYTES.
const MAX_WHOLE_RECORDING_SECONDS = 305;
const MAX_WAV_BYTES = 10 * 1024 * 1024;

function invalid() {
  return new SpeechTranscriptionError("STT_INVALID_AUDIO");
}

/** Returns the PCM data location and duration, or throws a safe error. */
function readSpeechWav(buffer, { maxSeconds = MAX_PART_SECONDS } = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 44) throw invalid();
  if (buffer.length > MAX_WAV_BYTES) throw new SpeechTranscriptionError("AUDIO_TOO_LONG");
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE"
    || buffer.readUInt32LE(4) + 8 !== buffer.length) throw invalid();
  let format;
  let dataOffset;
  let dataBytes;
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const tag = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (start + size > buffer.length) throw invalid();
    if (tag === "fmt ") {
      if (format || size < 16) throw invalid();
      format = {
        encoding: buffer.readUInt16LE(start), channels: buffer.readUInt16LE(start + 2),
        sampleRate: buffer.readUInt32LE(start + 4), byteRate: buffer.readUInt32LE(start + 8),
        blockAlign: buffer.readUInt16LE(start + 12), bits: buffer.readUInt16LE(start + 14),
      };
    }
    if (tag === "data") {
      if (dataBytes !== undefined) throw invalid();
      dataBytes = size;
      dataOffset = start;
    }
    offset = start + size + (size % 2);
  }
  if (offset !== buffer.length || !format || !dataBytes || format.encoding !== 1 || format.channels !== 1
    || format.bits !== 16 || format.sampleRate !== SPEECH_SAMPLE_RATE || format.byteRate !== SPEECH_SAMPLE_RATE * 2
    || format.blockAlign !== 2 || dataBytes % 2) throw invalid();
  const durationSeconds = dataBytes / format.byteRate;
  if (durationSeconds > maxSeconds) throw new SpeechTranscriptionError("AUDIO_TOO_LONG");
  return { dataOffset, dataBytes, durationSeconds };
}

/** Copies exactly the PCM data chunk (no RIFF header, no Buffer-pool padding). */
function wavPcmArrayBuffer(buffer, wav) {
  return Uint8Array.from(buffer.subarray(wav.dataOffset, wav.dataOffset + wav.dataBytes)).buffer;
}

module.exports = {
  MAX_PART_SECONDS, MAX_WAV_BYTES, MAX_WHOLE_RECORDING_SECONDS, SPEECH_SAMPLE_RATE, readSpeechWav, wavPcmArrayBuffer,
};
