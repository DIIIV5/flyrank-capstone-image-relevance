import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { createApp, type HttpDeps } from "./http/app.js";
import { RankError, type RankResult } from "./rank-result.js";
import type { PostRow, SuggestionRow } from "./types.js";

// Handlers run against in-memory stubs. Nothing here opens Postgres or loads a model.

const foxPost: PostRow = {
  id: "post-fox",
  title: "The behaviour of red foxes",
  body: "Vulpes vulpes",
  expected_label: "fox",
};

const foxRank: RankResult = {
  post: { id: foxPost.id, title: foxPost.title },
  candidates: [
    {
      imageId: "img-fox",
      filename: "fox.jpg",
      label: "fox",
      similarity: 0.35,
      rank: 1,
      decision: "suggested",
      reason: "cleared the guard",
      caption: "A red fox standing in a forest",
    },
  ],
  no_confident_match: null,
};

const pending: SuggestionRow = {
  id: "sug-1",
  filename: "fox.jpg",
  caption: "A red fox standing in a forest",
  label: "fox",
  labelScore: 0.39,
  runnerUpScore: 0.33,
  similarity: 0.35,
  decision: "suggested",
  reason: "cleared the guard",
  review: "pending",
  reviewedAt: null,
};

const noMatch: SuggestionRow = {
  ...pending,
  id: "sug-none",
  filename: null,
  caption: null,
  decision: "no_confident_match",
  review: null,
};

type Stub = HttpDeps & { replaced: [string, number][] };

function stubDeps(): Stub {
  const replaced: Stub["replaced"] = [];
  const suggestions = new Map([pending, noMatch].map((row) => [row.id, { ...row }]));
  return {
    replaced,
    async getPostByTitleOrId(query) {
      if (query === "red-fox") {
        return foxPost;
      }
      return query === "no-embed" ? { ...foxPost, id: "post-empty", title: "Empty" } : null;
    },
    async rankForPost(post, opts) {
      if (post.id === "post-empty") {
        throw new RankError("no_embedding", `post has no embedding: ${post.title}`);
      }
      if (opts?.image === "missing.jpg") {
        throw new RankError("image_not_found", "image not found: missing.jpg");
      }
      return opts?.image
        ? { ...foxRank, candidates: [], no_confident_match: { reason: "no confident match: x" } }
        : foxRank;
    },
    async replaceSuggestions(postId, rows) {
      replaced.push([postId, rows.length]);
    },
    async getSuggestionById(id) {
      return suggestions.get(id) ?? null;
    },
    async setSuggestionReview(id, review) {
      const row = suggestions.get(id);
      if (!row) {
        throw new Error("missing");
      }
      const updated = { ...row, review, reviewedAt: new Date("2026-08-24T12:00:00Z") };
      suggestions.set(id, updated);
      return updated;
    },
  };
}

type JsonValue = string | number | boolean | null | JsonValue[] | Json;
type Json = { [key: string]: JsonValue };

async function request(
  deps: HttpDeps,
  path: string,
  init: { method?: string; body?: string } = {},
): Promise<{ status: number; body: Json }> {
  const server = createApp(deps).listen(0, "localhost");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  const port = address && typeof address === "object" ? address.port : 0;
  try {
    const res = await fetch(`http://localhost:${port}${path}`, {
      method: init.method ?? "GET",
      headers: { "content-type": "application/json" },
      body: init.body,
    });
    const body = (await res.json()) as Json;
    return { status: res.status, body };
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

const review = (value: string) => ({ method: "POST", body: JSON.stringify({ review: value }) });

test("GET /posts/:id/images returns 404 for an unknown post", async () => {
  const { status, body } = await request(stubDeps(), "/posts/missing/images");
  assert.equal(status, 404);
  assert.equal(body.error, "post not found: missing");
});

test("GET /posts/:id/images returns 409 when the post has no embedding", async () => {
  const { status, body } = await request(stubDeps(), "/posts/no-embed/images");
  assert.equal(status, 409);
  assert.match(String(body.error), /no embedding/);
});

test("GET /posts/:id/images returns 404 for an unknown forced image", async () => {
  const { status } = await request(stubDeps(), "/posts/red-fox/images?image=missing.jpg");
  assert.equal(status, 404);
});

test("GET /posts/:id/images returns a JSON 500 for an unexpected error", async () => {
  const deps = stubDeps();
  deps.rankForPost = async () => {
    throw new Error("boom");
  };
  const silenced = mock.method(console, "error", () => {});
  try {
    const { status, body } = await request(deps, "/posts/red-fox/images");
    assert.equal(status, 500);
    assert.equal(body.error, "internal error");
  } finally {
    silenced.mock.restore();
  }
});

test("GET /posts/:id/images ranks without writing suggestions", async () => {
  const deps = stubDeps();
  const { status, body } = await request(deps, "/posts/red-fox/images?image=");
  assert.equal(status, 200);
  assert.deepEqual(body, {
    post: foxRank.post,
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
  assert.deepEqual(deps.replaced, []);
});

test("POST /posts/:id/images writes suggestions", async () => {
  const deps = stubDeps();
  const { status } = await request(deps, "/posts/red-fox/images", { method: "POST" });
  assert.equal(status, 200);
  assert.deepEqual(deps.replaced, [["post-fox", 1]]);
});

test("POST /posts/:id/images with ?image= stores only that pair, not a no-match row", async () => {
  const deps = stubDeps();
  const { status, body } = await request(deps, "/posts/red-fox/images?image=wolf.jpg", {
    method: "POST",
  });
  assert.equal(status, 200);
  assert.deepEqual(body.no_confident_match, { reason: "no confident match: x" });
  assert.deepEqual(deps.replaced, [["post-fox", 0]]);
});

test("GET /suggestions/:id returns the row or 404", async () => {
  const found = await request(stubDeps(), "/suggestions/sug-1");
  assert.equal(found.status, 200);
  assert.equal(found.body.review, "pending");
  const missing = await request(stubDeps(), "/suggestions/nope");
  assert.equal(missing.status, 404);
});

test("POST /suggestions/:id/review rejects a bad body and malformed JSON", async () => {
  const bad = await request(stubDeps(), "/suggestions/sug-1/review", review("maybe"));
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, "invalid review body");
  const broken = await request(stubDeps(), "/suggestions/sug-1/review", {
    method: "POST",
    body: "{",
  });
  assert.equal(broken.status, 400);
  assert.equal(broken.body.error, "invalid JSON");
});

test("POST /suggestions/:id/review returns 404 for an unknown row", async () => {
  const { status } = await request(stubDeps(), "/suggestions/nope/review", review("approved"));
  assert.equal(status, 404);
});

test("POST /suggestions/:id/review refuses a row that was not suggested", async () => {
  const approve = review("approved");
  const { status, body } = await request(stubDeps(), "/suggestions/sug-none/review", approve);
  assert.equal(status, 400);
  assert.equal(body.error, "cannot review a no_confident_match row");
});

test("POST /suggestions/:id/review approves a suggested row", async () => {
  const approve = review("approved");
  const { status, body } = await request(stubDeps(), "/suggestions/sug-1/review", approve);
  assert.equal(status, 200);
  assert.equal(body.review, "approved");
  assert.equal(body.reviewedAt, "2026-08-24T12:00:00.000Z");
});
