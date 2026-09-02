import fs from "node:fs/promises";
import { z } from "zod";
import { cosineMin, matchingGoldPath } from "../app-config.js";
import { getPostByTitleOrId, pool } from "../db.js";
import { RankError, type RankResult } from "../rank-result.js";
import { rankForPost } from "../rank.js";

// Each row names a post and the library file that should rank first, or null for no match.
const GoldSchema = z.array(
  z.object({
    post: z.string().min(1),
    image: z.string().min(1).nullable(),
  }),
);

const floors = [...new Set([0.2, 0.22, cosineMin, 0.28, 0.3])].sort((a, b) => a - b);

function topSuggested(result: RankResult): string | null {
  return result.candidates.find((row) => row.decision === "suggested")?.filename ?? null;
}

function isHit(expected: string | null, result: RankResult): boolean {
  return expected === null ? result.no_confident_match !== null : topSuggested(result) === expected;
}

function percent(count: number, total: number): string {
  return total === 0 ? "0" : (Math.round((1000 * count) / total) / 10).toString();
}

const rows = GoldSchema.parse(JSON.parse(await fs.readFile(matchingGoldPath, "utf8")));
const hitsByFloor = new Map(floors.map((floor) => [floor, 0]));

for (const row of rows) {
  const post = await getPostByTitleOrId(row.post);
  if (!post) {
    console.log(`${row.post}: FAIL post not found`);
    continue;
  }
  try {
    for (const floor of floors) {
      const result = await rankForPost(post, { cosineMin: floor });
      const hit = isHit(row.image, result);
      if (hit) {
        hitsByFloor.set(floor, (hitsByFloor.get(floor) ?? 0) + 1);
      }
      if (floor === cosineMin) {
        const got = topSuggested(result) ?? result.no_confident_match?.reason ?? "none";
        console.log(`${row.post}: ${hit ? "ok" : "miss"} (got ${got})`);
      }
    }
  } catch (error) {
    if (error instanceof RankError) {
      console.log(`${row.post}: FAIL ${error.message}`);
      continue;
    }
    throw error;
  }
}

const precision = percent(hitsByFloor.get(cosineMin) ?? 0, rows.length);
console.log(`Top-1 precision: ${precision}% on ${rows.length} labeled posts`);
console.log("cosine sweep:");
for (const floor of floors) {
  const hits = hitsByFloor.get(floor) ?? 0;
  console.log(`  ${floor.toFixed(2)} → ${percent(hits, rows.length)}% (${hits}/${rows.length})`);
}

await pool.end();
