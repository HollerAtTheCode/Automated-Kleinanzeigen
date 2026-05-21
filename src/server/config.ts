import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

dotenv.config();

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const host = process.env.HOST ?? "127.0.0.1";

export function isLoopbackHost(value: string): boolean {
  return value === "localhost" || value === "127.0.0.1" || value === "::1";
}

if (!isLoopbackHost(host) && process.env.ALLOW_NON_LOOPBACK_HOST !== "true") {
  throw new Error("Refusing to bind to a non-loopback HOST without ALLOW_NON_LOOPBACK_HOST=true.");
}

export const config = {
  rootDir,
  port: Number(process.env.PORT ?? 5173),
  host,
  openaiModel: process.env.OPENAI_MODEL ?? "gpt-5.1",
  sessionDir: path.resolve(rootDir, process.env.SESSION_DIR ?? ".runtime/sessions"),
  playwrightProfileDir: path.resolve(rootDir, process.env.PLAYWRIGHT_PROFILE_DIR ?? ".runtime/browser-profile")
};

let runtimeOpenaiApiKey = process.env.OPENAI_API_KEY?.trim() || "";

export function getOpenaiApiKey() {
  return runtimeOpenaiApiKey;
}

export function hasOpenaiApiKey() {
  return runtimeOpenaiApiKey.length > 0;
}

export function setRuntimeOpenaiApiKey(value: string) {
  const key = value.trim();
  if (key.length < 20) {
    throw Object.assign(new Error("Der OpenAI API-Key ist zu kurz."), { statusCode: 400 });
  }
  runtimeOpenaiApiKey = key;
}
