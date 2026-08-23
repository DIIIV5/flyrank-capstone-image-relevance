import assert from "node:assert/strict";
import { test } from "node:test";
import { cosine, rankByCosine } from "./similarity.js";

// These tests do not call Jina. They check cosine and rank order.

test("identical vectors give cosine 1", () => {
  assert.equal(cosine([1, 0, 0], [1, 0, 0]), 1);
});

test("orthogonal vectors give cosine 0", () => {
  assert.equal(cosine([1, 0], [0, 1]), 0);
});

test("rankByCosine sorts descending and starts rank at 1", () => {
  const ranked = rankByCosine([1, 0], [
    { name: "far", vector: [0, 1] },
    { name: "near", vector: [0.9, 0.1] },
    { name: "mid", vector: [0.5, 0.5] },
  ]);
  assert.deepEqual(
    ranked.map((row) => row.name),
    ["near", "mid", "far"],
  );
  assert.deepEqual(
    ranked.map((row) => row.rank),
    [1, 2, 3],
  );
});
