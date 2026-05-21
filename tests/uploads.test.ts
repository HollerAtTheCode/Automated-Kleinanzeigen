import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { acceptsDeclaredImageType, assertValidUploadedImages, safeImageExtension } from "../src/server/uploads.js";

async function tempUpload(name: string, content: Buffer, mimeType: string) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "upload-test-"));
  const filePath = path.join(dir, name);
  await fs.writeFile(filePath, content);
  return {
    fieldname: "images",
    originalname: name,
    encoding: "7bit",
    mimetype: mimeType,
    destination: dir,
    filename: name,
    path: filePath,
    size: content.length,
    stream: undefined as never,
    buffer: content
  };
}

describe("upload hardening", () => {
  it("allows only raster image MIME types", () => {
    expect(acceptsDeclaredImageType("image/jpeg")).toBe(true);
    expect(acceptsDeclaredImageType("image/svg+xml")).toBe(false);
    expect(acceptsDeclaredImageType("text/html")).toBe(false);
  });

  it("normalizes stored extensions from MIME type", () => {
    expect(safeImageExtension("payload.html", "image/png")).toBe(".png");
    expect(safeImageExtension("photo.jpeg", "image/jpeg")).toBe(".jpg");
    expect(safeImageExtension("vector.svg", "image/svg+xml")).toBe("");
  });

  it("rejects spoofed image uploads and removes the uploaded file", async () => {
    const file = await tempUpload("not-really.png", Buffer.from("<script>alert(1)</script>"), "image/png");

    await expect(assertValidUploadedImages([file])).rejects.toThrow(/Only valid/);
    await expect(fs.stat(file.path)).rejects.toThrow();
  });

  it("accepts valid PNG signatures", async () => {
    const file = await tempUpload("image.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]), "image/png");

    await expect(assertValidUploadedImages([file])).resolves.toBeUndefined();
  });
});
