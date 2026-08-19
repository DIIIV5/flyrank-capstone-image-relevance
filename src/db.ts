import pg from "pg";
import { databaseUrl } from "./config.js";
import type { ImageAnnotation, ImageLabel } from "./types.js";

export const pool = new pg.Pool({ connectionString: databaseUrl });

export async function upsertImage(
  filename: string,
  contentHash: string,
): Promise<string> {
  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO images (filename, content_hash)
     VALUES ($1, $2)
     ON CONFLICT (content_hash) DO NOTHING
     RETURNING id`,
    [filename, contentHash],
  );
  if (inserted.rows[0]) {
    return inserted.rows[0].id;
  }
  const existing = await pool.query<{ id: string }>(
    `SELECT id FROM images WHERE content_hash = $1`,
    [contentHash],
  );
  const id = existing.rows[0]?.id;
  if (!id) {
    throw new Error(`image row missing for hash ${contentHash}`);
  }
  return id;
}

export async function insertOrGetJob(
  type: "embed_image" | "annotate_image",
  idempotencyKey: string,
): Promise<{ id: string; status: string }> {
  const upserted = await pool.query<{ id: string; status: string }>(
    `INSERT INTO jobs (type, idempotency_key)
     VALUES ($1, $2)
     ON CONFLICT (idempotency_key)
     DO UPDATE SET idempotency_key = jobs.idempotency_key
     RETURNING id, status`,
    [type, idempotencyKey],
  );
  const row = upserted.rows[0];
  if (!row) {
    throw new Error(`failed to upsert job ${idempotencyKey}`);
  }
  return row;
}

export async function markJobRunning(id: string): Promise<void> {
  await pool.query(
    `UPDATE jobs
     SET status = 'running',
         attempts = attempts + 1,
         error = NULL,
         updated_at = now()
     WHERE id = $1`,
    [id],
  );
}

export async function markJobSucceeded(id: string): Promise<void> {
  await pool.query(
    `UPDATE jobs
     SET status = 'succeeded', error = NULL, updated_at = now()
     WHERE id = $1`,
    [id],
  );
}

export async function markJobFailed(id: string, error: string): Promise<void> {
  await pool.query(
    `UPDATE jobs
     SET status = 'failed', error = $2, updated_at = now()
     WHERE id = $1`,
    [id, error.slice(0, 1000)],
  );
}

export async function saveImageLabels(
  imageId: string,
  labels: ImageLabel,
  status: "processed" | "flagged",
): Promise<void> {
  await pool.query(
    `UPDATE images
     SET label = $2,
         label_score = $3,
         runner_up_label = $4,
         runner_up_score = $5,
         status = $6,
         updated_at = now()
     WHERE id = $1`,
    [
      imageId,
      labels.label,
      labels.score,
      labels.runnerUpLabel,
      labels.runnerUpScore,
      status,
    ],
  );
}

export async function saveImageAnnotation(
  imageId: string,
  tags: ImageAnnotation,
): Promise<void> {
  await pool.query(
    `UPDATE images
     SET subject = $2,
         category = $3,
         attributes = $4::jsonb,
         caption = $5,
         vlm_confidence = $6,
         updated_at = now()
     WHERE id = $1`,
    [
      imageId,
      tags.subject,
      tags.category,
      JSON.stringify(tags.attributes),
      tags.caption,
      tags.confidence,
    ],
  );
}

export async function upsertEmbedding(
  imageId: string,
  vector: number[],
  model: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO embeddings (owner_type, owner_id, vector, model)
     VALUES ('image', $1, $2, $3)
     ON CONFLICT (owner_type, owner_id, model)
     DO UPDATE SET vector = EXCLUDED.vector`,
    [imageId, vector, model],
  );
}

export async function embeddingExists(
  imageId: string,
  model: string,
): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM embeddings
     WHERE owner_type = 'image' AND owner_id = $1 AND model = $2`,
    [imageId, model],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function listImagesMissingAnnotation(): Promise<
  { id: string; filename: string; content_hash: string }[]
> {
  const result = await pool.query<{
    id: string;
    filename: string;
    content_hash: string;
  }>(
    `SELECT id, filename, content_hash
     FROM images
     WHERE subject IS NULL
     ORDER BY filename`,
  );
  return result.rows;
}

export async function recordUsage(input: {
  jobId: string;
  kind: "local_embed" | "vision" | "llm";
  provider: string;
  model: string;
  units: number;
  costUsd: number;
  runtimeMs: number;
}): Promise<void> {
  await pool.query(
    `INSERT INTO ai_usage (job_id, kind, provider, model, units, cost_usd, runtime_ms)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      input.jobId,
      input.kind,
      input.provider,
      input.model,
      input.units,
      input.costUsd,
      input.runtimeMs,
    ],
  );
}
