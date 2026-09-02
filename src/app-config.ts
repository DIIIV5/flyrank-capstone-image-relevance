import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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
    const known = new Set(data.labels);
    const issue = (message: string, ...pathParts: string[]) =>
      ctx.addIssue({ code: "custom", message, path: pathParts });

    if (known.size !== data.labels.length) {
      issue("labels must be unique", "labels");
    }
    if (data.catch_all && !known.has(data.catch_all)) {
      issue("catch_all must be in labels", "catch_all");
    }
    for (const name of data.labels) {
      if (!data.paths.label_eval[name]) {
        issue(`missing label_eval folder for ${name}`, "paths", "label_eval", name);
      }
    }
    for (const key of Object.keys(data.paths.label_eval)) {
      if (!known.has(key)) {
        issue(`label_eval key ${key} is not in labels`, "paths", "label_eval", key);
      }
    }
    for (const key of Object.keys(data.label_prompts ?? {})) {
      if (!known.has(key)) {
        issue(`label_prompts key ${key} is not in labels`, "label_prompts", key);
      }
    }
  });

export type AppConfig = z.infer<typeof AppConfigSchema>;
export type ScoreScale = AppConfig["score_scale"];

export function parseAppConfig(raw: object): AppConfig {
  return AppConfigSchema.parse(raw);
}

const file = parseAppConfig(
  parseYaml(fs.readFileSync(path.join(projectRoot, "config.yaml"), "utf8")),
);

const abs = (relative: string): string => path.resolve(projectRoot, relative);

export const labels: string[] = file.labels;
export const catchAll: string | undefined = file.catch_all;
export const scoreScale: ScoreScale = file.score_scale;
export const softmaxTemperature = file.softmax_temperature;
export const labelScoreMin = file.label_score_min;
export const labelMarginMin = file.label_margin_min;
export const cosineMin = file.cosine_min;
export const checkFlagged = file.check_flagged;

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

export function promptForLabel(
  label: string,
  config: Pick<AppConfig, "label_prompts" | "catch_all"> = file,
): string {
  const custom = config.label_prompts?.[label];
  if (custom) {
    return custom;
  }
  return label === config.catch_all ? "a photo of an animal" : `a photo of a ${label}`;
}
