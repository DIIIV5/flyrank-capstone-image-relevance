import assert from "node:assert/strict";
import { test } from "node:test";
import {
  defaultGuardRules,
  guard,
  subjectAgreesWithLabel,
  type GuardImage,
  type GuardPair,
  type GuardRules,
} from "./guard.js";

// Pure checks against fixed rules; nothing here loads a model or opens Postgres.

const rules: GuardRules = {
  cosineMin: 0.25,
  labelScoreMin: 0.25,
  labelMarginMin: 0.01,
  checkFlagged: true,
  requireSubject: false,
};

const fox: GuardImage = { label: "fox", labelScore: 0.39, runnerUpScore: 0.33, subject: null };
const wolf: GuardImage = { label: "wolf", labelScore: 0.4, runnerUpScore: 0.34, subject: null };

function run(pair: Partial<GuardPair> = {}, overrides: Partial<GuardRules> = {}) {
  return guard(
    { expectedLabel: "fox", similarity: 0.35, image: fox, ...pair },
    { ...rules, ...overrides },
  );
}

test("defaultGuardRules come from config.yaml and do not require a subject", () => {
  assert.equal(defaultGuardRules.cosineMin, 0.25);
  assert.equal(defaultGuardRules.requireSubject, false);
  assert.equal(guard({ expectedLabel: "fox", similarity: 0.35, image: fox }).decision, "suggested");
});

test("a fox post with a fox image is suggested", () => {
  assert.deepEqual(run(), { decision: "suggested", reason: "cleared the guard" });
});

test("check 1: similarity under the floor is rejected first", () => {
  const result = run({ similarity: 0.1, image: wolf });
  assert.equal(result.decision, "rejected");
  assert.equal(result.reason, "similarity below threshold (0.10 < 0.25)");
});

test("check 2: a weak label score or margin is rejected as uncertain", () => {
  const lowScore = run({ image: { ...fox, labelScore: 0.2, runnerUpScore: 0.1 } });
  assert.match(lowScore.reason, /uncertain subject: label score 0.20, margin 0.10/);
  const thinMargin = run({ image: { ...fox, labelScore: 0.3, runnerUpScore: 0.295 } });
  assert.match(thinMargin.reason, /uncertain subject/);
  const unlabeled = run({ image: { ...fox, labelScore: null, runnerUpScore: null } });
  assert.match(unlabeled.reason, /label score 0.00, margin 0.00/);
});

test("check 2 can be switched off", () => {
  const weak = { ...fox, labelScore: 0.2, runnerUpScore: 0.1 };
  assert.equal(run({ image: weak }, { checkFlagged: false }).decision, "suggested");
});

test("check 3: the post's expected label must match the image label", () => {
  const result = run({ image: wolf });
  assert.equal(result.reason, "subject mismatch: expected fox, detected wolf");
  const unlabeled = run({ image: { ...fox, label: null } });
  assert.equal(unlabeled.reason, "subject mismatch: expected fox, detected none");
});

test("check 3 is skipped when the post has no expected label", () => {
  assert.equal(run({ expectedLabel: null, image: wolf }).decision, "suggested");
});

test("check 4: a missing Gemini subject passes unless it is required", () => {
  assert.equal(run({ image: { ...fox, subject: "  " } }).decision, "suggested");
  const required = run({ image: { ...fox, subject: null } }, { requireSubject: true });
  assert.deepEqual(required, { decision: "rejected", reason: "missing metadata" });
});

test("check 4: a Gemini subject that names a different label is rejected", () => {
  const result = run({ expectedLabel: null, image: { ...wolf, subject: "red fox" } });
  assert.equal(result.reason, 'metadata disagreement: Gemini subject "red fox", Jina label wolf');
  const unlabeled = { ...wolf, label: null, subject: "red fox" };
  assert.match(run({ expectedLabel: null, image: unlabeled }).reason, /Jina label none/);
});

test("check 4: a subject that agrees or names no label passes", () => {
  assert.equal(run({ image: { ...fox, subject: "a red fox" } }).decision, "suggested");
  assert.equal(run({ image: { ...fox, subject: "kitten" } }).decision, "suggested");
});

test("subjectAgreesWithLabel matches configured labels and skips the catch-all", () => {
  assert.equal(subjectAgreesWithLabel("a tiger in grass", "tiger"), "agree");
  assert.equal(subjectAgreesWithLabel("a tiger in grass", "cat"), "disagree");
  assert.equal(subjectAgreesWithLabel("border collie", "dog"), "skip");
  assert.equal(subjectAgreesWithLabel("some other animal", "other"), "skip");
});
