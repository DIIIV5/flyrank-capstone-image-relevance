import { Queue, Worker, type Job } from "bullmq";
import { Redis } from "ioredis";
import {
  embedModel,
  geminiImageCostUsd,
  geminiModel,
  jobAttempts,
  jobBackoffMs,
  redisUrl,
} from "./config.js";
import {
  embeddingExists,
  markJobFailed,
  markJobRunning,
  markJobSucceeded,
  recordUsage,
  saveImageAnnotation,
  saveImageLabels,
  upsertEmbedding,
} from "./db.js";
import { annotateImage } from "./ai/gemini.js";
import { embedAndLabel } from "./ai/jina.js";
import { labelStatus } from "./labels.js";
import { ImageAnnotationSchema } from "./types.js";

export type JobName = "embed_image" | "annotate_image";

export type ImageJobData = {
  jobRowId: string;
  imageId: string;
  filename: string;
  contentHash: string;
};

const QUEUE_NAME = "image-jobs";

const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });

export const imageQueue = new Queue<ImageJobData>(QUEUE_NAME, { connection });

const jobOpts = {
  attempts: jobAttempts,
  backoff: { type: "exponential" as const, delay: jobBackoffMs },
  removeOnComplete: 50,
  removeOnFail: 50,
};

export async function enqueueImageJob(
  name: JobName,
  data: ImageJobData,
): Promise<void> {
  try {
    await imageQueue.add(name, data, {
      ...jobOpts,
      jobId: `${name}-${data.contentHash}`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/already/i.test(message)) {
      throw error;
    }
  }
}

async function processEmbed(data: ImageJobData): Promise<void> {
  if (await embeddingExists(data.imageId, embedModel)) {
    return;
  }

  const started = Date.now();
  let vector: number[] | undefined;
  let labels;
  try {
    ({ vector, labels } = await embedAndLabel(data.filename));
  } finally {
    await recordUsage({
      jobId: data.jobRowId,
      kind: "local_embed",
      provider: "transformers.js",
      model: embedModel,
      units: 1,
      costUsd: 0,
      runtimeMs: Date.now() - started,
    });
  }

  if (!vector || !labels) {
    throw new Error(`embed produced no result for ${data.filename}`);
  }

  await saveImageLabels(data.imageId, labels, labelStatus(labels));
  await upsertEmbedding(data.imageId, vector, embedModel);
}

async function processAnnotate(data: ImageJobData): Promise<void> {
  const started = Date.now();
  let raw: unknown;
  try {
    raw = await annotateImage(data.filename);
  } finally {
    await recordUsage({
      jobId: data.jobRowId,
      kind: "vision",
      provider: "gemini",
      model: geminiModel,
      units: 1,
      costUsd: geminiImageCostUsd,
      runtimeMs: Date.now() - started,
    });
  }

  const parsed = ImageAnnotationSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`invalid annotation JSON: ${parsed.error.message}`);
  }

  await saveImageAnnotation(data.imageId, parsed.data);
}

async function processJob(job: Job<ImageJobData, void, JobName>): Promise<void> {
  await markJobRunning(job.data.jobRowId);

  if (job.name === "embed_image") {
    await processEmbed(job.data);
  } else if (job.name === "annotate_image") {
    await processAnnotate(job.data);
  } else {
    throw new Error(`unknown job ${job.name}`);
  }

  await markJobSucceeded(job.data.jobRowId);
}

export async function startWorker(): Promise<Worker<ImageJobData, void, JobName>> {
  const worker = new Worker<ImageJobData, void, JobName>(
    QUEUE_NAME,
    processJob,
    { connection, concurrency: 1 },
  );

  worker.on("failed", async (job, error) => {
    if (!job) {
      return;
    }
    const attempts = job.opts.attempts ?? jobAttempts;
    if (job.attemptsMade >= attempts) {
      await markJobFailed(job.data.jobRowId, error.message);
    }
  });

  worker.on("error", (error) => {
    console.error("worker error", error);
  });

  console.log("worker listening for embed_image and annotate_image jobs");
  return worker;
}

export async function closeQueue(): Promise<void> {
  await imageQueue.close();
  await connection.quit();
}
