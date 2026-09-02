import {
  catchAll,
  checkFlagged,
  cosineMin,
  labelMarginMin,
  labelScoreMin,
  labels,
} from "./app-config.js";
import type { Decision } from "./types.js";

export type GuardImage = {
  label: string | null;
  labelScore: number | null;
  runnerUpScore: number | null;
  subject: string | null;
};

export type GuardPair = {
  expectedLabel: string | null;
  similarity: number;
  image: GuardImage;
};

export type GuardRules = {
  cosineMin: number;
  labelScoreMin: number;
  labelMarginMin: number;
  checkFlagged: boolean;
  requireSubject: boolean;
};

export type GuardResult = { decision: Decision; reason: string };

/** Defaults come from config.yaml. Gemini annotation is optional, so a missing subject passes. */
export const defaultGuardRules: GuardRules = {
  cosineMin,
  labelScoreMin,
  labelMarginMin,
  checkFlagged,
  requireSubject: false,
};

const labelsLongestFirst = [...labels]
  .filter((name) => name !== catchAll)
  .sort((a, b) => b.length - a.length);

/** Finds the first configured label named inside the Gemini subject, longest label first. */
export function subjectAgreesWithLabel(
  subject: string,
  label: string | null,
): "agree" | "disagree" | "skip" {
  const text = subject.toLowerCase();
  const found = labelsLongestFirst.find((name) => text.includes(name));
  if (!found) {
    return "skip";
  }
  return found === label ? "agree" : "disagree";
}

const reject = (reason: string): GuardResult => ({ decision: "rejected", reason });

/** Checks run in order; the first failure is the reason. */
export function guard(pair: GuardPair, rules: GuardRules = defaultGuardRules): GuardResult {
  const { image, similarity, expectedLabel } = pair;

  if (similarity < rules.cosineMin) {
    return reject(
      `similarity below threshold (${similarity.toFixed(2)} < ${rules.cosineMin.toFixed(2)})`,
    );
  }

  const score = image.labelScore ?? 0;
  const margin = score - (image.runnerUpScore ?? 0);
  if (rules.checkFlagged && (score < rules.labelScoreMin || margin < rules.labelMarginMin)) {
    return reject(
      `uncertain subject: label score ${score.toFixed(2)}, margin ${margin.toFixed(2)}`,
    );
  }

  if (expectedLabel && image.label !== expectedLabel) {
    return reject(`subject mismatch: expected ${expectedLabel}, detected ${image.label ?? "none"}`);
  }

  const subject = image.subject?.trim() ?? "";
  if (!subject && rules.requireSubject) {
    return reject("missing metadata");
  }
  if (subject && subjectAgreesWithLabel(subject, image.label) === "disagree") {
    return reject(
      `metadata disagreement: Gemini subject "${subject}", Jina label ${image.label ?? "none"}`,
    );
  }

  return { decision: "suggested", reason: "cleared the guard" };
}
