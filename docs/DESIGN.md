# Design: image–content matching

Recommend a photo for an article when the match is good enough. Refuse when it is not. A red-fox post should get a red-fox photo. A wolf or dog should rank lower or be rejected. If nothing fits, the api returns no confident match.

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

The layers are HTTP, jobs, AI adapters, and Postgres. Model work is done in jobs. The api never calls the model.

Jina CLIP v2 makes the image and post vectors. Gemini writes tags and alt text. Alt text is the caption field. It is stored and returned with the image.

## Labels

Zero-shot over `fox | wolf | dog | cat | big cat | bear | deer | other`:

```json
{ "label": "fox", "score": 0.81, "runnerUpLabel": "wolf", "runnerUpScore": 0.11 }
```

Margin is `score - runnerUpScore`. `score >= 0.70` and margin `>= 0.15` → `processed`. Otherwise labels are still stored and status is `flagged`.

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

Invalid JSON is retried, then failed. It is never stored. `caption` is alt text. `category` is coarse. Fox vs wolf is the Jina `label`.

## Guard (Phase 3)

Cosine on stored vectors. First failure wins.

1. Cosine `< 0.75` → similarity below threshold
2. Image flagged or Jina score/margin too low → uncertain subject
3. `top1_sim - top2_sim` too small → no dominant match
4. Post is about one animal and image `label` is a different one → subject mismatch
5. If Gemini tags exist and disagree with the Jina label → metadata disagreement

## API (later)

- `GET /posts/:id/images` — rank, guard, alt text
- `POST /suggestions/:id/review` — approve / reject
- `GET /suggestions/:id` — inspect scores and reason

## Database

Six tables in `db/migrations/001_init.sql`: `images`, `posts`, `embeddings`, `suggestions`, `jobs`, `ai_usage`.

Corpus is `data/images/`.

## Stack

TypeScript, Express (later), PostgreSQL, Redis, BullMQ, Transformers.js Jina CLIP v2, Gemini Flash for alt text and tags.

## Non-goal

A general image search engine. A frontend. A Python service. pgvector.
