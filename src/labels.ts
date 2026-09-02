import { labelMarginMin, labelScoreMin } from "./app-config.js";
import { ImageLabelSchema, type ImageLabel, type ImageStatus } from "./types.js";

/** One label prompt and its raw image-text dot product from CLIP. */
export type LabelScore = { name: string; raw: number };

export type RankedLabel = { name: string; score: number };

/** Maps one value from `values` to its softmax probability. */
function softmaxScaler(values: number[], temperature: number): (value: number) => number {
  const max = Math.max(...values);
  const exp = (value: number) => Math.exp((value - max) / temperature);
  const sum = values.reduce((total, value) => total + exp(value), 0);
  return (value) => exp(value) / sum;
}

export function softmax(values: number[], temperature: number): number[] {
  return values.map(softmaxScaler(values, temperature));
}

/** Sort labels by score. `temperature` null keeps raw dots; a number applies softmax. */
export function rankLabels(scored: LabelScore[], temperature: number | null): RankedLabel[] {
  const raw = scored.map((entry) => entry.raw);
  const scale = temperature === null ? (value: number) => value : softmaxScaler(raw, temperature);
  return scored
    .map((entry) => ({ name: entry.name, score: scale(entry.raw) }))
    .sort((a, b) => b.score - a.score);
}

export function pickLabels(scored: LabelScore[], temperature: number | null): ImageLabel {
  const [top, second] = rankLabels(scored, temperature);
  if (!top || !second) {
    throw new Error("need at least two labels");
  }
  return ImageLabelSchema.parse({
    label: top.name,
    score: top.score,
    runnerUpLabel: second.name,
    runnerUpScore: second.score,
  });
}

export function labelStatus(
  labels: ImageLabel,
  scoreMin = labelScoreMin,
  marginMin = labelMarginMin,
): ImageStatus {
  const margin = labels.score - labels.runnerUpScore;
  return labels.score >= scoreMin && margin >= marginMin ? "processed" : "flagged";
}
