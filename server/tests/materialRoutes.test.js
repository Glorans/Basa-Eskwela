const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");
const { createCanvas } = require("@napi-rs/canvas");
const express = require("express");
const { createMaterialsRouter, materialUploadDirectory } = require("../routes/materials");
const { terminateOcrWorker } = require("../services/materialOcrService");
const { SupabaseAuthenticationError } = require("../services/supabaseAdmin");

const TEST_USER_ID = "11111111-1111-4111-8111-111111111111";

function createAppForRole(role) {
  const app = express();
  app.use(express.json());
  app.use("/api/materials", createMaterialsRouter({
    authorizeMaterialRequest: async () => {
      if (!role) throw new SupabaseAuthenticationError();
      return { user: { id: TEST_USER_ID }, profile: { id: TEST_USER_ID, role } };
    },
  }));
  return app;
}

async function listen(app) {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

function createTextImage() {
  const canvas = createCanvas(900, 240);
  const context = canvas.getContext("2d");
  context.fillStyle = "white";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "black";
  context.font = "bold 72px Arial";
  context.fillText("READFLOW ROUTE", 75, 145);
  return canvas.toBuffer("image/png");
}

test("uploads an OCR image and deletes only its registered temporary file", async (context) => {
  const { server, baseUrl } = await listen(createAppForRole("general_user"));
  context.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await terminateOcrWorker();
  });
  const corruptFormData = new FormData();
  corruptFormData.append(
    "file",
    new Blob([Buffer.from("not an image")], { type: "image/png" }),
    "corrupt.png",
  );
  corruptFormData.append("title", "Corrupt image");
  corruptFormData.append("language", "en");
  corruptFormData.append("uploaderRole", "teacher");
  const corruptResponse = await fetch(`${baseUrl}/api/materials/upload`, {
    method: "POST",
    body: corruptFormData,
  });
  const corruptBody = await corruptResponse.json();
  assert.equal(corruptResponse.status, 415);
  assert.match(corruptBody.message, /contents do not match/i);
  assert.equal(Object.hasOwn(corruptBody, "stack"), false);

  const formData = new FormData();
  formData.append("file", new Blob([createTextImage()], { type: "image/png" }), "page.png");
  formData.append("title", "Route integration image");
  formData.append("language", "en");
  formData.append("uploaderRole", "admin");

  const uploadResponse = await fetch(`${baseUrl}/api/materials/upload`, {
    method: "POST",
    body: formData,
  });
  const uploadBody = await uploadResponse.json();

  assert.equal(uploadResponse.status, 201);
  assert.equal(uploadBody.material.extractionStatus, "completed");
  assert.match(uploadBody.material.extractedText, /READFLOW ROUTE/i);
  assert.equal(typeof uploadBody.material.ocrConfidence, "number");
  assert.equal(Object.hasOwn(uploadBody.material, "filePath"), false);

  const storedPath = path.join(materialUploadDirectory, uploadBody.material.storedFilename);
  await fs.access(storedPath);

  const deleteResponse = await fetch(`${baseUrl}/api/materials/temporary/${uploadBody.material.id}`, {
    method: "DELETE",
  });
  assert.equal(deleteResponse.status, 200);
  await assert.rejects(fs.access(storedPath), { code: "ENOENT" });

  const repeatedDeleteResponse = await fetch(`${baseUrl}/api/materials/temporary/${uploadBody.material.id}`, {
    method: "DELETE",
  });
  assert.equal(repeatedDeleteResponse.status, 404);
});

for (const [role, expectedStatus] of [
  [undefined, 401],
  ["student", 403],
  ["admin", 403],
  ["teacher", 400],
  ["system_admin", 400],
  ["general_user", 400],
]) {
  test(`${role ?? "unauthenticated"} upload authorization returns ${expectedStatus}`, async (context) => {
    const { server, baseUrl } = await listen(createAppForRole(role));
    context.after(() => new Promise((resolve) => server.close(resolve)));
    const response = await fetch(`${baseUrl}/api/materials/upload`, {
      method: "POST",
      body: new FormData(),
    });
    assert.equal(response.status, expectedStatus);
  });
}
