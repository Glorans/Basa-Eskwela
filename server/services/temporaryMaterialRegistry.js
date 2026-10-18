const fs = require("fs/promises");

const temporaryMaterials = new Map();

function registerTemporaryMaterial(material, filePath) {
  if (temporaryMaterials.has(material.id)) {
    throw new Error("Temporary material ID already exists.");
  }

  temporaryMaterials.set(material.id, {
    material: { ...material },
    filePath,
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

module.exports = {
  deleteTemporaryMaterial,
  getTemporaryMaterial,
  registerTemporaryMaterial,
};
