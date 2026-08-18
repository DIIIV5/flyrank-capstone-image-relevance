# Design: image–content matching

**Problem:** Recommend an image for an article when the match is good enough, and refuse with a reason when it is not. A red-fox post should surface a red-fox photo; a wolf or generic dog should rank lower or be rejected; an unrelated post should return “no confident match.”

**Non-goal:** A general-purpose image search engine, a frontend, a Python inference service, pgvector, or a conversational search assistant. Stretch later: an LLM that emits structured search intent and calls this matcher.

## Differences from the reference architecture

```text
Reference:  image → VLM → caption → text embed → rank
This repo:  image → SigLIP embed ─┐
            post  → SigLIP embed ─┴→ rank → mismatch guard
```

Generative vision is an **ingestion/enrichment job** (`npm run annotate`), not a step on retrieve. Ranking uses a shared SigLIP space. The mismatch guard uses measurable scores (cosine, classification score/margin, rank gap, hard subject conflict), not an LLM `"confidence": 0.94`.

This still covers the brief: schema-valid tags (annotate job), semantic matching (SigLIP), fox-over-wolf ranking, forced-wolf rejection, no-match, background jobs, review, eval, and cost rows (local embeds at $0; VLM calls with a real cost).

## Stack (later phases)

TypeScript, Express, PostgreSQL, Redis, BullMQ, Transformers.js/ONNX SigLIP in a Node worker.

## Layers

```text
http  →  matching / review  →  repositories  →  Postgres
jobs  →  SigLIP adapter | VLM annotate adapter
```

HTTP never calls the model. Slow embed/annotate work is BullMQ.

## Metadata schemas

Two contracts; do not merge them. See `src/types.ts`.

**SigLIP labels** (matching + guard). Zero-shot over `fox | wolf | dog | bear | deer | other`:

```json
{ "label": "fox", "score": 0.81, "runnerUpLabel": "wolf", "runnerUpScore": 0.11 }
```

Margin = `score - runnerUpScore` (derived). Flagging: `score >= 0.70` and margin `>= 0.15` → `processed`; otherwise store labels and mark `flagged`.

**VLM tags** (enrichment only; brief JSON):

```json
{
  "subject": "red fox",
  "category": "animal",
  "attributes": ["orange fur", "wild", "forest"],
  "caption": "A red fox standing in a forest",
  "confidence": 0.94
}
```

Invalid VLM JSON is retried, then `failed` — never stored. `category` is coarse (`"animal"`). Fox vs wolf is SigLIP `label` / VLM `subject`.

## Matching + guard

```text
image bytes       → SigLIP image encoder → image_vector
post title + body → SigLIP text encoder  → post_vector
cosine rank (~50 vectors in process; no pgvector)
then mismatch guard (first failure wins)
```

1. Cosine `< 0.75` → `"Similarity below threshold"`
2. Image `flagged` or SigLIP score/margin too low → `"Uncertain subject classification"`
3. `top1_sim - top2_sim` too small → `"No dominant match"`
4. Post maps to a known animal and image `label` is a different known animal → `"Subject mismatch: expected fox, detected wolf"`
5. If VLM tags exist: SigLIP `label` and VLM `subject` map to different animals → `"Metadata disagreement"`

Synonyms: `"red fox"` / `"vulpes vulpes"` → `fox`, `"gray wolf"` → `wolf`, `"husky"` → `dog`. If the post names none of the five animals, skip (4) and use similarity + rank margin.

Outcomes: `suggested`, `rejected` (forced mismatch), or `no_confident_match`, each with a reason. Thresholds are config; tune on the eval set in Phase 3/4.

## API surface (later)

- `GET /posts/:id/images` — rank + guard
- `POST /suggestions/:id/review` — approve / reject
- `GET /suggestions/:id` — inspect scores and reason
- `POST /jobs/embed` / `POST /jobs/annotate` — enqueue; do not block

## Database

Six tables (`db/migrations/001_init.sql`): `images` (SigLIP columns + nullable VLM tags), `posts`, `embeddings` (`real[]`, unique owner+model), `suggestions` (decision + review columns), `jobs` (unique `idempotency_key`), `ai_usage` (`cost_usd` 0 for local SigLIP).

Corpus: flat files in `data/images/`.
