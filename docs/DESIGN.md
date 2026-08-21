# Design: image–content matching

A project to recommend a photo for an article when the match is good enough and refuse it when it is not. A red-fox post should get a red-fox photo while a grey fox, wolf or dog should rank lower or be rejected. If nothing fits, the api returns no confident match.

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

Jina CLIP v2 encodes each image and each post into a vector. Gemini returns tags and a caption. The caption is stored on the image row and returned as alt text.

## Labels

Each image is classified into one of: `fox`, `wolf`, `dog`, `cat`, `big cat`, `bear`, `deer`, `other`.

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

1. Cosine similarity below `0.75` → similarity below threshold
2. Image status is `flagged`, or Jina score or margin is too low → uncertain subject
3. Gap between the top two similarities is too small → no dominant match
4. The post is about one species and the image `label` is another → subject mismatch. A red-fox post rejects a grey fox, wolf, or dog here.
5. Gemini tags are present and do not agree with the Jina label → metadata disagreement

## API (later)

- `GET /posts/:id/images` — rank, run the guard, return alt text
- `POST /suggestions/:id/review` — approve or reject
- `GET /suggestions/:id` — inspect scores and reason

## Database

Six tables in `db/migrations/001_init.sql`: `images`, `posts`, `embeddings`, `suggestions`, `jobs`, `ai_usage`.

Images live in `data/images/`.

## Stack

TypeScript, Express (later), PostgreSQL, Redis, BullMQ, Transformers.js Jina CLIP v2, Gemini Flash for tags and alt text.
