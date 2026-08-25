import { z } from "zod";
import { isConfiguredLabel } from "./app-config.js";

export const ImageLabelSchema = z.object({
  label: z.string().refine(isConfiguredLabel, { message: "unknown label" }),
  score: z.number().min(0).max(1),
  runnerUpLabel: z.string().refine(isConfiguredLabel, { message: "unknown label" }),
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
export type ImageLabelName = string;
