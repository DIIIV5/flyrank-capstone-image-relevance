import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

const here = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.resolve(here, "..");

const labelName = z.string().regex(/^[a-z][a-z0-9_]*$/);

export const AppConfigSchema = z
  .object({
    labels: z.array(labelName).min(2),
    catch_all: labelName.optional(),
    score_scale: z.enum(["raw", "softmax"]),
    softmax_temperature: z.number().positive().default(1),
    label_score_min: z.number(),
    label_margin_min: z.number(),
    cosine_min: z.number(),
    check_flagged: z.boolean(),
    label_prompts: z.record(z.string(), z.string()).optional(),
    paths: z.object({
      corpus: z.string().min(1),
      posts: z.string().min(1),
      matching_gold: z.string().min(1),
      label_eval: z.record(z.string(), z.string()),
    }),
  })
  .superRefine((data, ctx) => {
    const set = new Set(data.labels);
    if (set.size !== data.labels.length) {
      ctx.addIssue({ code: "custom", message: "labels must be unique", path: ["labels"] });
    }
    if (data.catch_all && !set.has(data.catch_all)) {
      ctx.addIssue({
        code: "custom",
        message: "catch_all must be in labels",
        path: ["catch_all"],
      });
    }
    for (const name of data.labels) {
      if (!data.paths.label_eval[name]) {
        ctx.addIssue({
          code: "custom",
          message: `missing label_eval folder for ${name}`,
          path: ["paths", "label_eval", name],
        });
      }
    }
    for (const key of Object.keys(data.paths.label_eval)) {
      if (!set.has(key)) {
        ctx.addIssue({
          code: "custom",
          message: `label_eval key ${key} is not in labels`,
          path: ["paths", "label_eval", key],
        });
      }
    }
    for (const key of Object.keys(data.label_prompts ?? {})) {
      if (!set.has(key)) {
        ctx.addIssue({
          code: "custom",
          message: `label_prompts key ${key} is not in labels`,
          path: ["label_prompts", key],
        });
      }
    }
  });

export type AppConfigFile = z.infer<typeof AppConfigSchema>;

export function parseAppConfig(raw: unknown): AppConfigFile {
  return AppConfigSchema.parse(raw);
}

function loadFile(): AppConfigFile {
  const filePath = path.join(projectRoot, "config.yaml");
  const text = fs.readFileSync(filePath, "utf8");
  return parseAppConfig(parseYaml(text));
}

const file = loadFile();

export const labels: string[] = file.labels;
export const catchAll: string | undefined = file.catch_all;
export const scoreScale: "raw" | "softmax" = file.score_scale;
export const softmaxTemperature = file.softmax_temperature;
export const labelScoreMin = file.label_score_min;
export const labelMarginMin = file.label_margin_min;
export const cosineMin = file.cosine_min;
export const checkFlagged = file.check_flagged;
export const labelPrompts: Record<string, string> = file.label_prompts ?? {};

function abs(relative: string): string {
  return path.resolve(projectRoot, relative);
}

export const imagesDir = abs(file.paths.corpus);
export const postsDir = abs(file.paths.posts);
export const matchingGoldPath = abs(file.paths.matching_gold);
export const evalDir = path.dirname(matchingGoldPath);
export const labelEvalDirs: Record<string, string> = Object.fromEntries(
  Object.entries(file.paths.label_eval).map(([name, relative]) => [name, abs(relative)]),
);

export function isConfiguredLabel(name: string): boolean {
  return labels.includes(name);
}

export function promptForLabel(label: string): string {
  const custom = labelPrompts[label];
  if (custom) {
    return custom;
  }
  if (catchAll && label === catchAll) {
    return "a photo of an animal";
  }
  return `a photo of a ${label}`;
}
