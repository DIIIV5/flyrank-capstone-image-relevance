import "dotenv/config";
import path from "node:path";
import { projectRoot } from "./app-config.js";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing env var ${name}. Copy .env.example to .env`);
  }
  return value;
}

export const migrationsDir = path.join(projectRoot, "db", "migrations");

export const databaseUrl = required("DATABASE_URL");
export const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6380";
export const port = Number(process.env.PORT ?? 3000);
export const geminiApiKey = process.env.GEMINI_API_KEY ?? "";
export const geminiModel = process.env.GEMINI_MODEL ?? "gemini-3.7-flash";
export const embedModel = process.env.EMBED_MODEL ?? "jinaai/jina-clip-v2";

/** List price per image, recorded in ai_usage even on the free tier. */
export const geminiImageCostUsd = 0.00002;

export const jobAttempts = 3;
export const jobBackoffMs = 2000;
