import fs from "node:fs/promises";
import path from "node:path";
import { evalDir, labelEvalDirs, labels } from "../app-config.js";
import { scoreImagePath } from "../ai/jina.js";
import { softmax } from "../labels.js";

const imageExts = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const temperatures = [0.05, 0.1, 0.2, 0.5, 1, 2];
const softmaxScoreFloors = [0.12, 0.15, 0.2, 0.25, 0.3, 0.4];
const softmaxMargins = [0.01, 0.02, 0.05, 0.1, 0.15];
const rawScoreFloors = [0.2, 0.22, 0.25, 0.28, 0.3];

type Sample = {
  gold: string;
  filename: string;
  scored: { name: string; raw: number }[];
};

function argmax(scored: { name: string; raw: number }[]): string {
  let best = scored[0];
  if (!best) {
    throw new Error("empty scores");
  }
  for (const entry of scored) {
    if (entry.raw > best.raw) {
      best = entry;
    }
  }
  return best.name;
}

function ranked(
  scored: { name: string; raw: number }[],
  temperature: number | null,
): { name: string; score: number }[] {
  const values =
    temperature === null
      ? scored.map((entry) => entry.raw)
      : softmax(
          scored.map((entry) => entry.raw),
          temperature,
        );
  return scored
    .map((entry, index) => ({ name: entry.name, score: values[index] ?? 0 }))
    .sort((a, b) => b.score - a.score);
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const left = sorted[lo] ?? 0;
  const right = sorted[hi] ?? 0;
  if (lo === hi) {
    return left;
  }
  return left * (1 - (idx - lo)) + right * (idx - lo);
}

function stats(values: number[]): { mean: number; p50: number; p90: number } {
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
  return { mean, p50: percentile(sorted, 0.5), p90: percentile(sorted, 0.9) };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

const samples: Sample[] = [];
for (const gold of labels) {
  const dir = labelEvalDirs[gold];
  if (!dir) {
    continue;
  }
  let files: string[] = [];
  try {
    files = (await fs.readdir(dir)).sort();
  } catch {
    console.log(`skip missing eval folder ${gold}: ${dir}`);
    continue;
  }
  for (const filename of files) {
    const ext = path.extname(filename).toLowerCase();
    if (!imageExts.has(ext)) {
      continue;
    }
    const absPath = path.join(dir, filename);
    process.stdout.write(`scoring ${gold}/${filename}\n`);
    const { scored } = await scoreImagePath(absPath);
    samples.push({ gold, filename, scored });
  }
}

const predicted = samples.map((sample) => argmax(sample.scored));
const correct = samples.filter((sample, index) => predicted[index] === sample.gold).length;
const accuracy = samples.length === 0 ? 0 : correct / samples.length;

const confusion: Record<string, Record<string, number>> = {};
for (const gold of labels) {
  confusion[gold] = Object.fromEntries(labels.map((name) => [name, 0]));
}
for (let i = 0; i < samples.length; i++) {
  const sample = samples[i];
  const pred = predicted[i];
  if (!sample || !pred) {
    continue;
  }
  const row = confusion[sample.gold];
  if (row) {
    row[pred] = (row[pred] ?? 0) + 1;
  }
}

const perClass: Record<string, unknown> = {};
for (const gold of labels) {
  const classSamples = samples.filter((sample) => sample.gold === gold);
  const winningRaw: number[] = [];
  const softmaxT1: number[] = [];
  const marginRaw: number[] = [];
  const marginT1: number[] = [];
  for (const sample of classSamples) {
    const rawRank = ranked(sample.scored, null);
    const softRank = ranked(sample.scored, 1);
    winningRaw.push(rawRank[0]?.score ?? 0);
    softmaxT1.push(softRank[0]?.score ?? 0);
    marginRaw.push((rawRank[0]?.score ?? 0) - (rawRank[1]?.score ?? 0));
    marginT1.push((softRank[0]?.score ?? 0) - (softRank[1]?.score ?? 0));
  }
  perClass[gold] = {
    n: classSamples.length,
    winningRaw: stats(winningRaw),
    softmaxT1: stats(softmaxT1),
    marginRaw: stats(marginRaw),
    marginT1: stats(marginT1),
  };
}

function grid(
  floors: number[],
  margins: number[],
  temperature: number | null,
): { scoreMin: number; marginMin: number; processed: number; flagged: number; top1AmongProcessed: number }[] {
  const rows = [];
  for (const scoreMin of floors) {
    for (const marginMin of margins) {
      let processed = 0;
      let processedCorrect = 0;
      for (const sample of samples) {
        const rank = ranked(sample.scored, temperature);
        const top = rank[0];
        const second = rank[1];
        if (!top || !second) {
          continue;
        }
        const margin = top.score - second.score;
        if (top.score >= scoreMin && margin >= marginMin) {
          processed += 1;
          if (top.name === sample.gold) {
            processedCorrect += 1;
          }
        }
      }
      const flagged = samples.length - processed;
      rows.push({
        scoreMin,
        marginMin,
        processed,
        flagged,
        top1AmongProcessed: processed === 0 ? 0 : processedCorrect / processed,
      });
    }
  }
  return rows;
}

const winningSoftmax = samples.map((sample) => ranked(sample.scored, 1)[0]?.score ?? 0);
const softMin = Math.min(...winningSoftmax);
const softMax = Math.max(...winningSoftmax);
const winningRawAll = samples.map((sample) => ranked(sample.scored, null)[0]?.score ?? 0);
const rawMin = Math.min(...winningRawAll);
const rawMax = Math.max(...winningRawAll);

const report = {
  n: samples.length,
  top1Accuracy: accuracy,
  confusion,
  perClass,
  temperatures,
  softmaxT1Grid: grid(softmaxScoreFloors, softmaxMargins, 1),
  rawDotRange: { min: rawMin, max: rawMax },
  rawDotGrid: grid(rawScoreFloors, softmaxMargins, null),
  softmaxWinRange: { min: softMin, max: softMax },
};

console.log(`Top-1 accuracy: ${(accuracy * 100).toFixed(1)}% on ${samples.length} photos`);
console.log("confusion (gold → predicted):");
const header = ["gold", ...labels].join("\t");
console.log(header);
for (const gold of labels) {
  const row = confusion[gold] ?? {};
  console.log([gold, ...labels.map((name) => String(row[name] ?? 0))].join("\t"));
}
console.log("winning raw dots min/max:", round(rawMin), round(rawMax));
console.log("winning softmax T=1 min/max:", round(softMin), round(softMax));
console.log("softmax T=1 grid (scoreMin, marginMin, processed, flagged, top1AmongProcessed):");
for (const row of report.softmaxT1Grid) {
  console.log(
    `${row.scoreMin}\t${row.marginMin}\t${row.processed}\t${row.flagged}\t${round(row.top1AmongProcessed)}`,
  );
}
console.log("raw-dot grid:");
for (const row of report.rawDotGrid) {
  console.log(
    `${row.scoreMin}\t${row.marginMin}\t${row.processed}\t${row.flagged}\t${round(row.top1AmongProcessed)}`,
  );
}

await fs.mkdir(evalDir, { recursive: true });
await fs.writeFile(path.join(evalDir, "label-sweep.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(`wrote ${path.join("data", "eval", "label-sweep.json")}`);
