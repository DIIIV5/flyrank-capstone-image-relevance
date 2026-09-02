import assert from "node:assert/strict";
import { test } from "node:test";
import { cosine, rankByCosine } from "./similarity.js";

test("cosine is 1 for identical vectors and 0 for orthogonal ones", () => {
  assert.equal(cosine([1, 0, 0], [1, 0, 0]), 1);
  assert.equal(cosine([1, 0], [0, 1]), 0);
});

test("cosine is 0 when either vector has no length", () => {
  assert.equal(cosine([0, 0], [1, 1]), 0);
  assert.equal(cosine([], [1, 1]), 0);
});

test("cosine compares only the shared prefix of vectors with different lengths", () => {
  assert.equal(cosine([1, 0, 5], [1, 0]), 1);
  assert.equal(cosine([1, 0], [1, 0, 5]), 1);
});

test("rankByCosine sorts descending and numbers ranks from 1", () => {
  const ranked = rankByCosine([1, 0], [
    { name: "far", vector: [0, 1] },
    { name: "near", vector: [0.9, 0.1] },
    { name: "mid", vector: [0.5, 0.5] },
  ]);
  assert.deepEqual(
    ranked.map((row) => [row.name, row.rank]),
    [
      ["near", 1],
      ["mid", 2],
      ["far", 3],
    ],
  );
});
