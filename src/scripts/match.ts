import {
  getPostByTitleOrId,
  pool,
  replaceSuggestions,
} from "../db.js";
import { cosineMin as defaultCosineMin, guardRequireGeminiTags } from "../guard.js";
import { rankForPost, RankError, toSuggestionWrites } from "../rank.js";

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
  similarity: number | null,
  decision: string,
  reason: string,
): void {
  const rankText = rank === null ? "-" : String(rank);
  const labelText = label ?? "none";
  const simText = similarity === null ? "-" : similarity.toFixed(3);
  console.log(`${rankText} / ${filename} / ${labelText} / ${simText} / ${decision} / ${reason}`);
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

try {
  const result = await rankForPost(post, {
    image: args.image,
    cosineMin: args.cosineMin,
    requireTags: args.requireTags,
  });

  console.log(`post ${result.post.id} / ${result.post.title}`);
  for (const row of result.candidates) {
    printRow(row.rank, row.filename, row.label, row.similarity, row.decision, row.reason);
  }
  if (!args.image && result.no_confident_match) {
    printRow(null, "none", null, null, "no_confident_match", result.no_confident_match.reason);
  }

  await replaceSuggestions(post.id, toSuggestionWrites(result, args.image === null));
} catch (error) {
  if (error instanceof RankError) {
    console.error(error.message);
    await pool.end();
    process.exit(1);
  }
  throw error;
}

await pool.end();
