import fs from "node:fs/promises";
import path from "node:path";
import { postsDir } from "../app-config.js";
import { pool, upsertPost } from "../db.js";
import { parseFrontMatter } from "../front-matter.js";
import { closeQueue, queueOnce } from "../jobs.js";

let queued = 0;
let skipped = 0;

for (const filename of (await fs.readdir(postsDir)).filter((f) => f.endsWith(".md")).sort()) {
  const raw = await fs.readFile(path.join(postsDir, filename), "utf8");
  const post = parseFrontMatter(raw, filename);
  const postId = await upsertPost(post.title, post.body, post.expectedLabel);

  if (await queueOnce({ type: "embed_post", postId })) {
    queued += 1;
    console.log(`queued embed_post ${filename} (${post.title})`);
  } else {
    skipped += 1;
    console.log(`skip ${filename} (${post.title})`);
  }
}

console.log(`seed-posts done: queued=${queued} skipped=${skipped}`);
await closeQueue();
await pool.end();
