import fs from "node:fs/promises";
import path from "node:path";
import { postsDir } from "../config.js";
import { insertOrGetJob, pool, upsertPost } from "../db.js";
import { closeQueue, enqueuePostJob } from "../jobs.js";
import { IMAGE_LABELS, type ImageLabelName } from "../types.js";

type ParsedPost = {
  filename: string;
  title: string;
  expectedLabel: ImageLabelName | null;
  body: string;
};

function parseFrontMatter(raw: string, filename: string): ParsedPost {
  const text = raw.replace(/^\uFEFF/, "");
  if (!text.startsWith("---")) {
    throw new Error(`${filename} is missing front matter`);
  }
  const end = text.indexOf("\n---", 3);
  if (end === -1) {
    throw new Error(`${filename} has unclosed front matter`);
  }
  const header = text.slice(3, end).trim();
  const body = text.slice(end + 4).replace(/^\r?\n/, "").trim();
  const fields: Record<string, string> = {};
  for (const line of header.split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx === -1) {
      continue;
    }
    fields[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  const title = fields.title;
  if (!title) {
    throw new Error(`${filename} is missing title`);
  }

  const rawLabel = fields.expected_label ?? "";
  let expectedLabel: ImageLabelName | null = null;
  if (rawLabel.length > 0) {
    if (!(IMAGE_LABELS as readonly string[]).includes(rawLabel)) {
      throw new Error(`${filename} has unknown expected_label ${rawLabel}`);
    }
    expectedLabel = rawLabel as ImageLabelName;
  }

  return { filename, title, expectedLabel, body };
}

const entries = await fs.readdir(postsDir);
const files = entries.filter((name) => name.endsWith(".md")).sort();
let queued = 0;
let skipped = 0;

for (const filename of files) {
  const raw = await fs.readFile(path.join(postsDir, filename), "utf8");
  const parsed = parseFrontMatter(raw, filename);
  const postId = await upsertPost(parsed.title, parsed.body, parsed.expectedLabel);
  const idempotencyKey = `embed_post:${postId}`;
  const job = await insertOrGetJob("embed_post", idempotencyKey);

  if (job.status === "succeeded") {
    skipped += 1;
    console.log(`skip ${filename} (${parsed.title})`);
    continue;
  }

  await enqueuePostJob({ jobRowId: job.id, postId });
  queued += 1;
  console.log(`queued embed_post ${filename} (${parsed.title})`);
}

console.log(`seed-posts done: queued=${queued} skipped=${skipped}`);
await closeQueue();
await pool.end();
