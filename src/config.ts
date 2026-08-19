import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export const projectRoot = path.resolve(here, "..");
export const imagesDir = path.join(projectRoot, "data", "images");
export const migrationsDir = path.join(projectRoot, "db", "migrations");

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing env var ${name}. Copy .env.example to .env`);
  }
  return value;
}

export const databaseUrl = required("DATABASE_URL");
export const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
export const geminiApiKey = process.env.GEMINI_API_KEY ?? "";
export const geminiModel = process.env.GEMINI_MODEL ?? "gemini-2.0-flash";
export const embedModel = process.env.EMBED_MODEL ?? "jinaai/jina-clip-v2";

export const labelScoreMin = 0.7;
export const labelMarginMin = 0.15;

/** List price used for ai_usage even on the free tier (one image / call). */
export const geminiImageCostUsd = 0.00002;

export const jobAttempts = 3;
export const jobBackoffMs = 2000;
