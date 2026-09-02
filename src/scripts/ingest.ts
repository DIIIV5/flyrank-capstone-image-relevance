import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { imagesDir } from "../app-config.js";
import { pool, upsertImage } from "../db.js";
import { closeQueue, queueOnce } from "../jobs.js";
import { isImageFile } from "../files.js";

let queued = 0;
let skipped = 0;

for (const filename of (await fs.readdir(imagesDir)).filter(isImageFile).sort()) {
  const bytes = await fs.readFile(path.join(imagesDir, filename));
  const contentHash = crypto.createHash("sha256").update(bytes).digest("hex");
  const imageId = await upsertImage(filename, contentHash);

  if (await queueOnce({ type: "embed_image", imageId, filename, contentHash })) {
    queued += 1;
    console.log(`queued embed ${filename}`);
  } else {
    skipped += 1;
  }
}

console.log(`ingest done: queued=${queued} skipped=${skipped}`);
await closeQueue();
await pool.end();
