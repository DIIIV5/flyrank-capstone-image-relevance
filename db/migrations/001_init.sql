-- Phase 1 schema. Six tables; no pgvector.

CREATE TABLE images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filename text NOT NULL,
  content_hash text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processed', 'flagged', 'failed')),
  label text CHECK (label IN ('fox', 'wolf', 'dog', 'bear', 'deer', 'other')),
  label_score real CHECK (label_score >= 0 AND label_score <= 1),
  runner_up_label text
    CHECK (runner_up_label IN ('fox', 'wolf', 'dog', 'bear', 'deer', 'other')),
  runner_up_score real CHECK (runner_up_score >= 0 AND runner_up_score <= 1),
  subject text,
  category text,
  attributes jsonb,
  caption text,
  vlm_confidence real CHECK (vlm_confidence >= 0 AND vlm_confidence <= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX images_status_idx ON images (status);

CREATE TABLE posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE embeddings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_type text NOT NULL CHECK (owner_type IN ('image', 'post')),
  owner_id uuid NOT NULL,
  vector real[] NOT NULL,
  model text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_type, owner_id, model)
);

CREATE TABLE suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
  image_id uuid REFERENCES images (id) ON DELETE SET NULL,
  rank integer,
  similarity real,
  decision text NOT NULL
    CHECK (decision IN ('suggested', 'rejected', 'no_confident_match')),
  reason text NOT NULL,
  review text CHECK (review IN ('pending', 'approved', 'rejected')),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX suggestions_post_id_idx ON suggestions (post_id);

CREATE TABLE jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL
    CHECK (type IN ('embed_image', 'embed_post', 'annotate_image')),
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  idempotency_key text NOT NULL UNIQUE,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ai_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid REFERENCES jobs (id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('local_embed', 'vision', 'llm')),
  provider text NOT NULL,
  model text NOT NULL,
  units integer,
  cost_usd numeric(12, 6) NOT NULL DEFAULT 0,
  runtime_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ai_usage_created_at_idx ON ai_usage (created_at);
