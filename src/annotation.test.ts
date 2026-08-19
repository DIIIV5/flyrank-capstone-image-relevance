import assert from "node:assert/strict";
import { test } from "node:test";
import { ImageAnnotationSchema } from "./types.js";

test("ImageAnnotationSchema accepts the brief tag JSON", () => {
  const parsed = ImageAnnotationSchema.safeParse({
    subject: "red fox",
    category: "animal",
    attributes: ["orange fur", "wild", "forest"],
    caption: "A red fox standing in a forest",
    confidence: 0.94,
  });
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

test("ImageAnnotationSchema rejects confidence outside 0-1", () => {
  const parsed = ImageAnnotationSchema.safeParse({
    subject: "red fox",
    category: "animal",
    attributes: [],
    caption: "A red fox standing in a forest",
    confidence: 1.4,
  });
  assert.equal(parsed.success, false);
});
