import { z } from "zod";
import { isConfiguredLabel } from "./app-config.js";

const configuredLabel = z.string().refine(isConfiguredLabel, { message: "unknown label" });

export const ImageLabelSchema = z.object({
  label: configuredLabel,
  score: z.number().min(0).max(1),
  runnerUpLabel: configuredLabel,
  runnerUpScore: z.number().min(0).max(1),
});

export const ImageAnnotationSchema = z.object({
  subject: z.string().min(1).max(80),
  category: z.string().min(1).max(80),
  attributes: z.array(z.string().min(1)).max(8),
  caption: z.string().min(1).max(300),
  confidence: z.number().min(0).max(1),
});

export type ImageLabel = z.infer<typeof ImageLabelSchema>;
export type ImageAnnotation = z.infer<typeof ImageAnnotationSchema>;

export type ImageStatus = "processed" | "flagged";
export type Decision = "suggested" | "rejected";
export type Review = "approved" | "rejected";

export type PostRow = {
  id: string;
  title: string;
  body: string;
  expected_label: string | null;
};

export type ImageCandidate = {
  id: string;
  filename: string;
  label: string | null;
  labelScore: number | null;
  runnerUpScore: number | null;
  subject: string | null;
  caption: string | null;
  vector: number[];
};

export type SuggestionWrite = {
  imageId: string | null;
  rank: number | null;
  similarity: number | null;
  decision: Decision | "no_confident_match";
  reason: string;
};

export type SuggestionRow = {
  id: string;
  filename: string | null;
  caption: string | null;
  label: string | null;
  labelScore: number | null;
  runnerUpScore: number | null;
  similarity: number | null;
  decision: string;
  reason: string;
  review: string | null;
  reviewedAt: Date | null;
};
