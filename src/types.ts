import { z } from "zod";

export const IMAGE_LABELS = [
  "fox",
  "wolf",
  "dog",
  "cat",
  "big cat",
  "bear",
  "deer",
  "other",
] as const;

export const ImageLabelSchema = z.object({
  label: z.enum(IMAGE_LABELS),
  score: z.number().min(0).max(1),
  runnerUpLabel: z.enum(IMAGE_LABELS),
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
export type ImageLabelName = (typeof IMAGE_LABELS)[number];
