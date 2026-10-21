const { randomUUID } = require("node:crypto");
const { getSupabaseAdmin } = require("./supabaseAdmin");
const {
  OralReadingPersistenceError,
  getOralReadingAttempt,
  getTeacherOralReadingAttempt,
} = require("./oralReadingAttemptService");

const BUCKET = "oral-reading-recordings";
const MAX_BYTES = 25 * 1024 * 1024;
const MAX_SEGMENTS = 32;
const TYPES = new Set(["audio/webm", "audio/ogg", "audio/mp4", "audio/wav"]);
// Only a genuinely absent table (migration not yet applied) is reported as not installed.
const MISSING_TABLE_CODES = ["42P01", "PGRST205"];

function baseType(file) {
  return String(file?.mimetype ?? "").split(";")[0].trim().toLowerCase();
}

function validateRecordingFiles(files) {
  const invalid = !Array.isArray(files) || !files.length || files.length > MAX_SEGMENTS
    || files.some((file) => !file.buffer?.length || !TYPES.has(baseType(file)))
    || files.reduce((total, file) => total + file.buffer.length, 0) > MAX_BYTES;
  if (invalid) {
    throw new OralReadingPersistenceError("Choose a valid recording of up to 25 MB.", 400, "INVALID_RECORDING");
  }
}

async function loadRecording(supabase, attemptId) {
  const { data, error } = await supabase
    .from("oral_reading_recordings")
    .select("segments")
    .eq("attempt_id", attemptId)
    .maybeSingle();
  if (error && MISSING_TABLE_CODES.includes(error.code)) {
    throw new OralReadingPersistenceError(
      "Recording storage is not installed yet. Your result is saved without its recording.",
      503,
      "RECORDING_STORAGE_UNAVAILABLE",
    );
  }
  if (error) throw new OralReadingPersistenceError("Recording storage is unavailable. Please retry.", 503);
  return data;
}

async function saveOralReadingRecording(requester, attemptId, files, dependencies = {}) {
  // Check ownership before accessing recording storage.
  await (dependencies.getOralReadingAttempt ?? getOralReadingAttempt)(requester, attemptId, dependencies);
  validateRecordingFiles(files);
  const supabase = dependencies.getSupabaseAdmin?.() ?? getSupabaseAdmin();
  // A retry must not replace an existing recording.
  if (await loadRecording(supabase, attemptId)) return;

  const prefix = `${requester.user.id}/${attemptId}/${randomUUID()}`;
  const uploaded = [];
  try {
    for (let index = 0; index < files.length; index++) {
      // Zero-padded names keep storage listings in recorder order; playback uses the saved array.
      const path = `${prefix}/${String(index).padStart(3, "0")}`;
      const { error } = await supabase.storage
        .from(BUCKET)
        .upload(path, files[index].buffer, { contentType: baseType(files[index]), upsert: false });
      if (error) {
        throw new OralReadingPersistenceError(
          "Your result is saved, but its recording could not be uploaded. Retry saving before leaving this page.",
          503,
        );
      }
      uploaded.push(path);
    }
    const { error } = await supabase
      .from("oral_reading_recordings")
      .insert({ attempt_id: attemptId, user_id: requester.user.id, segments: uploaded });
    if (error) {
      // Another retry may already have saved the recording.
      if (error.code === "23505" && (await loadRecording(supabase, attemptId))) {
        await supabase.storage.from(BUCKET).remove(uploaded);
        return;
      }
      throw new OralReadingPersistenceError(
        "Your result is saved, but its recording could not be saved. Retry saving before leaving this page.",
        503,
      );
    }
  } catch (error) {
    if (uploaded.length) await supabase.storage.from(BUCKET).remove(uploaded);
    throw error;
  }
}

async function getOralReadingRecording(requester, attemptId, teacher = false, dependencies = {}) {
  const getAuthorizedAttempt = teacher
    ? dependencies.getTeacherOralReadingAttempt ?? getTeacherOralReadingAttempt
    : dependencies.getOralReadingAttempt ?? getOralReadingAttempt;
  await getAuthorizedAttempt(requester, attemptId, dependencies);
  const supabase = dependencies.getSupabaseAdmin?.() ?? getSupabaseAdmin();
  let recording;
  try {
    recording = await loadRecording(supabase, attemptId);
  } catch (error) {
    if (error.code === "RECORDING_STORAGE_UNAVAILABLE") return { available: false, segments: [] };
    throw error;
  }
  if (!recording) return { available: false, segments: [] };

  const segments = [];
  for (const path of recording.segments) {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 300);
    if (error || !data?.signedUrl) {
      throw new OralReadingPersistenceError("Unable to load recording audio. Please retry.", 503);
    }
    segments.push(data.signedUrl);
  }
  return { available: true, segments, expiresIn: 300 };
}

module.exports = {
  validateRecordingFiles,
  saveOralReadingRecording,
  getOralReadingRecording,
  MAX_BYTES,
  MAX_SEGMENTS,
};
