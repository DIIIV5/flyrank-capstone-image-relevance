import { pool, resetImageEmbeddings } from "../db.js";
import { closeQueue, removeEmbedImageJobs } from "../jobs.js";

const db = await resetImageEmbeddings();
const queue = await removeEmbedImageJobs();
console.log(
  `reset-embed-images: embeddings_deleted=${db.embeddings} jobs_queued=${db.jobs} redis_removed=${queue}`,
);
await closeQueue();
await pool.end();
