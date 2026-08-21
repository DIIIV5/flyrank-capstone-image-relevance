import fs from "node:fs/promises";
import path from "node:path";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { geminiApiKey, geminiModel, geminiThinkingLevel, imagesDir } from "../config.js";

const mimeByExt: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

const prompt = `Describe this animal photo as JSON with exactly these fields:
- subject: short name of the main animal (e.g. "red fox")
- category: coarse category (e.g. "animal")
- attributes: 0 to 8 short visual tags
- caption: one sentence of alt text. Say what is in the photo. Do not start with "image of" or "a picture of"
- confidence: number from 0 to 1
No other keys.`;

export async function annotateImage(filename: string): Promise<unknown> {
  if (!geminiApiKey) {
    throw new Error("GEMINI_API_KEY is not set");
  }

  const ext = path.extname(filename).toLowerCase();
  const mimeType = mimeByExt[ext];
  if (!mimeType) {
    throw new Error(`unsupported image type: ${ext}`);
  }

  const bytes = await fs.readFile(path.join(imagesDir, filename));
  const genAI = new GoogleGenerativeAI(geminiApiKey);
  const generationConfig = {
    responseMimeType: "application/json",
    temperature: 0.2,
    thinkingConfig: { thinkingLevel: geminiThinkingLevel },
  };
  const model = genAI.getGenerativeModel({
    model: geminiModel,
    generationConfig,
  });

  const result = await model.generateContent([
    { text: prompt },
    {
      inlineData: {
        mimeType,
        data: bytes.toString("base64"),
      },
    },
  ]);

  const text = result.response.text();
  return JSON.parse(text) as unknown;
}
