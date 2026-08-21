import assert from "node:assert/strict";
import { test } from "node:test";
import { ImageAnnotationSchema } from "./types.js";

// These tests do not call Gemini. They check the tag JSON shape.

const valid = {
  subject: "red fox",
  category: "animal",
  attributes: ["orange fur", "wild", "forest"],
  caption: "A red fox standing in a forest",
  confidence: 0.94,
};

test("ImageAnnotationSchema accepts the brief tag JSON", () => {
  const parsed = ImageAnnotationSchema.safeParse(valid);
  assert.equal(parsed.success, true);
});

test("ImageAnnotationSchema rejects missing subject", () => {
  const parsed = ImageAnnotationSchema.safeParse({
    category: "animal",
    attributes: [],
    caption: "A red fox standing in a forest",
    confidence: 0.94,
  });
  assert.equal(parsed.success, false);
});

test("ImageAnnotationSchema rejects an empty caption", () => {
  const parsed = ImageAnnotationSchema.safeParse({
    ...valid,
    caption: "",
  });
  assert.equal(parsed.success, false);
});

test("ImageAnnotationSchema rejects more than 8 attributes", () => {
  const parsed = ImageAnnotationSchema.safeParse({
    ...valid,
    attributes: ["a", "b", "c", "d", "e", "f", "g", "h", "i"],
  });
  assert.equal(parsed.success, false);
});

test("ImageAnnotationSchema rejects confidence outside 0-1", () => {
  const parsed = ImageAnnotationSchema.safeParse({
    ...valid,
    confidence: 1.4,
  });
  assert.equal(parsed.success, false);
});
