import assert from "node:assert/strict";
import { test } from "node:test";
import { cosineMin, guard, subjectAgreesWithLabel, type GuardImage } from "./guard.js";

// These tests do not call Jina or Gemini. They check the guard checks in order.

const foxImage: GuardImage = {
  filename: "red-fox-01.jpg",
  label: "fox",
  labelScore: 0.81,
  runnerUpScore: 0.11,
  status: "processed",
  subject: null,
};

const wolfImage: GuardImage = {
  filename: "grey-wolf-01.jpg",
  label: "wolf",
  labelScore: 0.8,
  runnerUpScore: 0.1,
  status: "processed",
  subject: null,
};

function run(
  overrides: Partial<Parameters<typeof guard>[0]> & { image?: GuardImage } = {},
) {
  return guard({
    expectedLabel: "fox",
    similarity: 0.4,
    cosineMin,
    requireGeminiTags: false,
    image: foxImage,
    ...overrides,
  });
}

test("fox post with a fox image is suggested", () => {
  const result = run();
  assert.equal(result.decision, "suggested");
});

test("fox post with a wolf image rejects on subject mismatch", () => {
  const result = run({ image: wolfImage });
  assert.equal(result.decision, "rejected");
  assert.match(result.reason, /subject mismatch: expected fox, detected wolf/);
});

test("cosine under the floor rejects before a subject mismatch", () => {
  const result = run({ similarity: 0.1, image: wolfImage });
  assert.equal(result.decision, "rejected");
  assert.match(result.reason, /similarity below threshold/);
});

test("null expectedLabel skips the species check", () => {
  const result = run({ expectedLabel: null, image: wolfImage });
  assert.equal(result.decision, "suggested");
});

test("null subject passes when tags are not required", () => {
  const result = run({ requireGeminiTags: false, image: { ...foxImage, subject: null } });
  assert.equal(result.decision, "suggested");
});

test("null subject rejects when tags are required", () => {
  const result = run({ requireGeminiTags: true, image: { ...foxImage, subject: null } });
  assert.equal(result.decision, "rejected");
  assert.equal(result.reason, "missing metadata");
});

test("Gemini red fox against Jina wolf rejects on metadata disagreement", () => {
  const result = run({
    expectedLabel: null,
    image: { ...wolfImage, subject: "red fox" },
  });
  assert.equal(result.decision, "rejected");
  assert.match(result.reason, /metadata disagreement/);
});

test("subjectAgreesWithLabel matches a longer label first", () => {
  assert.equal(subjectAgreesWithLabel("a big cat in grass", "big cat"), "agree");
  assert.equal(subjectAgreesWithLabel("a big cat in grass", "cat"), "disagree");
});
