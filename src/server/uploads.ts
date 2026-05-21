import fs from "node:fs/promises";
import path from "node:path";
import type { Express } from "express";

const allowedImageTypes = new Map<string, readonly number[][]>([
  ["image/jpeg", [[0xff, 0xd8, 0xff]]],
  ["image/png", [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]]],
  ["image/gif", [[0x47, 0x49, 0x46, 0x38, 0x37, 0x61], [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]]],
  ["image/webp", [[0x52, 0x49, 0x46, 0x46]]],
  ["image/avif", [[0x00, 0x00, 0x00]]]
]);

const extensionByType = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/gif", ".gif"],
  ["image/webp", ".webp"],
  ["image/avif", ".avif"]
]);

function hasSignature(buffer: Buffer, signatures: readonly number[][], mimeType: string) {
  if (mimeType === "image/webp") {
    return buffer.subarray(0, 4).equals(Buffer.from("RIFF")) && buffer.subarray(8, 12).equals(Buffer.from("WEBP"));
  }
  if (mimeType === "image/avif") {
    return buffer.subarray(4, 8).equals(Buffer.from("ftyp")) && buffer.subarray(8, 12).toString("ascii").startsWith("avif");
  }
  return signatures.some((signature) => signature.every((byte, index) => buffer[index] === byte));
}

export function safeImageExtension(originalName: string, mimeType: string): string {
  const expected = extensionByType.get(mimeType);
  if (!expected) return "";
  const extension = path.extname(originalName).toLowerCase();
  return extension === ".jpeg" && expected === ".jpg" ? ".jpg" : expected;
}

export function acceptsDeclaredImageType(mimeType: string): boolean {
  return allowedImageTypes.has(mimeType);
}

export async function assertValidUploadedImages(files: Express.Multer.File[]) {
  const invalidFiles: string[] = [];

  for (const file of files) {
    const signatures = allowedImageTypes.get(file.mimetype);
    if (!signatures) {
      invalidFiles.push(file.originalname);
      continue;
    }

    const header = await fs.readFile(file.path).then((buffer) => buffer.subarray(0, 16));
    if (!hasSignature(header, signatures, file.mimetype)) {
      invalidFiles.push(file.originalname);
    }
  }

  if (invalidFiles.length > 0) {
    await Promise.allSettled(files.map((file) => fs.rm(file.path, { force: true })));
    throw Object.assign(new Error("Only valid JPEG, PNG, GIF, WebP, or AVIF images are accepted."), { statusCode: 400 });
  }
}
