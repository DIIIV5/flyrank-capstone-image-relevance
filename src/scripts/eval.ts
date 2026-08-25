import fs from "node:fs/promises";
import { z } from "zod";
import { cosineMin as defaultCosineMin } from "../guard.js";
import { matchingGoldPath } from "../config.js";
import { getPostByTitleOrId, pool } from "../db.js";
import { RankError, rankForPost } from "../rank.js";

const LabelRowSchema = z.object({
  post: z.string().min(1),
  image: z.string().min(1).nullable(),
});

const LabelFileSchema = z.array(LabelRowSchema);

const cosineFloors = [...new Set([0.2, 0.22, defaultCosineMin, 0.28, 0.3])].sort(
  (a, b) => a - b,
);

function topSuggested(filenames: { filename: string; decision: string }[]): string | null {
  const hit = filenames.find((row) => row.decision === "suggested");
  return hit?.filename ?? null;
}

const raw = await fs.readFile(matchingGoldPath, "utf8");
const rows = LabelFileSchema.parse(JSON.parse(raw));

let hits = 0;
let n = 0;
const floorHits = new Map<number, number>(cosineFloors.map((floor) => [floor, 0]));

for (const row of rows) {
  n += 1;
  const post = await getPostByTitleOrId(row.post);
  if (!post) {
    console.log(`${row.post}: FAIL post not found`);
    continue;
  }

  let result;
  try {
    result = await rankForPost(post);
  } catch (error) {
    if (error instanceof RankError && error.code === "no_embedding") {
      console.log(`${row.post}: FAIL ${error.message}`);
      continue;
    }
    throw error;
  }

  const suggested = topSuggested(result.candidates);
  let ok = false;
  if (row.image === null) {
    ok = result.no_confident_match !== null;
  } else {
    ok = suggested === row.image;
  }

  if (ok) {
    hits += 1;
  }
  const got = row.image === null
    ? (result.no_confident_match ? "no_confident_match" : suggested ?? "none")
    : (suggested ?? result.no_confident_match?.reason ?? "none");
  console.log(`${row.post}: ${ok ? "ok" : "miss"} (got ${got})`);

  for (const floor of cosineFloors) {
    if (floor === defaultCosineMin) {
      if (ok) {
        floorHits.set(floor, (floorHits.get(floor) ?? 0) + 1);
      }
      continue;
    }
    const swept = await rankForPost(post, { cosineMin: floor });
    const sweptName = topSuggested(swept.candidates);
    const sweptOk =
      row.image === null ? swept.no_confident_match !== null : sweptName === row.image;
    if (sweptOk) {
      floorHits.set(floor, (floorHits.get(floor) ?? 0) + 1);
    }
  }
}

const pct = n === 0 ? 0 : Math.round((1000 * hits) / n) / 10;
console.log(`Top-1 precision: ${pct}% on ${n} labeled posts`);
console.log("cosine sweep:");
for (const floor of cosineFloors) {
  const count = floorHits.get(floor) ?? 0;
  const floorPct = n === 0 ? 0 : Math.round((1000 * count) / n) / 10;
  console.log(`  ${floor.toFixed(2)} → ${floorPct}% (${count}/${n})`);
}

await pool.end();
