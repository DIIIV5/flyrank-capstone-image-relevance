import { pool, resetImageEmbeddings } from "../db.js";
import { closeQueue, removeEmbedImageJobs } from "../jobs.js";

const db = await resetImageEmbeddings();
const redis = await removeEmbedImageJobs();
console.log(
  `reset-embed-images: embeddings_deleted=${db.embeddings}`,
  `jobs_queued=${db.jobs} redis_removed=${redis}`,
);
await closeQueue();
await pool.end();
