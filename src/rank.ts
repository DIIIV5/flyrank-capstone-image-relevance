import { embedModel } from "./config.js";
import {
  getEmbedding,
  getImageByFilename,
  listImageCandidates,
  type PostRow,
} from "./db.js";
import {
  cosineMin as defaultCosineMin,
  guard,
  guardRequireGeminiTags,
} from "./guard.js";
import {
  RankError,
  type RankCandidate,
  type RankOpts,
  type RankResult,
} from "./rank-result.js";
import { cosine, rankByCosine } from "./similarity.js";

export {
  RankError,
  toRankJson,
  toSuggestionWrites,
  type RankCandidate,
  type RankOpts,
  type RankResult,
} from "./rank-result.js";

export async function rankForPost(post: PostRow, opts: RankOpts = {}): Promise<RankResult> {
  const cosineMin = opts.cosineMin ?? defaultCosineMin;
  const requireTags = opts.requireTags ?? guardRequireGeminiTags;

  const postVector = await getEmbedding("post", post.id, embedModel);
  if (!postVector) {
    throw new RankError("no_embedding", `post has no embedding: ${post.title}`);
  }

  const candidates: RankCandidate[] = [];

  if (opts.image) {
    const image = await getImageByFilename(opts.image, embedModel);
    if (!image) {
      throw new RankError("image_not_found", `image not found: ${opts.image}`);
    }

    const similarity = cosine(postVector, image.vector);
    const result = guard({
      expectedLabel: post.expected_label,
      similarity,
      cosineMin,
      requireGeminiTags: requireTags,
      image,
    });
    candidates.push({
      imageId: image.id,
      filename: image.filename,
      label: image.label,
      similarity,
      rank: 1,
      decision: result.decision,
      reason: result.reason,
      caption: image.caption,
    });
  } else {
    const images = await listImageCandidates(embedModel);
    const ranked = rankByCosine(postVector, images).slice(0, 3);
    for (const candidate of ranked) {
      const result = guard({
        expectedLabel: post.expected_label,
        similarity: candidate.similarity,
        cosineMin,
        requireGeminiTags: requireTags,
        image: candidate,
      });
      candidates.push({
        imageId: candidate.id,
        filename: candidate.filename,
        label: candidate.label,
        similarity: candidate.similarity,
        rank: candidate.rank,
        decision: result.decision,
        reason: result.reason,
        caption: candidate.caption,
      });
    }
  }

  const suggested = candidates.some((row) => row.decision === "suggested");
  let noMatch: { reason: string } | null = null;
  if (!suggested) {
    const reasons = candidates.map((row) => row.reason).join("; ");
    noMatch = {
      reason: reasons
        ? `no confident match: ${reasons}`
        : "no confident match: no image embeddings",
    };
  }

  return {
    post: { id: post.id, title: post.title },
    candidates,
    no_confident_match: noMatch,
  };
}
