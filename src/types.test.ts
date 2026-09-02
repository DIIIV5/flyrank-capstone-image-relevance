import assert from "node:assert/strict";
import { test } from "node:test";
import { ImageAnnotationSchema, ImageLabelSchema } from "./types.js";

const annotation = {
  subject: "red fox",
  category: "animal",
  attributes: ["orange fur", "wild", "forest"],
  caption: "A red fox standing in a forest",
  confidence: 0.94,
};

test("ImageAnnotationSchema accepts the Gemini tag JSON", () => {
  assert.equal(ImageAnnotationSchema.safeParse(annotation).success, true);
});

test("ImageAnnotationSchema rejects bad fields", () => {
  const cases = [
    { ...annotation, subject: undefined },
    { ...annotation, caption: "" },
    { ...annotation, attributes: ["a", "b", "c", "d", "e", "f", "g", "h", "i"] },
    { ...annotation, confidence: 1.4 },
  ];
  for (const bad of cases) {
    assert.equal(ImageAnnotationSchema.safeParse(bad).success, false);
  }
});

const label = { label: "fox", score: 0.81, runnerUpLabel: "wolf", runnerUpScore: 0.11 };

test("ImageLabelSchema accepts labels from config.yaml", () => {
  assert.equal(ImageLabelSchema.safeParse(label).success, true);
  assert.equal(
    ImageLabelSchema.safeParse({ ...label, label: "cow", runnerUpLabel: "chicken" }).success,
    true,
  );
});

test("ImageLabelSchema rejects a label that is not in config.yaml", () => {
  assert.equal(ImageLabelSchema.safeParse({ ...label, label: "bison" }).success, false);
});
