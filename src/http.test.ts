import assert from "node:assert/strict";
import { test } from "node:test";
import { createApp, type HttpDeps } from "./http/app.js";
import { RankError, type RankResult } from "./rank-result.js";

// HTTP tests use in-memory stubs. They do not open Postgres or load Jina/Gemini.

const foxPost = {
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

const pendingSuggestion = {
  id: "sug-1",
  postId: foxPost.id,
  imageId: "img-fox",
  filename: "fox.jpg",
  caption: "A red fox standing in a forest",
  label: "fox",
  labelScore: 0.2,
  runnerUpScore: 0.1,
  rank: 1,
  similarity: 0.35,
  decision: "suggested",
  reason: "cleared the guard",
  review: "pending" as string | null,
  reviewedAt: null as Date | null,
};

const noMatchSuggestion = {
  ...pendingSuggestion,
  id: "sug-none",
  imageId: null,
  filename: null,
  caption: null,
  decision: "no_confident_match",
  review: null,
};

function listen(
  app: ReturnType<typeof createApp>,
): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "localhost", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("no listen port"));
        return;
      }
      resolve({
        url: `http://localhost:${address.port}`,
        close: () =>
          new Promise((done, fail) => {
            server.close((err) => (err ? fail(err) : done()));
          }),
      });
    });
  });
}

function stubDeps(overrides: Partial<HttpDeps> = {}): HttpDeps & { replaced: string[] } {
  const replaced: string[] = [];
  const suggestions = new Map([
    [pendingSuggestion.id, { ...pendingSuggestion }],
    [noMatchSuggestion.id, { ...noMatchSuggestion }],
  ]);

  return {
    replaced,
    async getPostByTitleOrId(query) {
      if (query === "red-fox" || query === foxPost.id) {
        return foxPost;
      }
      if (query === "no-embed") {
        return { ...foxPost, id: "post-empty", title: "Empty" };
      }
      return null;
    },
    async rankForPost(post, opts) {
      if (post.id === "post-empty") {
        throw new RankError("no_embedding", `post has no embedding: ${post.title}`);
      }
      if (opts?.image === "missing.jpg") {
        throw new RankError("image_not_found", "image not found: missing.jpg");
      }
      return foxRank;
    },
    async replaceSuggestions(postId) {
      replaced.push(postId);
    },
    async getSuggestionById(id) {
      return suggestions.get(id) ?? null;
    },
    async setSuggestionReview(id, review) {
      const row = suggestions.get(id);
      if (!row) {
        return null;
      }
      const updated = {
        ...row,
        review,
        reviewedAt: new Date("2026-08-24T12:00:00Z"),
      };
      suggestions.set(id, updated);
      return updated;
    },
    ...overrides,
  };
}

test("unknown post returns 404", async () => {
  const app = createApp(stubDeps());
  const { url, close } = await listen(app);
  try {
    const res = await fetch(`${url}/posts/missing/images`);
    assert.equal(res.status, 404);
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /post not found/);
  } finally {
    await close();
  }
});

test("post with no embedding returns 409", async () => {
  const app = createApp(stubDeps());
  const { url, close } = await listen(app);
  try {
    const res = await fetch(`${url}/posts/no-embed/images`);
    assert.equal(res.status, 409);
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /no embedding/);
  } finally {
    await close();
  }
});

test("GET /posts/:id/images does not write suggestions", async () => {
  const deps = stubDeps();
  const app = createApp(deps);
  const { url, close } = await listen(app);
  try {
    const res = await fetch(`${url}/posts/red-fox/images`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      candidates: { filename: string; caption: string }[];
    };
    assert.equal(body.candidates[0]?.filename, "fox.jpg");
    assert.equal(body.candidates[0]?.caption, "A red fox standing in a forest");
    assert.deepEqual(deps.replaced, []);
  } finally {
    await close();
  }
});

test("POST /posts/:id/images writes suggestions", async () => {
  const deps = stubDeps();
  const app = createApp(deps);
  const { url, close } = await listen(app);
  try {
    const res = await fetch(`${url}/posts/red-fox/images`, { method: "POST" });
    assert.equal(res.status, 200);
    assert.deepEqual(deps.replaced, [foxPost.id]);
  } finally {
    await close();
  }
});

test("bad review body returns 400", async () => {
  const app = createApp(stubDeps());
  const { url, close } = await listen(app);
  try {
    const res = await fetch(`${url}/suggestions/sug-1/review`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ review: "maybe" }),
    });
    assert.equal(res.status, 400);
  } finally {
    await close();
  }
});

test("reviewing a no_confident_match row returns 400", async () => {
  const app = createApp(stubDeps());
  const { url, close } = await listen(app);
  try {
    const res = await fetch(`${url}/suggestions/sug-none/review`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ review: "approved" }),
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /no_confident_match/);
  } finally {
    await close();
  }
});

test("approve sets review", async () => {
  const app = createApp(stubDeps());
  const { url, close } = await listen(app);
  try {
    const res = await fetch(`${url}/suggestions/sug-1/review`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ review: "approved" }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { review: string; reviewedAt: string };
    assert.equal(body.review, "approved");
    assert.ok(body.reviewedAt);
  } finally {
    await close();
  }
});
