import assert from "node:assert/strict";
import { test } from "node:test";
import { isConfiguredLabel, parseAppConfig, promptForLabel } from "./app-config.js";

const base = {
  labels: ["fox", "wolf"],
  score_scale: "raw",
  label_score_min: 0.25,
  label_margin_min: 0.01,
  cosine_min: 0.25,
  check_flagged: true,
  paths: {
    corpus: "data/images",
    posts: "data/posts",
    matching_gold: "data/eval/labels.json",
    label_eval: { fox: "data/images/eval/fox", wolf: "data/images/eval/wolf" },
  },
};

test("parseAppConfig accepts a minimal config and defaults the temperature", () => {
  const parsed = parseAppConfig(base);
  assert.deepEqual(parsed.labels, ["fox", "wolf"]);
  assert.equal(parsed.softmax_temperature, 1);
});

test("parseAppConfig accepts catch_all and label_prompts that name known labels", () => {
  const parsed = parseAppConfig({
    ...base,
    labels: ["fox", "wolf", "other"],
    catch_all: "other",
    label_prompts: { fox: "a photo of a red fox" },
    paths: {
      ...base.paths,
      label_eval: { ...base.paths.label_eval, other: "data/images/eval/other" },
    },
  });
  assert.equal(parsed.catch_all, "other");
});

test("parseAppConfig rejects inconsistent label lists", () => {
  const cases = [
    { ...base, labels: ["fox", "fox"] },
    { ...base, catch_all: "cat" },
    { ...base, label_prompts: { cat: "a photo of a cat" } },
    { ...base, paths: { ...base.paths, label_eval: { fox: "data/images/eval/fox" } } },
    {
      ...base,
      paths: {
        ...base.paths,
        label_eval: { ...base.paths.label_eval, cat: "data/images/eval/cat" },
      },
    },
  ];
  for (const bad of cases) {
    assert.throws(() => parseAppConfig(bad));
  }
});

test("isConfiguredLabel reads labels from config.yaml", () => {
  assert.equal(isConfiguredLabel("fox"), true);
  assert.equal(isConfiguredLabel("bison"), false);
});

test("promptForLabel prefers a custom prompt, then the catch-all prompt, then the default", () => {
  const config = { catch_all: "other", label_prompts: { fox: "a photo of a red fox" } };
  assert.equal(promptForLabel("fox", config), "a photo of a red fox");
  assert.equal(promptForLabel("other", config), "a photo of an animal");
  assert.equal(promptForLabel("wolf", config), "a photo of a wolf");
  assert.equal(promptForLabel("wolf", { catch_all: undefined }), "a photo of a wolf");
});

test("promptForLabel defaults to config.yaml", () => {
  assert.equal(promptForLabel("fox"), "a photo of a fox");
  assert.equal(promptForLabel("other"), "a photo of an animal");
});
