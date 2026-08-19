import { insertOrGetJob, listImagesMissingAnnotation, pool } from "../db.js";
import { closeQueue, enqueueImageJob } from "../jobs.js";

const images = await listImagesMissingAnnotation();
let queued = 0;
let skipped = 0;

for (const image of images) {
  const idempotencyKey = `annotate_image:${image.content_hash}`;
  const job = await insertOrGetJob("annotate_image", idempotencyKey);

  if (job.status === "succeeded") {
    skipped += 1;
    continue;
  }

  await enqueueImageJob("annotate_image", {
    jobRowId: job.id,
    imageId: image.id,
    filename: image.filename,
    contentHash: image.content_hash,
  });
  queued += 1;
  console.log(`queued annotate ${image.filename}`);
}

console.log(`annotate done: queued=${queued} skipped=${skipped}`);
await closeQueue();
await pool.end();
