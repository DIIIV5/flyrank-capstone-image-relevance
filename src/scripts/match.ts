import { embedModel } from "../config.js";
import {
  getEmbedding,
  getImageByFilename,
  getPostByTitleOrId,
  listImageCandidates,
  pool,
  replaceSuggestions,
  type ImageCandidate,
  type SuggestionWrite,
} from "../db.js";
import {
  cosineMin as defaultCosineMin,
  guard,
  guardRequireGeminiTags,
} from "../guard.js";
import { cosine, rankByCosine } from "../similarity.js";

type Args = {
  post: string;
  image: string | null;
  cosineMin: number;
  requireTags: boolean;
};

function takeValue(arg: string, prefix: string, argv: string[], index: number): { value: string; skip: number } | null {
  if (arg.startsWith(`${prefix}=`)) {
    return { value: arg.slice(prefix.length + 1), skip: 0 };
  }
  if (arg === prefix) {
    return { value: argv[index + 1] ?? "", skip: 1 };
  }
  return null;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    post: "",
    image: null,
    cosineMin: defaultCosineMin,
    requireTags: guardRequireGeminiTags,
  };

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i] ?? "";
    const post = takeValue(flag, "--post", argv, i);
    if (post) {
      args.post = post.value;
      i += post.skip;
      continue;
    }
    const image = takeValue(flag, "--image", argv, i) ?? takeValue(flag, "--img", argv, i);
    if (image) {
      args.image = image.value;
      i += image.skip;
      continue;
    }
    const cosine = takeValue(flag, "--cosine-min", argv, i);
    if (cosine) {
      args.cosineMin = Number(cosine.value);
      i += cosine.skip;
      continue;
    }
    if (flag === "--require-tags") {
      args.requireTags = true;
      continue;
    }
    if (flag === "--require-tags=false") {
      args.requireTags = false;
      continue;
    }
    if (!flag.startsWith("-") && !args.post) {
      args.post = flag;
      continue;
    }
    if (!flag.startsWith("-") && !args.image && /\.(jpe?g|png|webp)$/i.test(flag)) {
      args.image = flag;
    }
  }

  return args;
}

function printRow(
  rank: number | null,
  filename: string,
  label: string | null,
  similarity: number,
  decision: string,
  reason: string,
): void {
  const rankText = rank === null ? "-" : String(rank);
  const labelText = label ?? "none";
  console.log(
    `${rankText} / ${filename} / ${labelText} / ${similarity.toFixed(3)} / ${decision} / ${reason}`,
  );
}

function toSuggestion(
  image: ImageCandidate | null,
  rank: number | null,
  similarity: number | null,
  decision: SuggestionWrite["decision"],
  reason: string,
): SuggestionWrite {
  return {
    imageId: image?.id ?? null,
    rank,
    similarity,
    decision,
    reason,
  };
}

const args = parseArgs(process.argv.slice(2));
if (!args.post) {
  console.error("usage: npm run match -- <id-or-slug> [image-filename]");
  await pool.end();
  process.exit(1);
}

const post = await getPostByTitleOrId(args.post);
if (!post) {
  console.error(`post not found: ${args.post}`);
  await pool.end();
  process.exit(1);
}

const postVector = await getEmbedding("post", post.id, embedModel);
if (!postVector) {
  console.error(`post has no embedding: ${post.title}`);
  await pool.end();
  process.exit(1);
}

console.log(`post ${post.id} / ${post.title}`);

const writes: SuggestionWrite[] = [];

if (args.image) {
  const image = await getImageByFilename(args.image, embedModel);
  if (!image) {
    console.error(`image not found: ${args.image}`);
    await pool.end();
    process.exit(1);
  }

  const similarity = cosine(postVector, image.vector);
  const result = guard({
    expectedLabel: post.expected_label,
    similarity,
    cosineMin: args.cosineMin,
    requireGeminiTags: args.requireTags,
    image,
  });
  printRow(1, image.filename, image.label, similarity, result.decision, result.reason);
  writes.push(toSuggestion(image, 1, similarity, result.decision, result.reason));
} else {
  const candidates = await listImageCandidates(embedModel);
  const ranked = rankByCosine(postVector, candidates).slice(0, 3);
  for (const candidate of ranked) {
    const result = guard({
      expectedLabel: post.expected_label,
      similarity: candidate.similarity,
      cosineMin: args.cosineMin,
      requireGeminiTags: args.requireTags,
      image: candidate,
    });
    printRow(
      candidate.rank,
      candidate.filename,
      candidate.label,
      candidate.similarity,
      result.decision,
      result.reason,
    );
    writes.push(
      toSuggestion(candidate, candidate.rank, candidate.similarity, result.decision, result.reason),
    );
  }

  if (!writes.some((row) => row.decision === "suggested")) {
    const reasons = writes.map((row) => row.reason).join("; ");
    const reason = reasons
      ? `no confident match: ${reasons}`
      : "no confident match: no image embeddings";
    console.log(`- / none / none / - / no_confident_match / ${reason}`);
    writes.push(toSuggestion(null, null, null, "no_confident_match", reason));
  }
}

await replaceSuggestions(post.id, writes);
await pool.end();
