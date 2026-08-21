import type { ImageLabel } from "./types.js";

export const labelScoreMin = 0.7;
export const labelMarginMin = 0.15;

export function labelStatus(labels: ImageLabel): "processed" | "flagged" {
  const margin = labels.score - labels.runnerUpScore;
  if (labels.score >= labelScoreMin && margin >= labelMarginMin) {
    return "processed";
  }
  return "flagged";
}
