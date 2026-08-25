export class RankError extends Error {
  readonly code: "no_embedding" | "image_not_found";

  constructor(code: "no_embedding" | "image_not_found", message: string) {
    super(message);
    this.name = "RankError";
    this.code = code;
  }
}

export type RankCandidate = {
  imageId: string | null;
  filename: string;
  label: string | null;
  similarity: number;
  rank: number;
  decision: "suggested" | "rejected";
  reason: string;
  caption: string | null;
};

export type RankResult = {
  post: { id: string; title: string };
  candidates: RankCandidate[];
  no_confident_match: { reason: string } | null;
};

export type RankOpts = {
  image?: string | null;
  cosineMin?: number;
  requireTags?: boolean;
};

export type SuggestionWrite = {
  imageId: string | null;
  rank: number | null;
  similarity: number | null;
  decision: "suggested" | "rejected" | "no_confident_match";
  reason: string;
};

export function toSuggestionWrites(
  result: RankResult,
  includeNoMatch: boolean,
): SuggestionWrite[] {
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
