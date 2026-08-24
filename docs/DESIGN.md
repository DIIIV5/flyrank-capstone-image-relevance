# Design: image–content matching

A project to recommend a photo for an article when the match is good enough and refuse it when it is not. A red-fox post should get a red-fox photo. A wolf or a dog is rejected on the Jina `label`. A grey fox carries the label `fox`, so it is not rejected; it is left to rank below the red fox on cosine. If nothing fits, the result is no confident match.

## How it works

```text
image file  → Jina CLIP v2 → labels + image vector → Postgres
post text   → Jina CLIP v2 → post vector           → Postgres
                                                 ↓
                                    rank → mismatch guard
                                         /            \
                                    suggest          reject + reason

image file  → Gemini → tags + alt text (caption) → Postgres
```

The system has four layers: HTTP, background jobs, AI adapters, and Postgres. Models run in jobs. HTTP handlers do not call models.

Jina CLIP v2 encodes each image and each post into a vector. The post title and body go through the same Jina text tower that scores the label prompts. Gemini writes `subject`, `category`, `attributes`, and `caption`. The caption is stored on the image row and returned as alt text. Ranking uses the stored Jina vectors.

## Labels

Each image is classified into one of: `fox`, `wolf`, `dog`, `cat`, `tiger`, `bear`, `deer`, `other`.

```json
{
  "label": "fox",
  "score": 0.81,
  "runnerUpLabel": "wolf",
  "runnerUpScore": 0.11
}
```

Margin is `score - runnerUpScore`. If `score >= 0.70` and margin `>= 0.15`, status is `processed`. Otherwise the labels are still stored and status is `flagged`.

## Tags and alt text

Gemini returns:

```json
{
  "subject": "red fox",
  "category": "animal",
  "attributes": ["orange fur", "wild", "forest"],
  "caption": "A red fox standing in a forest",
  "confidence": 0.94
}
```

If the JSON does not match this schema, the job retries. After retries are exhausted, the job fails and the response is discarded. `caption` is the alt text for the image. `category` is a broad class such as `animal`. The species is the Jina `label` (`fox`, `wolf`, `dog`, and so on).

## Guard (Phase 3)

Images are ranked by cosine similarity of the stored vectors. Checks run in order. The first failed check becomes the rejection reason.

1. Cosine similarity below `0.25` → similarity below threshold. `0.25` is a starting number for image-to-text CLIP cosine, not a measured one.
2. Image status is `flagged`, or Jina score or margin is below the flag rule in [src/labels.ts](../src/labels.ts) (`0.70` / `0.15`) → uncertain subject. The check is written and left off, because ingest marked every photo `flagged`.
3. Gap between the top two similarities → not implemented. No gap size was set.
4. `posts.expected_label` is set and differs from the image `label` → subject mismatch. Grey fox and red fox are both `fox`.
5. Gemini `subject` is present and names a different `IMAGE_LABELS` word than the Jina `label` → metadata disagreement. A null or blank `subject` is skipped. `--require-tags` turns a missing `subject` into `missing metadata`.

## API (later)

- `GET /posts/:id/images` — rank, run the guard, return alt text
- `POST /suggestions/:id/review` — approve or reject
- `GET /suggestions/:id` — inspect scores and reason

## Database

Six tables in `db/migrations/001_init.sql`: `images`, `posts`, `embeddings`, `suggestions`, `jobs`, `ai_usage`. `posts.expected_label` is added in `003_posts_expected_label.sql` and is the post side of guard check 4.

Images live in `data/images/`. Seed articles live in `data/posts/`.

## Stack

TypeScript, Express (later), PostgreSQL, Redis, BullMQ, Transformers.js Jina CLIP v2, Gemini Flash for tags and alt text.
