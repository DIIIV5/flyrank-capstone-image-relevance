import pg from "pg";
import { databaseUrl } from "./config.js";
import type { SuggestionWrite } from "./rank-result.js";
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

export type EmbeddingOwner = "image" | "post";

export async function insertOrGetJob(
  type: "embed_image" | "annotate_image" | "embed_post",
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
  ownerType: EmbeddingOwner,
  ownerId: string,
  vector: number[],
  model: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO embeddings (owner_type, owner_id, vector, model)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (owner_type, owner_id, model)
     DO UPDATE SET vector = EXCLUDED.vector`,
    [ownerType, ownerId, vector, model],
  );
}

export async function embeddingExists(
  ownerType: EmbeddingOwner,
  ownerId: string,
  model: string,
): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM embeddings
     WHERE owner_type = $1 AND owner_id = $2 AND model = $3`,
    [ownerType, ownerId, model],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function resetImageEmbeddings(): Promise<{ embeddings: number; jobs: number }> {
  const deleted = await pool.query(`DELETE FROM embeddings WHERE owner_type = 'image'`);
  const updated = await pool.query(
    `UPDATE jobs
     SET status = 'queued', error = NULL, attempts = 0, updated_at = now()
     WHERE type = 'embed_image'`,
  );
  return {
    embeddings: deleted.rowCount ?? 0,
    jobs: updated.rowCount ?? 0,
  };
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

export type PostRow = {
  id: string;
  title: string;
  body: string;
  expected_label: string | null;
};

export type ImageCandidate = {
  id: string;
  filename: string;
  label: string | null;
  labelScore: number | null;
  runnerUpScore: number | null;
  status: string;
  subject: string | null;
  caption: string | null;
  vector: number[];
};

export type { SuggestionWrite } from "./rank-result.js";

function asNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry) => Number(entry));
}

function mapCandidate(row: {
  id: string;
  filename: string;
  label: string | null;
  label_score: number | null;
  runner_up_score: number | null;
  status: string;
  subject: string | null;
  caption: string | null;
  vector: unknown;
}): ImageCandidate {
  return {
    id: row.id,
    filename: row.filename,
    label: row.label,
    labelScore: row.label_score,
    runnerUpScore: row.runner_up_score,
    status: row.status,
    subject: row.subject,
    caption: row.caption,
    vector: asNumberArray(row.vector),
  };
}

export async function upsertPost(
  title: string,
  body: string,
  expectedLabel: string | null,
): Promise<string> {
  const existing = await pool.query<{ id: string }>(
    `SELECT id FROM posts WHERE title = $1`,
    [title],
  );
  const id = existing.rows[0]?.id;
  if (id) {
    await pool.query(
      `UPDATE posts
       SET body = $2, expected_label = $3, updated_at = now()
       WHERE id = $1`,
      [id, body, expectedLabel],
    );
    return id;
  }

  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO posts (title, body, expected_label)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [title, body, expectedLabel],
  );
  const created = inserted.rows[0]?.id;
  if (!created) {
    throw new Error(`failed to insert post ${title}`);
  }
  return created;
}

export async function getPost(id: string): Promise<PostRow | null> {
  const result = await pool.query<PostRow>(
    `SELECT id, title, body, expected_label FROM posts WHERE id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

export async function getPostByTitleOrId(query: string): Promise<PostRow | null> {
  const byId = await pool.query<PostRow>(
    `SELECT id, title, body, expected_label FROM posts WHERE id::text = $1`,
    [query],
  );
  if (byId.rows[0]) {
    return byId.rows[0];
  }

  const byTitle = await pool.query<PostRow>(
    `SELECT id, title, body, expected_label FROM posts WHERE lower(title) = lower($1)`,
    [query],
  );
  if (byTitle.rows[0]) {
    return byTitle.rows[0];
  }

  const needle = query.replace(/-/g, " ").toLowerCase();
  const bySlug = await pool.query<PostRow>(
    `SELECT id, title, body, expected_label
     FROM posts
     WHERE lower(title) LIKE $1
     ORDER BY title
     LIMIT 1`,
    [`%${needle}%`],
  );
  return bySlug.rows[0] ?? null;
}

export async function getEmbedding(
  ownerType: EmbeddingOwner,
  ownerId: string,
  model: string,
): Promise<number[] | null> {
  const result = await pool.query<{ vector: unknown }>(
    `SELECT vector FROM embeddings
     WHERE owner_type = $1 AND owner_id = $2 AND model = $3`,
    [ownerType, ownerId, model],
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return asNumberArray(row.vector);
}

export async function sampleEmbeddingLength(model: string): Promise<number | null> {
  const result = await pool.query<{ vector: unknown }>(
    `SELECT vector FROM embeddings WHERE model = $1 LIMIT 1`,
    [model],
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return asNumberArray(row.vector).length;
}

export async function listImageCandidates(model: string): Promise<ImageCandidate[]> {
  const result = await pool.query<{
    id: string;
    filename: string;
    label: string | null;
    label_score: number | null;
    runner_up_score: number | null;
    status: string;
    subject: string | null;
    caption: string | null;
    vector: unknown;
  }>(
    `SELECT i.id, i.filename, i.label, i.label_score, i.runner_up_score,
            i.status, i.subject, i.caption, e.vector
     FROM images i
     JOIN embeddings e
       ON e.owner_type = 'image' AND e.owner_id = i.id AND e.model = $1
     ORDER BY i.filename`,
    [model],
  );
  return result.rows.map(mapCandidate);
}

export async function getImageByFilename(
  filename: string,
  model: string,
): Promise<ImageCandidate | null> {
  const result = await pool.query<{
    id: string;
    filename: string;
    label: string | null;
    label_score: number | null;
    runner_up_score: number | null;
    status: string;
    subject: string | null;
    caption: string | null;
    vector: unknown;
  }>(
    `SELECT i.id, i.filename, i.label, i.label_score, i.runner_up_score,
            i.status, i.subject, i.caption, e.vector
     FROM images i
     JOIN embeddings e
       ON e.owner_type = 'image' AND e.owner_id = i.id AND e.model = $1
     WHERE i.filename = $2`,
    [model, filename],
  );
  const row = result.rows[0];
  return row ? mapCandidate(row) : null;
}

export async function replaceSuggestions(
  postId: string,
  rows: SuggestionWrite[],
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM suggestions WHERE post_id = $1`, [postId]);
    for (const row of rows) {
      await client.query(
        `INSERT INTO suggestions
           (post_id, image_id, rank, similarity, decision, reason, review)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          postId,
          row.imageId,
          row.rank,
          row.similarity,
          row.decision,
          row.reason,
          row.decision === "suggested" ? "pending" : null,
        ],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export type SuggestionRow = {
  id: string;
  postId: string;
  imageId: string | null;
  filename: string | null;
  caption: string | null;
  label: string | null;
  labelScore: number | null;
  runnerUpScore: number | null;
  rank: number | null;
  similarity: number | null;
  decision: string;
  reason: string;
  review: string | null;
  reviewedAt: Date | null;
};

function mapSuggestion(row: {
  id: string;
  post_id: string;
  image_id: string | null;
  filename: string | null;
  caption: string | null;
  label: string | null;
  label_score: number | null;
  runner_up_score: number | null;
  rank: number | null;
  similarity: number | null;
  decision: string;
  reason: string;
  review: string | null;
  reviewed_at: Date | null;
}): SuggestionRow {
  return {
    id: row.id,
    postId: row.post_id,
    imageId: row.image_id,
    filename: row.filename,
    caption: row.caption,
    label: row.label,
    labelScore: row.label_score,
    runnerUpScore: row.runner_up_score,
    rank: row.rank,
    similarity: row.similarity,
    decision: row.decision,
    reason: row.reason,
    review: row.review,
    reviewedAt: row.reviewed_at,
  };
}

const suggestionSelect = `
  SELECT s.id, s.post_id, s.image_id, i.filename, i.caption, i.label,
         i.label_score, i.runner_up_score, s.rank, s.similarity,
         s.decision, s.reason, s.review, s.reviewed_at
  FROM suggestions s
  LEFT JOIN images i ON i.id = s.image_id
`;

export async function getSuggestionById(id: string): Promise<SuggestionRow | null> {
  try {
    const result = await pool.query(`${suggestionSelect} WHERE s.id = $1`, [id]);
    const row = result.rows[0];
    return row ? mapSuggestion(row) : null;
  } catch (error) {
    if (isInvalidUuid(error)) {
      return null;
    }
    throw error;
  }
}

export async function setSuggestionReview(
  id: string,
  review: "approved" | "rejected",
): Promise<SuggestionRow | null> {
  try {
    const updated = await pool.query<{ id: string }>(
      `UPDATE suggestions
       SET review = $2, reviewed_at = now()
       WHERE id = $1
       RETURNING id`,
      [id, review],
    );
    const suggestionId = updated.rows[0]?.id;
    if (!suggestionId) {
      return null;
    }
    return getSuggestionById(suggestionId);
  } catch (error) {
    if (isInvalidUuid(error)) {
      return null;
    }
    throw error;
  }
}

function isInvalidUuid(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "22P02"
  );
}
