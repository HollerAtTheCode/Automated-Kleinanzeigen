import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import type { ComparableListing, ListingDraft, ProductAnalysis, SessionState, UploadedImage } from "../shared/types.js";
import { config } from "./config.js";
import { parseSessionId } from "./validators.js";

export type StoredUploadedImage = UploadedImage & { path: string };
export type StoredSessionState = Omit<SessionState, "images"> & { images: StoredUploadedImage[] };

const sessions = new Map<string, StoredSessionState>();

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

export function publicSession(session: StoredSessionState): SessionState {
  return {
    ...session,
    images: session.images.map(({ path: _path, ...image }) => image)
  };
}

export async function createSession(): Promise<StoredSessionState> {
  await ensureDir(config.sessionDir);
  const id = crypto.randomUUID();
  const sessionPath = path.join(config.sessionDir, id);
  await ensureDir(sessionPath);
  const session: StoredSessionState = {
    id,
    createdAt: new Date().toISOString(),
    images: [],
    comparables: []
  };
  sessions.set(id, session);
  return session;
}

export function getSession(id: string): StoredSessionState {
  const safeId = parseSessionId(id);
  const session = sessions.get(safeId);
  if (!session) {
    throw Object.assign(new Error("Session not found"), { statusCode: 404 });
  }
  return session;
}

export function addImages(id: string, images: StoredUploadedImage[]) {
  const session = getSession(id);
  session.images.push(...images);
  return session;
}

export function setAnalysis(id: string, analysis: ProductAnalysis) {
  const session = getSession(id);
  session.analysis = analysis;
  return session;
}

export function setComparables(id: string, comparables: ComparableListing[]) {
  const session = getSession(id);
  session.comparables = comparables;
  return session;
}

export function setDraft(id: string, draft: ListingDraft) {
  const session = getSession(id);
  session.draft = draft;
  return session;
}

export async function sessionUploadDir(id: string) {
  const session = getSession(id);
  const dir = path.join(config.sessionDir, session.id, "images");
  await ensureDir(dir);
  return dir;
}

export function isSafeSessionCleanupPath(targetPath: string, rootDir = config.rootDir) {
  const resolved = path.resolve(targetPath);
  const root = path.resolve(rootDir);
  const tempRoot = path.resolve(os.tmpdir());
  const relativeToRoot = path.relative(root, resolved);
  const relativeToTemp = path.relative(tempRoot, resolved);
  const isInsideProjectRuntime =
    Boolean(relativeToRoot) && !relativeToRoot.startsWith("..") && !path.isAbsolute(relativeToRoot) && relativeToRoot.startsWith(".runtime");
  const isInsideTemp =
    Boolean(relativeToTemp) && !relativeToTemp.startsWith("..") && !path.isAbsolute(relativeToTemp) && resolved.includes("kleinanzeigen");

  return resolved !== path.parse(resolved).root && resolved !== root && (isInsideProjectRuntime || isInsideTemp);
}

export async function cleanupSessionData() {
  if (!isSafeSessionCleanupPath(config.sessionDir)) {
    throw new Error(`Refusing to remove unsafe SESSION_DIR: ${config.sessionDir}`);
  }
  await fs.rm(config.sessionDir, { recursive: true, force: true });
}

export function tempFallbackDir() {
  return path.join(os.tmpdir(), "kleinanzeigen-draft-assistant");
}

process.once("SIGINT", async () => {
  await cleanupSessionData();
  process.exit(130);
});

process.once("SIGTERM", async () => {
  await cleanupSessionData();
  process.exit(143);
});
