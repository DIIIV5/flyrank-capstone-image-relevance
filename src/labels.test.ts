import assert from "node:assert/strict";
import { test } from "node:test";
import { labelStatus, softmax } from "./labels.js";
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

test("ImageLabelSchema accepts cow and chicken", () => {
  assert.equal(
    ImageLabelSchema.safeParse({ ...valid, label: "cow", runnerUpLabel: "chicken" })
      .success,
    true,
  );
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
    labelStatus({ ...valid, score: 0.2, runnerUpScore: 0.1 }),
    "flagged",
  );
});

test("small gap between first and second is flagged", () => {
  assert.equal(
    labelStatus({ ...valid, score: 0.3, runnerUpScore: 0.295 }),
    "flagged",
  );
});

test("softmax at T=1 sums to 1 and preserves argmax", () => {
  const probs = softmax([0.3, 0.1, 0.2], 1);
  const sum = probs.reduce((total, value) => total + value, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9);
  assert.equal((probs[0] ?? 0) > (probs[1] ?? 0) && (probs[0] ?? 0) > (probs[2] ?? 0), true);
});

test("lower temperature sharpens the winning softmax mass", () => {
  const sharp = softmax([0.3, 0.1, 0.2], 0.1);
  const flat = softmax([0.3, 0.1, 0.2], 2);
  assert.ok((sharp[0] ?? 0) > (flat[0] ?? 0));
});
