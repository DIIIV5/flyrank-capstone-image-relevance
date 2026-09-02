import fs from "node:fs/promises";
import path from "node:path";
import { scoreImagePath } from "../ai/jina.js";
import {
  evalDir,
  labelEvalDirs,
  labelMarginMin,
  labelScoreMin,
  labels,
  scoreScale,
  softmaxTemperature,
} from "../app-config.js";
import { isImageFile } from "../files.js";
import { rankLabels, type LabelScore } from "../labels.js";

// Grid axes for choosing label_score_min and label_margin_min in config.yaml.
const margins = [0.01, 0.02, 0.05, 0.1, 0.15];
const softmaxFloors = [0.12, 0.15, 0.2, 0.25, 0.3, 0.4];
const rawFloors = [0.2, 0.22, 0.25, 0.28, 0.3];

type Sample = { gold: string; filename: string; scored: LabelScore[] };

type GridRow = {
  scoreMin: number;
  marginMin: number;
  processed: number;
  flagged: number;
  top1: number;
};

const round = (value: number): number => Math.round(value * 1000) / 1000;

/** Winner and margin for one photo under one scale; null when there are fewer than two labels. */
function winner(
  sample: Sample,
  temperature: number | null,
): { name: string; score: number; margin: number } | null {
  const [top, second] = rankLabels(sample.scored, temperature);
  if (!top || !second) {
    return null;
  }
  return { name: top.name, score: top.score, margin: top.score - second.score };
}

/** For each threshold pair: how many photos pass the flag rule, and how often the winner is right. */
function grid(samples: Sample[], floors: number[], temperature: number | null): GridRow[] {
  const rows: GridRow[] = [];
  for (const scoreMin of floors) {
    for (const marginMin of margins) {
      let processed = 0;
      let correct = 0;
      for (const sample of samples) {
        const top = winner(sample, temperature);
        if (!top || top.score < scoreMin || top.margin < marginMin) {
          continue;
        }
        processed += 1;
        correct += top.name === sample.gold ? 1 : 0;
      }
      rows.push({
        scoreMin,
        marginMin,
        processed,
        flagged: samples.length - processed,
        top1: processed === 0 ? 0 : correct / processed,
      });
    }
  }
  return rows;
}

function printGrid(title: string, rows: GridRow[]): void {
  console.log(`${title} (scoreMin, marginMin, processed, flagged, top1AmongProcessed):`);
  for (const row of rows) {
    const cells = [row.scoreMin, row.marginMin, row.processed, row.flagged, round(row.top1)];
    console.log(cells.join("\t"));
  }
}

const samples: Sample[] = [];
for (const gold of labels) {
  const dir = labelEvalDirs[gold];
  if (!dir) {
    continue;
  }
  const files = await fs.readdir(dir).catch(() => {
    console.log(`skip missing eval folder ${gold}: ${dir}`);
    return [];
  });
  for (const filename of files.filter(isImageFile).sort()) {
    console.log(`scoring ${gold}/${filename}`);
    const { scored } = await scoreImagePath(path.join(dir, filename));
    samples.push({ gold, filename, scored });
  }
}

const rawWinners = samples.map((sample) => winner(sample, null));
const correct = rawWinners.filter((top, i) => top?.name === samples[i]?.gold).length;
const accuracy = samples.length === 0 ? 0 : correct / samples.length;

const confusion: Record<string, Record<string, number>> = Object.fromEntries(
  labels.map((gold) => [gold, Object.fromEntries(labels.map((name) => [name, 0]))]),
);
samples.forEach((sample, i) => {
  const predicted = rawWinners[i]?.name;
  const row = confusion[sample.gold];
  if (row && predicted) {
    row[predicted] = (row[predicted] ?? 0) + 1;
  }
});

const range = (values: number[]) => ({ min: Math.min(...values), max: Math.max(...values) });
const rawWins = rawWinners.map((top) => top?.score ?? 0);
const softmaxWins = samples.map((sample) => winner(sample, 1)?.score ?? 0);

// Photos the committed config.yaml thresholds would flag.
const configTemperature = scoreScale === "softmax" ? softmaxTemperature : null;
const flaggedByConfig = samples.flatMap((sample) => {
  const top = winner(sample, configTemperature);
  if (!top || (top.score >= labelScoreMin && top.margin >= labelMarginMin)) {
    return [];
  }
  return [
    {
      photo: `${sample.gold}/${sample.filename}`,
      label: top.name,
      score: top.score,
      margin: top.margin,
    },
  ];
});

const report = {
  n: samples.length,
  top1Accuracy: accuracy,
  confusion,
  rawDotRange: range(rawWins),
  rawDotGrid: grid(samples, rawFloors, null),
  softmaxWinRange: range(softmaxWins),
  softmaxT1Grid: grid(samples, softmaxFloors, 1),
  flaggedByConfig,
};

console.log(`Top-1 accuracy: ${(accuracy * 100).toFixed(1)}% on ${samples.length} photos`);
console.log("confusion (gold → predicted):");
console.log(["gold", ...labels].join("\t"));
for (const gold of labels) {
  const counts = labels.map((name) => String(confusion[gold]?.[name] ?? 0));
  console.log([gold, ...counts].join("\t"));
}
const { rawDotRange, softmaxWinRange } = report;
console.log("winning raw dots min/max:", round(rawDotRange.min), round(rawDotRange.max));
console.log("winning softmax T=1 min/max:", round(softmaxWinRange.min), round(softmaxWinRange.max));
printGrid("raw-dot grid", report.rawDotGrid);
printGrid("softmax T=1 grid", report.softmaxT1Grid);

console.log(
  `flagged by config.yaml (${scoreScale}, score >= ${labelScoreMin}, margin >= ${labelMarginMin}):`,
);
for (const row of flaggedByConfig) {
  const cells = [row.photo, row.label, `score ${round(row.score)}`, `margin ${round(row.margin)}`];
  console.log(`  ${cells.join("\t")}`);
}

const reportPath = path.join(evalDir, "label-sweep.json");
await fs.mkdir(evalDir, { recursive: true });
await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`wrote ${path.relative(process.cwd(), reportPath)}`);
