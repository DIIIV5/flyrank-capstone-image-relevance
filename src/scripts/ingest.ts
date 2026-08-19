import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { imagesDir } from "../config.js";
import { insertOrGetJob, pool, upsertImage } from "../db.js";
import { closeQueue, enqueueImageJob } from "../jobs.js";

const imageExts = new Set([".jpg", ".jpeg", ".png", ".webp"]);

const entries = await fs.readdir(imagesDir);
let queued = 0;
let skipped = 0;

for (const filename of entries.sort()) {
  const ext = path.extname(filename).toLowerCase();
  if (!imageExts.has(ext)) {
    continue;
  }

  const bytes = await fs.readFile(path.join(imagesDir, filename));
  const contentHash = crypto.createHash("sha256").update(bytes).digest("hex");
  const imageId = await upsertImage(filename, contentHash);
  const idempotencyKey = `embed_image:${contentHash}`;
  const job = await insertOrGetJob("embed_image", idempotencyKey);

  if (job.status === "succeeded") {
    skipped += 1;
    continue;
  }

  await enqueueImageJob("embed_image", {
    jobRowId: job.id,
    imageId,
    filename,
    contentHash,
  });
  queued += 1;
  console.log(`queued embed ${filename}`);
}

console.log(`ingest done: queued=${queued} skipped=${skipped}`);
await closeQueue();
await pool.end();
