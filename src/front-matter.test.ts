import assert from "node:assert/strict";
import { test } from "node:test";
import { isImageFile } from "./files.js";
import { parseFrontMatter } from "./front-matter.js";

const fox = `---
title: The behaviour of red foxes
expected_label: fox
---

Vulpes vulpes is a canid.
`;

test("parseFrontMatter reads title, expected_label, and body", () => {
  assert.deepEqual(parseFrontMatter(fox, "red-fox.md"), {
    title: "The behaviour of red foxes",
    expectedLabel: "fox",
    body: "Vulpes vulpes is a canid.",
  });
});

test("parseFrontMatter handles a BOM, CRLF line endings, and lines without a colon", () => {
  const text = "\uFEFF---\r\ntitle: Coral bleaching\r\nno colon here\r\n---\r\nBody.\r\n";
  assert.deepEqual(parseFrontMatter(text, "coral.md"), {
    title: "Coral bleaching",
    expectedLabel: null,
    body: "Body.",
  });
});

test("parseFrontMatter treats an empty expected_label as none", () => {
  const text = "---\ntitle: Steam turbines\nexpected_label:\n---\nBody.";
  assert.equal(parseFrontMatter(text, "turbine.md").expectedLabel, null);
});

test("parseFrontMatter rejects malformed files", () => {
  assert.throws(() => parseFrontMatter("title: x\n", "a.md"), /missing front matter/);
  assert.throws(() => parseFrontMatter("---\ntitle: x\n", "b.md"), /unclosed front matter/);
  assert.throws(() => parseFrontMatter("---\nexpected_label: fox\n---\n", "c.md"), /missing title/);
  assert.throws(
    () => parseFrontMatter("---\ntitle: x\nexpected_label: bison\n---\n", "d.md"),
    /unknown expected_label bison/,
  );
});

test("isImageFile accepts jpg, jpeg, png, and webp in any case", () => {
  for (const name of ["a.jpg", "b.JPEG", "c.png", "d.webp"]) {
    assert.equal(isImageFile(name), true, name);
  }
  for (const name of ["e.gif", "f.md", "g"]) {
    assert.equal(isImageFile(name), false, name);
  }
});
