import { loadJina } from "../ai/jina.js";
import { pool } from "../db.js";
import { startWorker } from "../jobs.js";

console.log("loading Jina CLIP v2 (first run downloads weights)...");
await loadJina();
console.log("Jina CLIP v2 ready");

const worker = await startWorker();

async function shutdown(): Promise<void> {
  await worker.close();
  await pool.end();
  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdown();
});
process.on("SIGTERM", () => {
  void shutdown();
});
