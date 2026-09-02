import assert from "node:assert/strict";
import { test } from "node:test";
import {
  RankError,
  noConfidentMatch,
  toRankJson,
  toSuggestionWrites,
  type RankCandidate,
  type RankResult,
} from "./rank-result.js";

const suggested: RankCandidate = {
  imageId: "img-fox",
  filename: "fox.jpg",
  label: "fox",
  similarity: 0.35,
  rank: 1,
  decision: "suggested",
  reason: "cleared the guard",
  caption: "A red fox standing in a forest",
};

const rejected: RankCandidate = {
  ...suggested,
  imageId: "img-wolf",
  filename: "wolf.jpg",
  label: "wolf",
  similarity: 0.31,
  rank: 2,
  decision: "rejected",
  reason: "subject mismatch: expected fox, detected wolf",
  caption: null,
};

const post = { id: "post-fox", title: "The behaviour of red foxes" };

test("RankError carries a code", () => {
  const error = new RankError("no_embedding", "post has no embedding");
  assert.equal(error.code, "no_embedding");
  assert.equal(error.name, "RankError");
  assert.ok(error instanceof Error);
});

test("noConfidentMatch is null when any candidate is suggested", () => {
  assert.equal(noConfidentMatch([rejected, suggested]), null);
});

test("noConfidentMatch joins the rejection reasons", () => {
  const tooFar = { ...rejected, reason: "similarity below threshold" };
  assert.deepEqual(noConfidentMatch([rejected, tooFar]), {
    reason:
      "no confident match: subject mismatch: expected fox, detected wolf; " +
      "similarity below threshold",
  });
});

test("noConfidentMatch explains an empty library", () => {
  assert.deepEqual(noConfidentMatch([]), { reason: "no confident match: no image embeddings" });
});

test("toSuggestionWrites maps candidates and adds the no-match row only when asked", () => {
  const result: RankResult = {
    post,
    candidates: [rejected],
    no_confident_match: { reason: "no confident match: subject mismatch" },
  };
  assert.deepEqual(toSuggestionWrites(result, false), [
    {
      imageId: "img-wolf",
      rank: 2,
      similarity: 0.31,
      decision: "rejected",
      reason: "subject mismatch: expected fox, detected wolf",
    },
  ]);
  assert.deepEqual(toSuggestionWrites(result, true).at(-1), {
    imageId: null,
    rank: null,
    similarity: null,
    decision: "no_confident_match",
    reason: "no confident match: subject mismatch",
  });
});

test("toSuggestionWrites adds no extra row when a candidate was suggested", () => {
  const result: RankResult = { post, candidates: [suggested], no_confident_match: null };
  assert.equal(toSuggestionWrites(result, true).length, 1);
});

test("toRankJson drops internal ids and ranks", () => {
  const result: RankResult = { post, candidates: [suggested], no_confident_match: null };
  assert.deepEqual(toRankJson(result), {
    post,
    candidates: [
      {
        filename: "fox.jpg",
        label: "fox",
        similarity: 0.35,
        decision: "suggested",
        reason: "cleared the guard",
        caption: "A red fox standing in a forest",
      },
    ],
    no_confident_match: null,
  });
});
