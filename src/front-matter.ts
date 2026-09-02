import { isConfiguredLabel } from "./app-config.js";

export type ParsedPost = {
  title: string;
  expectedLabel: string | null;
  body: string;
};

/** Reads `title` and optional `expected_label` from a `---` block at the top of a Markdown file. */
export function parseFrontMatter(raw: string, filename: string): ParsedPost {
  const text = raw.replace(/^\uFEFF/, "");
  if (!text.startsWith("---")) {
    throw new Error(`${filename} is missing front matter`);
  }
  const end = text.indexOf("\n---", 3);
  if (end === -1) {
    throw new Error(`${filename} has unclosed front matter`);
  }

  const fields = new Map<string, string>();
  for (const line of text.slice(3, end).split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon !== -1) {
      fields.set(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
    }
  }

  const title = fields.get("title");
  if (!title) {
    throw new Error(`${filename} is missing title`);
  }
  const expectedLabel = fields.get("expected_label") ?? null;
  if (expectedLabel && !isConfiguredLabel(expectedLabel)) {
    throw new Error(`${filename} has unknown expected_label ${expectedLabel}`);
  }

  return {
    title,
    expectedLabel: expectedLabel || null,
    body: text.slice(end + 4).replace(/^\r?\n/, "").trim(),
  };
}
