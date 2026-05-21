import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isSafeSessionCleanupPath } from "../src/server/sessionStore.js";

const rootDir = "/tmp/automated-kleinanzeigen-project";

describe("session cleanup safety", () => {
  it("allows the project runtime sessions directory", () => {
    expect(isSafeSessionCleanupPath(path.join(rootDir, ".runtime", "sessions"), rootDir)).toBe(true);
  });

  it("allows Kleinanzeigen-specific temp fallback directories", () => {
    expect(isSafeSessionCleanupPath(path.join(os.tmpdir(), "kleinanzeigen-draft-assistant"), rootDir)).toBe(true);
  });

  it("refuses broad destructive cleanup paths", () => {
    expect(isSafeSessionCleanupPath("/", rootDir)).toBe(false);
    expect(isSafeSessionCleanupPath(rootDir, rootDir)).toBe(false);
    expect(isSafeSessionCleanupPath(path.join(os.tmpdir(), "unrelated"), rootDir)).toBe(false);
  });
});
