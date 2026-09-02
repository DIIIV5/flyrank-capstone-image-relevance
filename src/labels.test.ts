import assert from "node:assert/strict";
import { test } from "node:test";
import { labelStatus, pickLabels, rankLabels, softmax } from "./labels.js";
import type { ImageLabel } from "./types.js";

const scored = [
  { name: "fox", raw: 0.39 },
  { name: "wolf", raw: 0.33 },
  { name: "dog", raw: 0.3 },
];

test("softmax sums to 1 and keeps the argmax", () => {
  const probs = softmax([0.3, 0.1, 0.2], 1);
  const sum = probs.reduce((total, value) => total + value, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9);
  assert.equal(probs.indexOf(Math.max(...probs)), 0);
});

test("a lower temperature gives the winner more mass", () => {
  const sharp = softmax([0.3, 0.1, 0.2], 0.1);
  const flat = softmax([0.3, 0.1, 0.2], 2);
  assert.ok((sharp[0] ?? 0) > (flat[0] ?? 0));
});

test("rankLabels sorts by raw dot when temperature is null", () => {
  const ranked = rankLabels([...scored].reverse(), null);
  assert.deepEqual(ranked, [
    { name: "fox", score: 0.39 },
    { name: "wolf", score: 0.33 },
    { name: "dog", score: 0.3 },
  ]);
});

test("rankLabels applies softmax when a temperature is given", () => {
  const ranked = rankLabels(scored, 1);
  assert.equal(ranked[0]?.name, "fox");
  assert.ok((ranked[0]?.score ?? 0) < 0.39);
});

test("pickLabels returns the top two as an ImageLabel", () => {
  assert.deepEqual(pickLabels(scored, null), {
    label: "fox",
    score: 0.39,
    runnerUpLabel: "wolf",
    runnerUpScore: 0.33,
  });
});

test("pickLabels needs at least two labels", () => {
  assert.throws(() => pickLabels([{ name: "fox", raw: 0.4 }], null), /at least two/);
});

const sure: ImageLabel = { label: "fox", score: 0.81, runnerUpLabel: "wolf", runnerUpScore: 0.11 };

test("labelStatus is processed for a high score with a clear gap", () => {
  assert.equal(labelStatus(sure), "processed");
});

test("labelStatus is flagged for a low score or a small gap", () => {
  assert.equal(labelStatus({ ...sure, score: 0.2, runnerUpScore: 0.1 }), "flagged");
  assert.equal(labelStatus({ ...sure, score: 0.3, runnerUpScore: 0.295 }), "flagged");
});

test("labelStatus accepts explicit thresholds", () => {
  assert.equal(labelStatus({ ...sure, score: 0.2, runnerUpScore: 0.1 }, 0.1, 0.05), "processed");
});
