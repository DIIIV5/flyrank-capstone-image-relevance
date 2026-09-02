import { listImagesMissingAnnotation, pool } from "../db.js";
import { closeQueue, queueOnce } from "../jobs.js";

let queued = 0;
let skipped = 0;

for (const image of await listImagesMissingAnnotation()) {
  const spec = {
    type: "annotate_image",
    imageId: image.id,
    filename: image.filename,
    contentHash: image.content_hash,
  } as const;
  if (await queueOnce(spec)) {
    queued += 1;
    console.log(`queued annotate ${image.filename}`);
  } else {
    skipped += 1;
  }
}

console.log(`annotate done: queued=${queued} skipped=${skipped}`);
await closeQueue();
await pool.end();
