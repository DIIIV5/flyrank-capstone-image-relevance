# Design: image–content matching

This project recommends a photo for an article when the match is good enough, and refuses it when it is not. A red fox post should get a red-fox photo; a wolf or a dog is rejected on the Jina `label`. A grey fox carries the label `fox` too, so it isn't rejected outright; it's simply left to rank below the red fox on cosine similarity. If nothing fits well enough, the result is no confident match.

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

The system has four layers — HTTP, background jobs, AI adapters, and Postgres. Models run in jobs, not in HTTP handlers.

Jina CLIP v2 encodes each image and each post into a vector, using the same text tower for the post title and body as it uses to score the label prompts. Gemini writes `subject`, `category`, `attributes`, and `caption`; the caption is stored on the image row and returned as alt text. Ranking uses the stored Jina vectors.

## Labels

The closed set of names, the folder paths, and the score numbers all live in [config.yaml](../config.yaml). Ingest classifies each photo into one of the names in `labels`.

```json
{
  "label": "fox",
  "score": 0.39,
  "runnerUpLabel": "other",
  "runnerUpScore": 0.33
}
```

`score_scale` selects how a Jina image–text dot product becomes the stored `score`, either `raw` or `softmax`. Margin is `score - runnerUpScore`; when `score >= label_score_min` and margin `>= label_margin_min`, status is `processed`. Those threshold values come from `npm run eval-labels`, not from hardcoded TypeScript constants.

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

If the JSON doesn't match this schema, the job retries; once retries are exhausted, the job fails and the response is discarded. `caption` is the alt text for the image, and `category` is a broad class such as `animal` — the species itself is the Jina `label` (`fox`, `wolf`, `dog`, and so on).

## Guard

Images are ranked by cosine similarity of the stored vectors, then checked in order — the first check that fails becomes the rejection reason.

1. Cosine similarity below `cosine_min` in [config.yaml](../config.yaml) → similarity below threshold.
2. Image status is `flagged`, or Jina score or margin is below `label_score_min` / `label_margin_min` in [config.yaml](../config.yaml) → uncertain subject. `check_flagged` turns this check on or off.
3. Gap between the top two similarities → not implemented; no gap size was set.
4. `posts.expected_label` is set and differs from the image `label` → subject mismatch. Grey fox and red fox are both `fox`.
5. Gemini `subject` is present and names a different word from `labels` in [config.yaml](../config.yaml) than the Jina `label` → metadata disagreement. A null or blank `subject` is skipped, but `--require-tags` turns a missing `subject` into `missing metadata`.

## API

Handlers read stored vectors and rows and never import `src/ai/`. The server binds to `localhost` only, and there is no auth.

- `GET /posts/:id/images` — live rank from stored vectors, run the guard, return JSON (`filename`, `label`, `similarity`, `decision`, `reason`, `caption` as alt text). Query `image` runs the guard on that pair only. Does not write `suggestions`. 404 if the post or forced filename is missing. 409 if the post has no embedding.
- `POST /posts/:id/images` — same rank, then `replaceSuggestions` (creates ids for review). `replaceSuggestions` deletes existing rows for that post, including `approved` / `rejected`. Query `image` persists that pair only.
- `GET /suggestions/:id` — one stored row plus caption, scores, `decision`, `reason`, `review`. 404 if missing. Rows exist after POST or `npm run match`.
- `POST /suggestions/:id/review` — body `{ "review": "approved" | "rejected" }`. Zod `safeParse` returns 400. 404 if missing. 400 if `decision` is not `suggested`. Sets `review` and `reviewed_at`.

## Database

`db/migrations/001_init.sql` defines six tables: `images`, `posts`, `embeddings`, `suggestions`, `jobs`, and `ai_usage`. `posts.expected_label`, added in `003_posts_expected_label.sql`, is the post side of guard check 4.

Images live in `paths.corpus` in [config.yaml](../config.yaml), and ingest reads only its top-level files. Held-out photos live in `paths.label_eval`, and seed articles live in `paths.posts`. The closed set of names is `labels` in that same file, not a SQL `IN` list.

## Stack

TypeScript, Express, PostgreSQL, Redis, BullMQ, Transformers.js Jina CLIP v2, Gemini Flash for tags and alt text.
