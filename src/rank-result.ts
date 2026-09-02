import type { Decision, SuggestionWrite } from "./types.js";

export type RankErrorCode = "no_embedding" | "image_not_found";

export class RankError extends Error {
  constructor(
    readonly code: RankErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RankError";
  }
}

export type RankCandidate = {
  imageId: string;
  filename: string;
  label: string | null;
  similarity: number;
  rank: number;
  decision: Decision;
  reason: string;
  caption: string | null;
};

export type RankResult = {
  post: { id: string; title: string };
  candidates: RankCandidate[];
  no_confident_match: { reason: string } | null;
};

export type RankOpts = {
  /** Rank only this filename instead of the whole library. */
  image?: string | null;
  cosineMin?: number;
  requireSubject?: boolean;
};

export function noConfidentMatch(candidates: RankCandidate[]): { reason: string } | null {
  if (candidates.some((row) => row.decision === "suggested")) {
    return null;
  }
  const reasons = candidates.map((row) => row.reason).join("; ");
  return { reason: `no confident match: ${reasons || "no image embeddings"}` };
}

/** Rows for the suggestions table. The no-match row is only stored for a full library rank. */
export function toSuggestionWrites(result: RankResult, includeNoMatch: boolean): SuggestionWrite[] {
  const writes: SuggestionWrite[] = result.candidates.map((row) => ({
    imageId: row.imageId,
    rank: row.rank,
    similarity: row.similarity,
    decision: row.decision,
    reason: row.reason,
  }));
  if (includeNoMatch && result.no_confident_match) {
    writes.push({
      imageId: null,
      rank: null,
      similarity: null,
      decision: "no_confident_match",
      reason: result.no_confident_match.reason,
    });
  }
  return writes;
}

export function toRankJson(result: RankResult) {
  return {
    post: result.post,
    candidates: result.candidates.map((row) => ({
      filename: row.filename,
      label: row.label,
      similarity: row.similarity,
      decision: row.decision,
      reason: row.reason,
      caption: row.caption,
    })),
    no_confident_match: result.no_confident_match,
  };
}
