import { embedModel } from "./config.js";
import { getEmbedding, getImageByFilename, listImageCandidates } from "./db.js";
import { defaultGuardRules, guard } from "./guard.js";
import {
  RankError,
  noConfidentMatch,
  type RankCandidate,
  type RankOpts,
  type RankResult,
} from "./rank-result.js";
import { rankByCosine } from "./similarity.js";
import type { ImageCandidate, PostRow } from "./types.js";

const TOP_N = 3;

async function loadCandidates(image: string | null | undefined): Promise<ImageCandidate[]> {
  if (!image) {
    return listImageCandidates(embedModel);
  }
  const single = await getImageByFilename(image, embedModel);
  if (!single) {
    throw new RankError("image_not_found", `image not found: ${image}`);
  }
  return [single];
}

export async function rankForPost(post: PostRow, opts: RankOpts = {}): Promise<RankResult> {
  const postVector = await getEmbedding("post", post.id, embedModel);
  if (!postVector) {
    throw new RankError("no_embedding", `post has no embedding: ${post.title}`);
  }

  const rules = {
    ...defaultGuardRules,
    cosineMin: opts.cosineMin ?? defaultGuardRules.cosineMin,
    requireSubject: opts.requireSubject ?? defaultGuardRules.requireSubject,
  };

  const images = await loadCandidates(opts.image);
  const candidates: RankCandidate[] = rankByCosine(postVector, images)
    .slice(0, TOP_N)
    .map((image) => ({
      imageId: image.id,
      filename: image.filename,
      label: image.label,
      similarity: image.similarity,
      rank: image.rank,
      caption: image.caption,
      ...guard({ expectedLabel: post.expected_label, similarity: image.similarity, image }, rules),
    }));

  return {
    post: { id: post.id, title: post.title },
    candidates,
    no_confident_match: noConfidentMatch(candidates),
  };
}
