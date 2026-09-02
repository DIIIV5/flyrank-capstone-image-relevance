import { getPostByTitleOrId, pool, replaceSuggestions } from "../db.js";
import { RankError, toSuggestionWrites } from "../rank-result.js";
import { rankForPost } from "../rank.js";

// usage: npm run match -- <post> [image-filename] [--require-tags]
const argv = process.argv.slice(2);
const requireSubject = argv.includes("--require-tags");
const [postQuery, image = null] = argv.filter((arg) => !arg.startsWith("--"));

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

if (!postQuery) {
  fail("usage: npm run match -- <post> [image-filename] [--require-tags]");
}
const post = (await getPostByTitleOrId(postQuery)) ?? fail(`post not found: ${postQuery}`);

try {
  const result = await rankForPost(post, { image, requireSubject });
  console.log(`post ${result.post.id} / ${result.post.title}`);
  for (const row of result.candidates) {
    const cells = [
      row.rank,
      row.filename,
      row.label ?? "none",
      row.similarity.toFixed(3),
      row.decision,
      row.reason,
    ];
    console.log(cells.join(" / "));
  }
  if (result.no_confident_match) {
    console.log(`- / none / - / - / no_confident_match / ${result.no_confident_match.reason}`);
  }
  await replaceSuggestions(post.id, toSuggestionWrites(result, image === null));
} catch (error) {
  if (error instanceof RankError) {
    fail(error.message);
  }
  throw error;
}

await pool.end();
