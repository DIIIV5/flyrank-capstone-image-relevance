import pg from "pg";
import { databaseUrl } from "./config.js";
import type {
  ImageAnnotation,
  ImageCandidate,
  ImageLabel,
  ImageStatus,
  PostRow,
  Review,
  SuggestionRow,
  SuggestionWrite,
} from "./types.js";

export const pool = new pg.Pool({ connectionString: databaseUrl });

export type EmbeddingOwner = "image" | "post";
export type JobType = "embed_image" | "annotate_image" | "embed_post";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function firstRow<T extends pg.QueryResultRow>(result: pg.QueryResult<T>, what: string): T {
  const row = result.rows[0];
  if (!row) {
    throw new Error(`${what} returned no row`);
  }
  return row;
}

// images

export async function upsertImage(filename: string, contentHash: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO images (filename, content_hash)
     VALUES ($1, $2)
     ON CONFLICT (content_hash) DO UPDATE SET filename = EXCLUDED.filename, updated_at = now()
     RETURNING id`,
    [filename, contentHash],
  );
  return firstRow(result, `upsert image ${filename}`).id;
}

export async function saveImageLabels(
  imageId: string,
  labels: ImageLabel,
  status: ImageStatus,
): Promise<void> {
  await pool.query(
    `UPDATE images
     SET label = $2, label_score = $3, runner_up_label = $4, runner_up_score = $5,
         status = $6, updated_at = now()
     WHERE id = $1`,
    [imageId, labels.label, labels.score, labels.runnerUpLabel, labels.runnerUpScore, status],
  );
}

export async function saveImageAnnotation(imageId: string, tags: ImageAnnotation): Promise<void> {
  await pool.query(
    `UPDATE images
     SET subject = $2, category = $3, attributes = $4::jsonb, caption = $5,
         vlm_confidence = $6, updated_at = now()
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

export type ImageRef = { id: string; filename: string; content_hash: string };

export async function listImagesMissingAnnotation(): Promise<ImageRef[]> {
  const result = await pool.query<ImageRef>(
    `SELECT id, filename, content_hash FROM images WHERE subject IS NULL ORDER BY filename`,
  );
  return result.rows;
}

// jobs and usage

export async function insertOrGetJob(
  type: JobType,
  idempotencyKey: string,
): Promise<{ id: string; status: string }> {
  const result = await pool.query<{ id: string; status: string }>(
    `INSERT INTO jobs (type, idempotency_key)
     VALUES ($1, $2)
     ON CONFLICT (idempotency_key) DO UPDATE SET idempotency_key = jobs.idempotency_key
     RETURNING id, status`,
    [type, idempotencyKey],
  );
  return firstRow(result, `upsert job ${idempotencyKey}`);
}

export async function markJobRunning(id: string): Promise<void> {
  await pool.query(
    `UPDATE jobs
     SET status = 'running', attempts = attempts + 1, error = NULL, updated_at = now()
     WHERE id = $1`,
    [id],
  );
}

export async function markJobSucceeded(id: string): Promise<void> {
  await pool.query(
    `UPDATE jobs SET status = 'succeeded', error = NULL, updated_at = now() WHERE id = $1`,
    [id],
  );
}

export async function markJobFailed(id: string, error: string): Promise<void> {
  await pool.query(
    `UPDATE jobs SET status = 'failed', error = $2, updated_at = now() WHERE id = $1`,
    [id, error.slice(0, 1000)],
  );
}

export type UsageRecord = {
  jobId: string;
  kind: "local_embed" | "vision";
  provider: string;
  model: string;
  costUsd: number;
  runtimeMs: number;
};

export async function recordUsage(usage: UsageRecord): Promise<void> {
  await pool.query(
    `INSERT INTO ai_usage (job_id, kind, provider, model, units, cost_usd, runtime_ms)
     VALUES ($1, $2, $3, $4, 1, $5, $6)`,
    [usage.jobId, usage.kind, usage.provider, usage.model, usage.costUsd, usage.runtimeMs],
  );
}

// embeddings

export async function upsertEmbedding(
  ownerType: EmbeddingOwner,
  ownerId: string,
  vector: number[],
  model: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO embeddings (owner_type, owner_id, vector, model)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (owner_type, owner_id, model) DO UPDATE SET vector = EXCLUDED.vector`,
    [ownerType, ownerId, vector, model],
  );
}

export async function getEmbedding(
  ownerType: EmbeddingOwner,
  ownerId: string,
  model: string,
): Promise<number[] | null> {
  const result = await pool.query<{ vector: number[] }>(
    `SELECT vector FROM embeddings WHERE owner_type = $1 AND owner_id = $2 AND model = $3`,
    [ownerType, ownerId, model],
  );
  return result.rows[0]?.vector ?? null;
}

/** Length of any stored vector for this model, used to catch a text/image dimension mismatch. */
export async function sampleEmbeddingLength(model: string): Promise<number | null> {
  const result = await pool.query<{ vector: number[] }>(
    `SELECT vector FROM embeddings WHERE model = $1 LIMIT 1`,
    [model],
  );
  return result.rows[0]?.vector.length ?? null;
}

export async function resetImageEmbeddings(): Promise<{ embeddings: number; jobs: number }> {
  const deleted = await pool.query(`DELETE FROM embeddings WHERE owner_type = 'image'`);
  const requeued = await pool.query(
    `UPDATE jobs SET status = 'queued', error = NULL, attempts = 0, updated_at = now()
     WHERE type = 'embed_image'`,
  );
  return { embeddings: deleted.rowCount ?? 0, jobs: requeued.rowCount ?? 0 };
}

// posts

export async function upsertPost(
  title: string,
  body: string,
  expectedLabel: string | null,
): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO posts (title, body, expected_label)
     VALUES ($1, $2, $3)
     ON CONFLICT (title) DO UPDATE
       SET body = EXCLUDED.body, expected_label = EXCLUDED.expected_label, updated_at = now()
     RETURNING id`,
    [title, body, expectedLabel],
  );
  return firstRow(result, `upsert post ${title}`).id;
}

export async function getPost(id: string): Promise<PostRow | null> {
  const result = await pool.query<PostRow>(
    `SELECT id, title, body, expected_label FROM posts WHERE id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

/** Matches a uuid, an exact title, or hyphenated words that appear in the title. */
export async function getPostByTitleOrId(query: string): Promise<PostRow | null> {
  const words = query.replace(/-/g, " ").toLowerCase();
  const result = await pool.query<PostRow>(
    `SELECT id, title, body, expected_label
     FROM posts
     WHERE id::text = $1 OR lower(title) = lower($1) OR lower(title) LIKE $2
     ORDER BY (id::text = $1) DESC, (lower(title) = lower($1)) DESC, title
     LIMIT 1`,
    [query, `%${words}%`],
  );
  return result.rows[0] ?? null;
}

// ranking candidates

type CandidateRow = {
  id: string;
  filename: string;
  label: string | null;
  label_score: number | null;
  runner_up_score: number | null;
  subject: string | null;
  caption: string | null;
  vector: number[];
};

const candidateSelect = `
  SELECT i.id, i.filename, i.label, i.label_score, i.runner_up_score,
         i.subject, i.caption, e.vector
  FROM images i
  JOIN embeddings e ON e.owner_type = 'image' AND e.owner_id = i.id AND e.model = $1
`;

function toCandidate(row: CandidateRow): ImageCandidate {
  return {
    id: row.id,
    filename: row.filename,
    label: row.label,
    labelScore: row.label_score,
    runnerUpScore: row.runner_up_score,
    subject: row.subject,
    caption: row.caption,
    vector: row.vector,
  };
}

export async function listImageCandidates(model: string): Promise<ImageCandidate[]> {
  const result = await pool.query<CandidateRow>(`${candidateSelect} ORDER BY i.filename`, [model]);
  return result.rows.map(toCandidate);
}

export async function getImageByFilename(
  filename: string,
  model: string,
): Promise<ImageCandidate | null> {
  const result = await pool.query<CandidateRow>(`${candidateSelect} WHERE i.filename = $2`, [
    model,
    filename,
  ]);
  const row = result.rows[0];
  return row ? toCandidate(row) : null;
}

// suggestions

export async function replaceSuggestions(postId: string, rows: SuggestionWrite[]): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM suggestions WHERE post_id = $1`, [postId]);
    for (const row of rows) {
      await client.query(
        `INSERT INTO suggestions (post_id, image_id, rank, similarity, decision, reason, review)
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

type SuggestionDbRow = {
  id: string;
  filename: string | null;
  caption: string | null;
  label: string | null;
  label_score: number | null;
  runner_up_score: number | null;
  similarity: number | null;
  decision: string;
  reason: string;
  review: string | null;
  reviewed_at: Date | null;
};

const suggestionSelect = `
  SELECT s.id, i.filename, i.caption, i.label, i.label_score, i.runner_up_score,
         s.similarity, s.decision, s.reason, s.review, s.reviewed_at
  FROM suggestions s
  LEFT JOIN images i ON i.id = s.image_id
`;

function toSuggestion(row: SuggestionDbRow): SuggestionRow {
  return {
    id: row.id,
    filename: row.filename,
    caption: row.caption,
    label: row.label,
    labelScore: row.label_score,
    runnerUpScore: row.runner_up_score,
    similarity: row.similarity,
    decision: row.decision,
    reason: row.reason,
    review: row.review,
    reviewedAt: row.reviewed_at,
  };
}

export async function getSuggestionById(id: string): Promise<SuggestionRow | null> {
  if (!UUID.test(id)) {
    return null;
  }
  const result = await pool.query<SuggestionDbRow>(`${suggestionSelect} WHERE s.id = $1`, [id]);
  const row = result.rows[0];
  return row ? toSuggestion(row) : null;
}

/** Callers check the row exists first; a vanished row is an error, not a 404. */
export async function setSuggestionReview(id: string, review: Review): Promise<SuggestionRow> {
  await pool.query(`UPDATE suggestions SET review = $2, reviewed_at = now() WHERE id = $1`, [
    id,
    review,
  ]);
  const row = await getSuggestionById(id);
  if (!row) {
    throw new Error(`suggestion ${id} disappeared during review`);
  }
  return row;
}
