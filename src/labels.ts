import {
  labelMarginMin as configMarginMin,
  labelScoreMin as configScoreMin,
} from "./app-config.js";
import type { ImageLabel } from "./types.js";

export const labelScoreMin = configScoreMin;
export const labelMarginMin = configMarginMin;

export function softmax(values: number[], temperature = 1): number[] {
  const t = temperature <= 0 ? 1 : temperature;
  const scaled = values.map((value) => value / t);
  const max = Math.max(...scaled);
  const exps = scaled.map((value) => Math.exp(value - max));
  const sum = exps.reduce((total, value) => total + value, 0);
  if (sum === 0) {
    return values.map(() => 0);
  }
  return exps.map((value) => value / sum);
}

export function labelStatus(labels: ImageLabel): "processed" | "flagged" {
  const margin = labels.score - labels.runnerUpScore;
  if (labels.score >= labelScoreMin && margin >= labelMarginMin) {
    return "processed";
  }
  return "flagged";
}
