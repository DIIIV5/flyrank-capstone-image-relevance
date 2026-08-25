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
  getPost,
  markJobFailed,
  markJobRunning,
  markJobSucceeded,
  recordUsage,
  sampleEmbeddingLength,
  saveImageAnnotation,
  saveImageLabels,
  upsertEmbedding,
} from "./db.js";
import { annotateImage } from "./ai/gemini.js";
import { embedAndLabel, embedText } from "./ai/jina.js";
import { labelStatus } from "./labels.js";
import { ImageAnnotationSchema } from "./types.js";

export type ImageJobName = "embed_image" | "annotate_image";
export type JobName = ImageJobName | "embed_post";

export type ImageJobData = {
  jobRowId: string;
  imageId: string;
  filename: string;
  contentHash: string;
};

export type PostJobData = {
  jobRowId: string;
  postId: string;
};

export type JobData = ImageJobData | PostJobData;

const QUEUE_NAME = "image-jobs";

const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });

export const imageQueue = new Queue<JobData>(QUEUE_NAME, { connection });

const jobOpts = {
  attempts: jobAttempts,
  backoff: { type: "exponential" as const, delay: jobBackoffMs },
  removeOnComplete: 50,
  removeOnFail: 50,
};

export async function enqueueImageJob(
  name: ImageJobName,
  data: ImageJobData,
): Promise<void> {
  const jobId = `${name}-${data.contentHash}`;
  const existing = await imageQueue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (state === "completed" || state === "failed") {
      await existing.remove();
    }
  }
  try {
    await imageQueue.add(name, data, {
      ...jobOpts,
      jobId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/already/i.test(message)) {
      throw error;
    }
  }
}

export async function enqueuePostJob(data: PostJobData): Promise<void> {
  const jobId = `embed_post-${data.postId}`;
  const existing = await imageQueue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (state === "completed" || state === "failed") {
      await existing.remove();
    }
  }
  try {
    await imageQueue.add("embed_post", data, {
      ...jobOpts,
      jobId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/already/i.test(message)) {
      throw error;
    }
  }
}

function isImageJob(data: JobData): data is ImageJobData {
  return "imageId" in data;
}

async function processEmbed(data: ImageJobData): Promise<void> {
  if (await embeddingExists("image", data.imageId, embedModel)) {
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
  await upsertEmbedding("image", data.imageId, vector, embedModel);
}

async function processEmbedPost(data: PostJobData): Promise<void> {
  if (await embeddingExists("post", data.postId, embedModel)) {
    return;
  }

  const post = await getPost(data.postId);
  if (!post) {
    throw new Error(`post ${data.postId} is missing`);
  }

  const started = Date.now();
  let vector: number[] | undefined;
  try {
    vector = await embedText(`${post.title}\n\n${post.body}`);
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

  if (!vector) {
    throw new Error(`embed produced no result for post ${data.postId}`);
  }

  const expectedLength = await sampleEmbeddingLength(embedModel);
  if (expectedLength !== null && vector.length !== expectedLength) {
    throw new Error(
      `post vector length ${vector.length} does not match image vector length ${expectedLength}`,
    );
  }

  await upsertEmbedding("post", data.postId, vector, embedModel);
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

async function processJob(job: Job<JobData, void, JobName>): Promise<void> {
  await markJobRunning(job.data.jobRowId);

  if (job.name === "embed_image") {
    if (!isImageJob(job.data)) {
      throw new Error("embed_image job is missing image fields");
    }
    await processEmbed(job.data);
  } else if (job.name === "annotate_image") {
    if (!isImageJob(job.data)) {
      throw new Error("annotate_image job is missing image fields");
    }
    await processAnnotate(job.data);
  } else if (job.name === "embed_post") {
    if (isImageJob(job.data)) {
      throw new Error("embed_post job is missing post fields");
    }
    await processEmbedPost(job.data);
  } else {
    throw new Error(`unknown job ${job.name}`);
  }

  await markJobSucceeded(job.data.jobRowId);
}

export async function startWorker(): Promise<Worker<JobData, void, JobName>> {
  const worker = new Worker<JobData, void, JobName>(
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

  console.log("worker listening for embed_image, annotate_image, and embed_post jobs");
  return worker;
}

export async function closeQueue(): Promise<void> {
  await imageQueue.close();
  await connection.quit();
}

export async function removeEmbedImageJobs(): Promise<number> {
  const jobs = await imageQueue.getJobs([
    "completed",
    "failed",
    "wait",
    "waiting",
    "delayed",
    "paused",
  ]);
  let removed = 0;
  for (const job of jobs) {
    const id = String(job.id ?? "");
    if (job.name === "embed_image" || id.startsWith("embed_image-")) {
      await job.remove();
      removed += 1;
    }
  }
  return removed;
}
