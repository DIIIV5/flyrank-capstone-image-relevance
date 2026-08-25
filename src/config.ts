import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

export {
  catchAll,
  checkFlagged,
  cosineMin,
  evalDir,
  imagesDir,
  isConfiguredLabel,
  labelEvalDirs,
  labelMarginMin,
  labelPrompts,
  labelScoreMin,
  labels,
  matchingGoldPath,
  parseAppConfig,
  postsDir,
  projectRoot,
  promptForLabel,
  scoreScale,
  softmaxTemperature,
} from "./app-config.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const migrationsDir = path.join(path.resolve(here, ".."), "db", "migrations");

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing env var ${name}. Copy .env.example to .env`);
  }
  return value;
}

export const databaseUrl = required("DATABASE_URL");
export const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6380";
export const port = Number(process.env.PORT ?? 3000);
export const geminiApiKey = process.env.GEMINI_API_KEY ?? "";
export const geminiModel = process.env.GEMINI_MODEL ?? "gemini-3.7-flash";
export type GeminiThinkingLevel = "minimal" | "low" | "medium" | "high";
/** gemini-3.7-flash rejects MINIMAL (HTTP 400). */
export const geminiThinkingLevel: GeminiThinkingLevel = "low";
export const embedModel = process.env.EMBED_MODEL ?? "jinaai/jina-clip-v2";

/** List price used for ai_usage even on the free tier (one image / call). */
export const geminiImageCostUsd = 0.00002;

export const jobAttempts = 3;
export const jobBackoffMs = 2000;
