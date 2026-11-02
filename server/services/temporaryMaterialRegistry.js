const fs = require("fs/promises");
const path = require("path");

const temporaryMaterials = new Map();

// An extracted upload waits this long for the teacher to save it; afterwards it is removed.
const TEMPORARY_MATERIAL_TTL_MS = 12 * 60 * 60 * 1000;
const TEMPORARY_CLEANUP_INTERVAL_MS = 15 * 60 * 1000;
// Only names the upload middleware creates (UUID + supported extension) are ever swept.
const TEMPORARY_FILE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|docx|jpg|jpeg|png)$/i;

function registerTemporaryMaterial(material, filePath, now = Date.now()) {
  if (temporaryMaterials.has(material.id)) {
    throw new Error("Temporary material ID already exists.");
  }

  temporaryMaterials.set(material.id, {
    material: { ...material },
    filePath,
    createdAt: now,
  });

  return { ...material };
}

function getTemporaryMaterial(temporaryId) {
  const record = temporaryMaterials.get(temporaryId);
  return record ? { ...record.material } : undefined;
}

async function deleteTemporaryMaterial(temporaryId) {
  const record = temporaryMaterials.get(temporaryId);

  if (!record) {
    return false;
  }

  try {
    await fs.unlink(record.filePath);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  } finally {
    temporaryMaterials.delete(temporaryId);
  }
  return true;
}

/**
 * Removes abandoned temporary uploads: registered ones the teacher never saved, and
 * unregistered files left by a closed browser or a server restart. Saved materials live
 * in Supabase Storage, never in this directory, so they cannot be affected.
 */
async function sweepTemporaryUploads({ directory, now = Date.now(), ttlMs = TEMPORARY_MATERIAL_TTL_MS } = {}) {
  let removed = 0;

  for (const [id, record] of temporaryMaterials) {
    if (now - record.createdAt > ttlMs) {
      await deleteTemporaryMaterial(id).catch(() => undefined);
      removed += 1;
    }
  }

  if (!directory) return removed;

  const registered = new Set([...temporaryMaterials.values()].map((record) => path.resolve(record.filePath)));
  const names = await fs.readdir(directory).catch(() => []);
  for (const name of names) {
    if (!TEMPORARY_FILE_PATTERN.test(name)) continue;
    const filePath = path.join(directory, name);
    if (registered.has(path.resolve(filePath))) continue;
    const stat = await fs.stat(filePath).catch(() => null);
    // Young files may still be uploading or extracting.
    if (!stat?.isFile() || now - stat.mtimeMs <= ttlMs) continue;
    await fs.unlink(filePath).then(() => { removed += 1; }, () => undefined);
  }

  return removed;
}

/** Runs the sweep now and then periodically; returns a stop function. */
function startTemporaryUploadCleanup(directory, { intervalMs = TEMPORARY_CLEANUP_INTERVAL_MS } = {}) {
  const run = () => sweepTemporaryUploads({ directory }).catch((error) => {
    console.error("Temporary upload cleanup failed:", error);
  });
  void run();
  const timer = setInterval(run, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}

module.exports = {
  TEMPORARY_MATERIAL_TTL_MS,
  deleteTemporaryMaterial,
  getTemporaryMaterial,
  registerTemporaryMaterial,
  startTemporaryUploadCleanup,
  sweepTemporaryUploads,
};
