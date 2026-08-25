import { catchAll, checkFlagged, cosineMin, labels } from "./app-config.js";
import { labelMarginMin, labelScoreMin } from "./labels.js";

export { cosineMin };

/** Guard check 2. Value comes from config.yaml check_flagged. */
export const guardCheckFlagged = checkFlagged;

/** Annotate hit the Gemini quota, so most rows have no subject. */
export const guardRequireGeminiTags = false;

export type GuardImage = {
  filename: string;
  label: string | null;
  labelScore: number | null;
  runnerUpScore: number | null;
  status: string;
  subject: string | null;
};

export type GuardInput = {
  expectedLabel: string | null;
  similarity: number;
  cosineMin: number;
  requireGeminiTags: boolean;
  checkFlagged?: boolean;
  image: GuardImage;
};

const labelsLongestFirst = [...labels].sort((a, b) => b.length - a.length);

export function subjectAgreesWithLabel(
  subject: string,
  label: string,
): "agree" | "disagree" | "skip" {
  const text = subject.toLowerCase();
  const found = labelsLongestFirst.find((name) => {
    if (catchAll && name === catchAll) {
      return false;
    }
    return text.includes(name);
  });
  if (!found) {
    return "skip";
  }
  if (found === label) {
    return "agree";
  }
  return "disagree";
}

export function guard(input: GuardInput): {
  decision: "suggested" | "rejected";
  reason: string;
} {
  const { image, similarity } = input;
  const floor = input.cosineMin;

  // 1. Cosine similarity below the floor.
  if (similarity < floor) {
    return {
      decision: "rejected",
      reason: `similarity below threshold (${similarity.toFixed(2)} < ${floor.toFixed(2)})`,
    };
  }

  // 2. Flagged image or a weak Jina score/margin.
  const check = input.checkFlagged ?? guardCheckFlagged;
  if (check) {
    const score = image.labelScore ?? 0;
    const margin = (image.labelScore ?? 0) - (image.runnerUpScore ?? 0);
    if (image.status === "flagged" || score < labelScoreMin || margin < labelMarginMin) {
      return {
        decision: "rejected",
        reason: `uncertain subject: label score ${score.toFixed(2)}, margin ${margin.toFixed(2)}`,
      };
    }
  }

  // 3. Top1 minus top2 gap — not implemented. No number was set for it.

  // 4. Post species vs image label.
  if (input.expectedLabel && image.label !== input.expectedLabel) {
    return {
      decision: "rejected",
      reason: `subject mismatch: expected ${input.expectedLabel}, detected ${image.label ?? "none"}`,
    };
  }

  // 5. Gemini subject vs Jina label.
  const subject = image.subject?.trim() ?? "";
  if (!subject) {
    if (input.requireGeminiTags) {
      return {
        decision: "rejected",
        reason: "missing metadata",
      };
    }
  } else {
    const agreement = subjectAgreesWithLabel(subject, image.label ?? "");
    if (agreement === "disagree") {
      return {
        decision: "rejected",
        reason: `metadata disagreement: Gemini subject "${subject}", Jina label ${image.label ?? "none"}`,
      };
    }
  }

  return { decision: "suggested", reason: "cleared the guard" };
}
