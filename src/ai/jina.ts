import path from "node:path";
import { AutoModel, AutoProcessor, RawImage, env } from "@huggingface/transformers";
import { embedModel, imagesDir, projectRoot } from "../config.js";
import {
  IMAGE_LABELS,
  ImageLabelSchema,
  type ImageLabel,
  type ImageLabelName,
} from "../types.js";

env.cacheDir = path.join(projectRoot, ".cache");

type JinaBundle = {
  processor: Awaited<ReturnType<typeof AutoProcessor.from_pretrained>>;
  model: Awaited<ReturnType<typeof AutoModel.from_pretrained>>;
};

let loaded: JinaBundle | undefined;

function softmax(values: number[]): number[] {
  const max = Math.max(...values);
  const exps = values.map((value) => Math.exp(value - max));
  const sum = exps.reduce((total, value) => total + value, 0);
  return exps.map((value) => value / sum);
}

function rowsFromTensor(tensor: {
  data: ArrayLike<number>;
  dims: number[];
  tolist?: () => unknown;
}): number[][] {
  if (typeof tensor.tolist === "function") {
    const list = tensor.tolist();
    if (Array.isArray(list) && Array.isArray(list[0])) {
      return list as number[][];
    }
    if (Array.isArray(list) && typeof list[0] === "number") {
      return [list as number[]];
    }
  }

  if (tensor.dims.length === 1) {
    return [Array.from(tensor.data)];
  }

  const rows = tensor.dims[0] ?? 1;
  const cols = tensor.dims[1] ?? tensor.data.length;
  const data = Array.from(tensor.data);
  const out: number[][] = [];
  for (let r = 0; r < rows; r++) {
    out.push(data.slice(r * cols, (r + 1) * cols));
  }
  return out;
}

function dot(a: number[], b: number[]): number {
  let sum = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    sum += (a[i] ?? 0) * (b[i] ?? 0);
  }
  return sum;
}

function promptFor(label: ImageLabelName): string {
  if (label === "other") {
    return "a photo of an animal";
  }
  return `a photo of a ${label}`;
}

export async function loadJina(): Promise<void> {
  await getModels();
}

async function getModels(): Promise<JinaBundle> {
  if (loaded) {
    return loaded;
  }

  const [processor, model] = await Promise.all([
    AutoProcessor.from_pretrained(embedModel),
    AutoModel.from_pretrained(embedModel, { dtype: "q4" }),
  ]);

  loaded = { processor, model };
  return loaded;
}

export async function embedAndLabel(
  filename: string,
): Promise<{ vector: number[]; labels: ImageLabel }> {
  const jina = await getModels();
  const image = await RawImage.read(path.join(imagesDir, filename));
  const prompts = IMAGE_LABELS.map(promptFor);
  const inputs = await jina.processor(prompts, [image], {
    padding: true,
    truncation: true,
  });
  const output = await jina.model(inputs);
  const imageRows = rowsFromTensor(output.l2norm_image_embeddings);
  const textRows = rowsFromTensor(output.l2norm_text_embeddings);
  const vector = imageRows[0];
  if (!vector) {
    throw new Error(`no image embedding for ${filename}`);
  }

  const scored = IMAGE_LABELS.map((name, index) => {
    const textVec = textRows[index];
    if (!textVec) {
      throw new Error(`no text embedding for label ${name}`);
    }
    return { name, raw: dot(vector, textVec) };
  });
  const probs = softmax(scored.map((entry) => entry.raw));
  const ranked = scored
    .map((entry, index) => ({
      name: entry.name,
      score: probs[index] ?? 0,
    }))
    .sort((a, b) => b.score - a.score);

  const top = ranked[0];
  const second = ranked[1];
  if (!top || !second) {
    throw new Error("need at least two labels");
  }

  const labels = ImageLabelSchema.parse({
    label: top.name,
    score: top.score,
    runnerUpLabel: second.name,
    runnerUpScore: second.score,
  });

  return { vector, labels };
}

export async function embedText(text: string): Promise<number[]> {
  const jina = await getModels();
  // This processor build expects text plus an image; a 1x1 placeholder is enough to take the text tower.
  const placeholder = new RawImage(new Uint8Array([0, 0, 0]), 1, 1, 3);
  const inputs = await jina.processor([text], [placeholder], {
    padding: true,
    truncation: true,
  });
  const output = await jina.model(inputs);
  const textRows = rowsFromTensor(output.l2norm_text_embeddings);
  const vector = textRows[0];
  if (!vector) {
    throw new Error("no text embedding");
  }
  return vector;
}
