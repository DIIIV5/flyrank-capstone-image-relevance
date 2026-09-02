import fs from "node:fs/promises";
import path from "node:path";
import { GoogleGenerativeAI, type GenerationConfig } from "@google/generative-ai";
import { imagesDir } from "../app-config.js";
import { geminiApiKey, geminiModel } from "../config.js";
import { ImageAnnotationSchema, type ImageAnnotation } from "../types.js";

const mimeByExt: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

// The SDK types do not include thinkingConfig, but the API accepts it.
// gemini-3.7-flash rejects "minimal" with HTTP 400, so "low" is the floor.
type ThinkingGenerationConfig = GenerationConfig & {
  thinkingConfig: { thinkingLevel: "low" };
};

const generationConfig: ThinkingGenerationConfig = {
  responseMimeType: "application/json",
  temperature: 0.2,
  thinkingConfig: { thinkingLevel: "low" },
};

const prompt = `Describe this animal photo as JSON with exactly these fields:
- subject: short name of the main animal (e.g. "red fox")
- category: coarse category (e.g. "animal")
- attributes: 0 to 8 short visual tags
- caption: one sentence of alt text. Say what is in the photo. Do not start with "image of" or "a picture of"
- confidence: number from 0 to 1
No other keys.`;

export async function annotateImage(filename: string): Promise<ImageAnnotation> {
  if (!geminiApiKey) {
    throw new Error("GEMINI_API_KEY is not set");
  }
  const mimeType = mimeByExt[path.extname(filename).toLowerCase()];
  if (!mimeType) {
    throw new Error(`unsupported image type: ${filename}`);
  }

  const bytes = await fs.readFile(path.join(imagesDir, filename));
  const model = new GoogleGenerativeAI(geminiApiKey).getGenerativeModel({
    model: geminiModel,
    generationConfig,
  });

  const result = await model.generateContent([
    { text: prompt },
    { inlineData: { mimeType, data: bytes.toString("base64") } },
  ]);
  return ImageAnnotationSchema.parse(JSON.parse(result.response.text()));
}
