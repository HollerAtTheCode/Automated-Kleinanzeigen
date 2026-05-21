import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

dotenv.config();

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export const config = {
  rootDir,
  port: Number(process.env.PORT ?? 5173),
  host: process.env.HOST ?? "127.0.0.1",
  openaiApiKey: process.env.OPENAI_API_KEY,
  openaiModel: process.env.OPENAI_MODEL ?? "gpt-5.1",
  sessionDir: path.resolve(rootDir, process.env.SESSION_DIR ?? ".runtime/sessions"),
  playwrightProfileDir: path.resolve(rootDir, process.env.PLAYWRIGHT_PROFILE_DIR ?? ".runtime/browser-profile")
};
