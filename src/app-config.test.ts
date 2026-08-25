import assert from "node:assert/strict";
import { test } from "node:test";
import { parseAppConfig } from "./app-config.js";
import { ImageLabelSchema } from "./types.js";

// These tests parse config.yaml and a sample object. They do not call Jina or open Postgres.

const base = {
  labels: ["fox", "wolf"],
  catch_all: undefined as string | undefined,
  score_scale: "raw" as const,
  softmax_temperature: 1,
  label_score_min: 0.25,
  label_margin_min: 0.01,
  cosine_min: 0.25,
  check_flagged: true,
  paths: {
    corpus: "data/images",
    posts: "data/posts",
    matching_gold: "data/eval/labels.json",
    label_eval: {
      fox: "data/images/eval/fox",
      wolf: "data/images/eval/wolf",
    },
  },
};

test("parseAppConfig accepts a two-label config", () => {
  const parsed = parseAppConfig(base);
  assert.deepEqual(parsed.labels, ["fox", "wolf"]);
  assert.equal(parsed.score_scale, "raw");
});

test("parseAppConfig rejects a label_eval key that is not in labels", () => {
  assert.throws(() =>
    parseAppConfig({
      ...base,
      paths: {
        ...base.paths,
        label_eval: { ...base.paths.label_eval, cat: "data/images/eval/cat" },
      },
    }),
  );
});

test("parseAppConfig rejects a missing label_eval folder", () => {
  assert.throws(() =>
    parseAppConfig({
      ...base,
      paths: { ...base.paths, label_eval: { fox: "data/images/eval/fox" } },
    }),
  );
});

test("ImageLabelSchema from committed config.yaml rejects bison", () => {
  const parsed = ImageLabelSchema.safeParse({
    label: "bison",
    score: 0.4,
    runnerUpLabel: "fox",
    runnerUpScore: 0.3,
  });
  assert.equal(parsed.success, false);
});
