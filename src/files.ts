import path from "node:path";

const imageExts = new Set([".jpg", ".jpeg", ".png", ".webp"]);

export function isImageFile(filename: string): boolean {
  return imageExts.has(path.extname(filename).toLowerCase());
}
