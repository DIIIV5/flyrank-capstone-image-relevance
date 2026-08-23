import assert from "node:assert/strict";
import { test } from "node:test";
import { labelStatus } from "./labels.js";
import { ImageLabelSchema, type ImageLabel } from "./types.js";

// These tests check the label JSON and the flag rule. They do not call Jina.

const valid: ImageLabel = {
  label: "fox",
  score: 0.81,
  runnerUpLabel: "wolf",
  runnerUpScore: 0.11,
};

test("ImageLabelSchema accepts a valid label", () => {
  const parsed = ImageLabelSchema.safeParse(valid);
  assert.equal(parsed.success, true);
});

test("ImageLabelSchema rejects an unknown animal name", () => {
  const parsed = ImageLabelSchema.safeParse({
    ...valid,
    label: "bison",
  });
  assert.equal(parsed.success, false);
});

test("high score and a clear gap is processed", () => {
  assert.equal(labelStatus(valid), "processed");
});

test("low score is flagged", () => {
  assert.equal(
    labelStatus({ ...valid, score: 0.65, runnerUpScore: 0.1 }),
    "flagged",
  );
});

test("small gap between first and second is flagged", () => {
  assert.equal(
    labelStatus({ ...valid, score: 0.8, runnerUpScore: 0.7 }),
    "flagged",
  );
});
