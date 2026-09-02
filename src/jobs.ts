import { Queue, Worker, type Job } from "bullmq";
import { Redis } from "ioredis";
import { annotateImage } from "./ai/gemini.js";
import { embedAndLabel, embedText } from "./ai/jina.js";
import {
  embedModel,
  geminiImageCostUsd,
  geminiModel,
  jobAttempts,
  jobBackoffMs,
  redisUrl,
} from "./config.js";
import {
  getEmbedding,
  getPost,
  insertOrGetJob,
  markJobFailed,
  markJobRunning,
  markJobSucceeded,
  recordUsage,
  sampleEmbeddingLength,
  saveImageAnnotation,
  saveImageLabels,
  upsertEmbedding,
  type UsageRecord,
} from "./db.js";
import { labelStatus } from "./labels.js";

type ImageJob = { jobRowId: string; imageId: string; filename: string; contentHash: string };

export type JobData =
  | ({ type: "embed_image" } & ImageJob)
  | ({ type: "annotate_image" } & ImageJob)
  | { type: "embed_post"; jobRowId: string; postId: string };

/** A job before it has a row in the jobs table. */
export type JobSpec = JobData extends infer T
  ? T extends { jobRowId: string }
    ? Omit<T, "jobRowId">
    : never
  : never;

const QUEUE_NAME = "image-jobs";

const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });

export const queue = new Queue<JobData>(QUEUE_NAME, { connection });

/** One key per piece of work: the content hash for images, the post id for posts. */
function idempotencyKey(spec: JobSpec): string {
  const key = spec.type === "embed_post" ? spec.postId : spec.contentHash;
  return `${spec.type}:${key}`;
}

/**
 * Creates or finds the jobs row and enqueues it unless it already succeeded
 * or an identical job is still waiting. Returns true when a job was queued.
 */
export async function queueOnce(spec: JobSpec): Promise<boolean> {
  const row = await insertOrGetJob(spec.type, idempotencyKey(spec));
  if (row.status === "succeeded") {
    return false;
  }

  // BullMQ custom ids cannot contain ":".
  const jobId = idempotencyKey(spec).replace(":", "-");
  const existing = await queue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (state !== "completed" && state !== "failed") {
      return false;
    }
    await existing.remove();
  }

  const data: JobData = { ...spec, jobRowId: row.id };
  await queue.add(data.type, data, {
    jobId,
    attempts: jobAttempts,
    backoff: { type: "exponential", delay: jobBackoffMs },
    removeOnComplete: 50,
    removeOnFail: 50,
  });
  return true;
}

const jinaUsage = {
  kind: "local_embed",
  provider: "transformers.js",
  model: embedModel,
  costUsd: 0,
} as const;
const geminiUsage = {
  kind: "vision",
  provider: "gemini",
  model: geminiModel,
  costUsd: geminiImageCostUsd,
} as const;

/** Records an ai_usage row whether or not the call succeeds. */
async function withUsage<T>(
  jobRowId: string,
  usage: Omit<UsageRecord, "jobId" | "runtimeMs">,
  run: () => Promise<T>,
): Promise<T> {
  const started = Date.now();
  try {
    return await run();
  } finally {
    await recordUsage({ ...usage, jobId: jobRowId, runtimeMs: Date.now() - started });
  }
}

async function processEmbedImage(data: ImageJob): Promise<void> {
  if (await getEmbedding("image", data.imageId, embedModel)) {
    return;
  }
  const { vector, labels } = await withUsage(data.jobRowId, jinaUsage, () =>
    embedAndLabel(data.filename),
  );
  await saveImageLabels(data.imageId, labels, labelStatus(labels));
  await upsertEmbedding("image", data.imageId, vector, embedModel);
}

async function processAnnotateImage(data: ImageJob): Promise<void> {
  const annotation = await withUsage(data.jobRowId, geminiUsage, () =>
    annotateImage(data.filename),
  );
  await saveImageAnnotation(data.imageId, annotation);
}

async function processEmbedPost(jobRowId: string, postId: string): Promise<void> {
  if (await getEmbedding("post", postId, embedModel)) {
    return;
  }
  const post = await getPost(postId);
  if (!post) {
    throw new Error(`post ${postId} is missing`);
  }
  const vector = await withUsage(jobRowId, jinaUsage, () =>
    embedText(`${post.title}\n\n${post.body}`),
  );
  const imageLength = await sampleEmbeddingLength(embedModel);
  if (imageLength !== null && vector.length !== imageLength) {
    throw new Error(`post vector length ${vector.length} does not match ${imageLength}`);
  }
  await upsertEmbedding("post", postId, vector, embedModel);
}

async function processJob(job: Job<JobData>): Promise<void> {
  const data = job.data;
  await markJobRunning(data.jobRowId);
  switch (data.type) {
    case "embed_image":
      await processEmbedImage(data);
      break;
    case "annotate_image":
      await processAnnotateImage(data);
      break;
    case "embed_post":
      await processEmbedPost(data.jobRowId, data.postId);
      break;
  }
  await markJobSucceeded(data.jobRowId);
}

export function startWorker(): Worker<JobData> {
  const worker = new Worker<JobData>(QUEUE_NAME, processJob, { connection, concurrency: 1 });

  worker.on("failed", async (job, error) => {
    if (job && job.attemptsMade >= (job.opts.attempts ?? jobAttempts)) {
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
  await queue.close();
  await connection.quit();
}

/** Drops queued or finished embed_image jobs from Redis so ingest can add them again. */
export async function removeEmbedImageJobs(): Promise<number> {
  const jobs = await queue.getJobs(["completed", "failed", "waiting", "delayed"]);
  const embedJobs = jobs.filter((job) => job.name === "embed_image");
  await Promise.all(embedJobs.map((job) => job.remove()));
  return embedJobs.length;
}
