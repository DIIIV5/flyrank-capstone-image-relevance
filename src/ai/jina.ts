import path from "node:path";
import { AutoModel, AutoProcessor, RawImage, env } from "@huggingface/transformers";
import {
  imagesDir,
  labels,
  projectRoot,
  promptForLabel,
  scoreScale,
  softmaxTemperature,
} from "../app-config.js";
import { embedModel } from "../config.js";
import { pickLabels, type LabelScore } from "../labels.js";
import type { ImageLabel } from "../types.js";

env.cacheDir = path.join(projectRoot, ".cache");

type Jina = {
  processor: Awaited<ReturnType<typeof AutoProcessor.from_pretrained>>;
  model: Awaited<ReturnType<typeof AutoModel.from_pretrained>>;
};

/** The parts of a Transformers.js tensor this module reads. The library types outputs as any. */
type EmbeddingTensor = { dims: number[]; data: ArrayLike<number> };

type ClipOutput = {
  l2norm_image_embeddings: EmbeddingTensor;
  l2norm_text_embeddings: EmbeddingTensor;
};

let loaded: Jina | undefined;

async function getJina(): Promise<Jina> {
  if (!loaded) {
    const [processor, model] = await Promise.all([
      AutoProcessor.from_pretrained(embedModel),
      AutoModel.from_pretrained(embedModel, { dtype: "q4" }),
    ]);
    loaded = { processor, model };
  }
  return loaded;
}

export async function loadJina(): Promise<void> {
  await getJina();
}

function tensorRows(tensor: EmbeddingTensor): number[][] {
  const data = Array.from(tensor.data);
  const cols = tensor.dims.length === 1 ? data.length : (tensor.dims[1] ?? data.length);
  const rows: number[][] = [];
  for (let start = 0; start < data.length; start += cols) {
    rows.push(data.slice(start, start + cols));
  }
  return rows;
}

function dot(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    sum += (a[i] ?? 0) * (b[i] ?? 0);
  }
  return sum;
}

/** Encodes texts and images together; this processor build needs both. */
async function encode(texts: string[], images: RawImage[]): Promise<ClipOutput> {
  const jina = await getJina();
  const inputs = await jina.processor(texts, images, { padding: true, truncation: true });
  const output: ClipOutput = await jina.model(inputs);
  return output;
}

/** Image vector plus the raw dot against every label prompt. */
export async function scoreImagePath(
  absPath: string,
): Promise<{ vector: number[]; scored: LabelScore[] }> {
  const prompts = labels.map((label) => promptForLabel(label));
  const output = await encode(prompts, [await RawImage.read(absPath)]);
  const vector = tensorRows(output.l2norm_image_embeddings)[0];
  if (!vector) {
    throw new Error(`no image embedding for ${absPath}`);
  }
  const textRows = tensorRows(output.l2norm_text_embeddings);
  if (textRows.length !== labels.length) {
    throw new Error(`expected ${labels.length} label embeddings, got ${textRows.length}`);
  }
  const scored = labels.map((name, index) => ({
    name,
    raw: dot(vector, textRows[index] ?? []),
  }));
  return { vector, scored };
}

export async function embedAndLabel(
  filename: string,
): Promise<{ vector: number[]; labels: ImageLabel }> {
  const { vector, scored } = await scoreImagePath(path.join(imagesDir, filename));
  const temperature = scoreScale === "softmax" ? softmaxTemperature : null;
  return { vector, labels: pickLabels(scored, temperature) };
}

export async function embedText(text: string): Promise<number[]> {
  const placeholder = new RawImage(new Uint8Array([0, 0, 0]), 1, 1, 3);
  const output = await encode([text], [placeholder]);
  const vector = tensorRows(output.l2norm_text_embeddings)[0];
  if (!vector) {
    throw new Error("no text embedding");
  }
  return vector;
}
